import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import { canonicalizeJsonV2 } from "@verchestra/domain";

import { verifyHermeticDistributionBundle, type HermeticDistributionBundle } from "./hermetic-bundle.ts";
import type { TufStagedRelease } from "./tuf-update-client.ts";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const HEALTH_NAMES = ["migration", "native", "driver"] as const;

// Windows releases the handle on a just-executed image, and on a child's
// working directory, a short moment after that child has already exited. The
// activation health gate runs both canonical launchers through the release's
// own hermetic runtime from inside the transaction root, so the publish rename
// and every directory-tree removal that follows can observe EBUSY, EPERM,
// EACCES, or ENOTEMPTY against a tree that is about to become free. Those codes
// are the transient class and a brief bounded wait resolves them. A lock that
// outlives the budget is a real conflict, so the original error is rethrown and
// the activation still fails closed rather than reporting a success it did not
// achieve. POSIX never reaches the retry: the first attempt succeeds there
// because an open handle does not block unlink or rename.
const LOCK_RETRY_LIMIT = 10;
const LOCK_RETRY_DELAY_MS = 100;
const TRANSIENT_LOCK_CODES: ReadonlySet<string> = new Set(["EBUSY", "EPERM", "EACCES", "ENOTEMPTY"]);

// `rm` retries exactly this class itself, and the options are inert when the
// first attempt succeeds. Only whole-tree removals carry the budget: single
// files inside the install root are serialized by the activation lock and are
// never the thing Windows is still holding.
const REMOVE_TREE = Object.freeze({
  recursive: true,
  force: true,
  maxRetries: LOCK_RETRY_LIMIT,
  retryDelay: LOCK_RETRY_DELAY_MS
});

// `rename` has no equivalent option, so the same budget is applied by hand.
const renameThroughTransientLock = async (from: string, to: string): Promise<void> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (attempt >= LOCK_RETRY_LIMIT || !TRANSIENT_LOCK_CODES.has(code)) throw error;
      await new Promise((settle) => setTimeout(settle, LOCK_RETRY_DELAY_MS * (attempt + 1)));
    }
  }
};

export interface ActivationHealthCheckEvidence {
  readonly name: (typeof HEALTH_NAMES)[number];
  readonly status: "pass";
  readonly evidenceDigest: string;
}

export interface LauncherHealthEvidence {
  readonly componentId: "launcher:vestra" | "launcher:verchestra";
  readonly exitCode: 0;
  readonly semanticVersion: string;
  readonly releaseDigest: string;
  readonly normalizedBehaviorDigest: string;
}

export interface ActivationHealthEvidence {
  readonly schemaVersion: 1;
  readonly checks: readonly ActivationHealthCheckEvidence[];
  readonly launchers: readonly LauncherHealthEvidence[];
}

export interface ActivationHealthGatePort {
  evaluate(input: {
    readonly releaseRoot: string;
    readonly bundle: HermeticDistributionBundle;
  }): Promise<ActivationHealthEvidence>;
}

export type ActivationFaultPoint =
  | "after-copy"
  | "after-health"
  | "after-journal-prepared"
  | "after-publish"
  | "after-journal-published"
  | "after-pointer"
  | "after-journal-committed";

export interface TransactionalActivationOptions {
  readonly installRoot: string;
  readonly stagingRoot: string;
  readonly platform: "win32" | "linux" | "darwin";
  readonly arch: "x64" | "arm64";
  readonly healthGate: ActivationHealthGatePort;
  readonly fault?: (point: ActivationFaultPoint) => void | Promise<void>;
}

export interface ActiveReleasePointer {
  readonly schemaVersion: 1;
  readonly releaseId: string;
  readonly releaseDigest: string;
  readonly semanticVersion: string;
}

export interface ActiveLauncherResolution {
  readonly schemaVersion: 1;
  readonly active: ActiveReleasePointer;
  readonly executablePath: string;
}

export interface ActivationReceipt {
  readonly schemaVersion: 1;
  readonly operation: "activate" | "rollback";
  readonly previous: ActiveReleasePointer | null;
  readonly active: ActiveReleasePointer;
  readonly releaseReused: boolean;
}

// invariant: `trustRootDigest` names the root a TUF resolution verified the
// stage under. Only `activate` records it; a bound `rollback` only reads it.
export interface ActivationProvenance {
  readonly trustRootDigest: string;
}

export interface RetainedReleaseQuery {
  readonly trustRootDigest: string;
  readonly releaseId: string;
  readonly semanticVersion: string;
}

export interface RetainedRelease {
  readonly active: ActiveReleasePointer;
  readonly bundle: HermeticDistributionBundle;
}

export interface UninstallReceipt {
  readonly schemaVersion: 1;
  readonly previous: ActiveReleasePointer | null;
  readonly releasesPurged: boolean;
  readonly userDataPreserved: true;
}

export class ActivationError extends Error {
  readonly code: string;
  readonly previousActive: ActiveReleasePointer | null;

  constructor(code: string, message: string, previousActive: ActiveReleasePointer | null, options?: ErrorOptions) {
    super(message, options);
    this.name = "ActivationError";
    this.code = code;
    this.previousActive = previousActive;
  }
}

interface ActivationJournal {
  readonly schemaVersion: 1;
  readonly operation: "activate" | "rollback";
  readonly state: "PREPARED" | "PUBLISHED" | "COMMITTED";
  readonly target: ActiveReleasePointer;
  readonly previous: ActiveReleasePointer | null;
  readonly health: ActivationHealthEvidence;
}

type VerifiedReleaseEntry = Omit<ActiveReleasePointer, "schemaVersion">;

const fail = (code: string, message: string, previous: ActiveReleasePointer | null, cause?: unknown): never => {
  throw new ActivationError(code, message, previous, cause === undefined ? undefined : { cause });
};

const equal = (left: unknown, right: unknown): boolean => canonicalizeJsonV2(left) === canonicalizeJsonV2(right);

const hasExactKeys = (value: object, keys: readonly string[]): boolean =>
  equal(Object.keys(value).sort(), [...keys].sort());

const assertWithin = (root: string, candidate: string): void => {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  if (normalizedCandidate !== normalizedRoot && !normalizedCandidate.startsWith(`${normalizedRoot}${sep}`))
    throw new Error("managed activation path escapes its root");
};

const optionalStat = async (path: string) => {
  try {
    return await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
};

const optionalJson = async (path: string): Promise<unknown | undefined> => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
};

const ensureRealChain = async (root: string, candidate: string): Promise<void> => {
  assertWithin(root, candidate);
  const normalizedRoot = resolve(root);
  if ((await lstat(normalizedRoot)).isSymbolicLink()) throw new Error("managed root is a symbolic link");
  const segments = resolve(candidate).slice(normalizedRoot.length).split(sep).filter(Boolean);
  let current = normalizedRoot;
  for (const segment of segments) {
    current = join(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error("managed path is a symbolic link");
  }
};

const hashFile = async (path: string): Promise<string> => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return `sha256:${hash.digest("hex")}`;
};

const atomicJson = async (path: string, value: unknown): Promise<void> => {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
};

const pointer = (bundle: HermeticDistributionBundle): ActiveReleasePointer =>
  Object.freeze({
    schemaVersion: 1,
    releaseId: bundle.releaseId,
    releaseDigest: bundle.releaseDigest,
    semanticVersion: bundle.semanticVersion
  });

const entryOf = (target: ActiveReleasePointer): VerifiedReleaseEntry =>
  Object.freeze({
    releaseId: target.releaseId,
    releaseDigest: target.releaseDigest,
    semanticVersion: target.semanticVersion
  });

const trustRootOf = (provenance: ActivationProvenance | undefined, previous: ActiveReleasePointer | null) => {
  if (provenance === undefined) return undefined;
  if (
    provenance === null ||
    typeof provenance !== "object" ||
    !hasExactKeys(provenance, ["trustRootDigest"]) ||
    typeof provenance.trustRootDigest !== "string" ||
    !DIGEST.test(provenance.trustRootDigest)
  )
    fail("VES_ACTIVATION_PROVENANCE_INVALID", "activation provenance is malformed", previous);
  return provenance.trustRootDigest;
};

const isVerifiedEntry = (entry: Partial<VerifiedReleaseEntry> | null): boolean =>
  entry !== null &&
  typeof entry === "object" &&
  hasExactKeys(entry, ["releaseId", "releaseDigest", "semanticVersion"]) &&
  typeof entry.releaseId === "string" &&
  entry.releaseId.length > 0 &&
  typeof entry.semanticVersion === "string" &&
  entry.semanticVersion.length > 0 &&
  typeof entry.releaseDigest === "string" &&
  DIGEST.test(entry.releaseDigest);

const verifiedEntries = (
  value: unknown,
  trustRootDigest: string,
  previous: ActiveReleasePointer | null
): readonly VerifiedReleaseEntry[] => {
  const record = value as {
    readonly schemaVersion?: unknown;
    readonly trustRootDigest?: unknown;
    readonly releases?: unknown;
  };
  if (
    value === null ||
    typeof value !== "object" ||
    !hasExactKeys(value, ["schemaVersion", "trustRootDigest", "releases"]) ||
    record.schemaVersion !== 1 ||
    record.trustRootDigest !== trustRootDigest ||
    !Array.isArray(record.releases)
  )
    fail("VES_ACTIVATION_RECORD_INVALID", "verified-release record is malformed", previous);
  const releases = record.releases as readonly Partial<VerifiedReleaseEntry>[];
  if (
    !releases.every(isVerifiedEntry) ||
    new Set(releases.map((entry) => entry.releaseDigest)).size !== releases.length
  )
    fail("VES_ACTIVATION_RECORD_INVALID", "verified-release record entry is malformed", previous);
  return Object.freeze(releases.map((entry) => Object.freeze({ ...entry }) as VerifiedReleaseEntry));
};

const retainedQueryRoot = (query: RetainedReleaseQuery): string => {
  if (
    query === null ||
    typeof query !== "object" ||
    !hasExactKeys(query, ["trustRootDigest", "releaseId", "semanticVersion"]) ||
    typeof query.releaseId !== "string" ||
    typeof query.semanticVersion !== "string"
  )
    fail("VES_ACTIVATION_PROVENANCE_INVALID", "retained release query is malformed", null);
  return trustRootOf({ trustRootDigest: query.trustRootDigest }, null)!;
};

const validateHealth = (
  value: ActivationHealthEvidence,
  bundle: HermeticDistributionBundle,
  previous: ActiveReleasePointer | null
): ActivationHealthEvidence => {
  if (
    value === null ||
    typeof value !== "object" ||
    !hasExactKeys(value, ["schemaVersion", "checks", "launchers"]) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.checks) ||
    !Array.isArray(value.launchers)
  )
    fail("VES_ACTIVATION_HEALTH_INVALID", "health evidence is malformed", previous);
  if (
    value.checks.length !== HEALTH_NAMES.length ||
    value.checks.some(
      (check) =>
        check === null || typeof check !== "object" || !hasExactKeys(check, ["name", "status", "evidenceDigest"])
    ) ||
    !HEALTH_NAMES.every((name) =>
      value.checks.some((check) => check.name === name && check.status === "pass" && DIGEST.test(check.evidenceDigest))
    )
  )
    fail("VES_ACTIVATION_HEALTH_FAILED", "required activation health check did not pass", previous);
  const launchers = new Map(value.launchers.map((entry) => [entry.componentId, entry]));
  const vestra = launchers.get("launcher:vestra");
  const verchestra = launchers.get("launcher:verchestra");
  if (
    value.launchers.length !== 2 ||
    value.launchers.some(
      (launcher) =>
        launcher === null ||
        typeof launcher !== "object" ||
        !hasExactKeys(launcher, [
          "componentId",
          "exitCode",
          "semanticVersion",
          "releaseDigest",
          "normalizedBehaviorDigest"
        ])
    ) ||
    launchers.size !== 2 ||
    vestra?.exitCode !== 0 ||
    verchestra?.exitCode !== 0 ||
    vestra.semanticVersion !== bundle.semanticVersion ||
    verchestra.semanticVersion !== bundle.semanticVersion ||
    vestra.releaseDigest !== bundle.releaseDigest ||
    verchestra.releaseDigest !== bundle.releaseDigest ||
    !DIGEST.test(vestra.normalizedBehaviorDigest) ||
    vestra.normalizedBehaviorDigest !== verchestra.normalizedBehaviorDigest
  )
    fail("VES_ACTIVATION_LAUNCHER_MISMATCH", "canonical launchers are not equivalent", previous);
  return Object.freeze({
    schemaVersion: 1,
    checks: Object.freeze(value.checks.map((entry) => Object.freeze({ ...entry }))),
    launchers: Object.freeze(value.launchers.map((entry) => Object.freeze({ ...entry })))
  });
};

export class TransactionalActivationManager {
  readonly #installRoot: string;
  readonly #stagingRoot: string;
  readonly #platform: "win32" | "linux" | "darwin";
  readonly #arch: "x64" | "arm64";
  readonly #healthGate: ActivationHealthGatePort;
  readonly #fault: (point: ActivationFaultPoint) => void | Promise<void>;

  constructor(options: TransactionalActivationOptions) {
    this.#installRoot = resolve(options.installRoot);
    this.#stagingRoot = resolve(options.stagingRoot);
    if (
      this.#installRoot === this.#stagingRoot ||
      this.#installRoot.startsWith(`${this.#stagingRoot}${sep}`) ||
      this.#stagingRoot.startsWith(`${this.#installRoot}${sep}`)
    )
      throw new ActivationError("VES_ACTIVATION_ROOT_INVALID", "install and staging roots must be disjoint", null);
    if (
      !(["win32", "linux", "darwin"] as const).includes(options.platform) ||
      !(["x64", "arm64"] as const).includes(options.arch)
    )
      throw new ActivationError("VES_ACTIVATION_ROOT_INVALID", "activation target is unsupported", null);
    this.#platform = options.platform;
    this.#arch = options.arch;
    this.#healthGate = options.healthGate;
    this.#fault = options.fault ?? (() => undefined);
  }

  async #initialize(): Promise<void> {
    await mkdir(this.#installRoot, { recursive: true, mode: 0o700 });
    await ensureRealChain(this.#installRoot, this.#installRoot);
    for (const name of ["releases", "transactions", "verified"] as const) {
      const path = join(this.#installRoot, name);
      await mkdir(path, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
      await ensureRealChain(this.#installRoot, path);
    }
  }

  async active(): Promise<ActiveReleasePointer | null> {
    const value = await optionalJson(join(this.#installRoot, "active.json"));
    if (value === undefined) return null;
    const item = value as Partial<ActiveReleasePointer>;
    if (
      !hasExactKeys(value as object, ["schemaVersion", "releaseId", "releaseDigest", "semanticVersion"]) ||
      item.schemaVersion !== 1 ||
      typeof item.releaseId !== "string" ||
      typeof item.releaseDigest !== "string" ||
      !DIGEST.test(item.releaseDigest) ||
      typeof item.semanticVersion !== "string"
    )
      throw new ActivationError("VES_ACTIVATION_POINTER_INVALID", "active pointer is malformed", null);
    return Object.freeze({
      schemaVersion: 1,
      releaseId: item.releaseId,
      releaseDigest: item.releaseDigest,
      semanticVersion: item.semanticVersion
    });
  }

  async resolveActiveLauncher(): Promise<ActiveLauncherResolution> {
    const active = await this.active();
    if (active === null)
      throw new ActivationError("VES_ACTIVATION_POINTER_MISSING", "no active release is installed", null);
    const installed = await this.#installedBundle(active.releaseDigest, active, "VES_ACTIVATION_INTEGRITY");
    if (!equal(active, pointer(installed.bundle)))
      fail("VES_ACTIVATION_RELEASE_MIXED", "active pointer conflicts with the installed release", active);
    const launchers = installed.bundle.components.filter(
      (component) => component.componentId === "launcher:vestra" && component.kind === "launcher"
    );
    if (launchers.length !== 1)
      fail("VES_ACTIVATION_LAUNCHER_MISMATCH", "active release has no unique vestra launcher", active);
    const executablePath = join(installed.root, launchers[0]!.logicalPath);
    await ensureRealChain(installed.root, executablePath).catch((error) =>
      fail("VES_ACTIVATION_INTEGRITY", "active launcher path is invalid", active, error)
    );
    return Object.freeze({ schemaVersion: 1, active, executablePath });
  }

  #recordPath(trustRootDigest: string): string {
    return join(this.#installRoot, "verified", `${trustRootDigest.slice("sha256:".length)}.json`);
  }

  // invariant: a record lists each digest at most once, ordered by verification
  // recency; the last entry is the latest TUF-verified release under its root.
  async #verifiedReleases(
    trustRootDigest: string,
    previous: ActiveReleasePointer | null
  ): Promise<readonly VerifiedReleaseEntry[]> {
    const path = this.#recordPath(trustRootDigest);
    let value: unknown;
    try {
      await ensureRealChain(this.#installRoot, path);
      value = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return Object.freeze([]);
      return fail("VES_ACTIVATION_RECORD_INVALID", "verified-release record is unreadable", previous, error);
    }
    return verifiedEntries(value, trustRootDigest, previous);
  }

  async #recordVerified(
    trustRootDigest: string,
    target: ActiveReleasePointer,
    previous: ActiveReleasePointer | null
  ): Promise<void> {
    const entry = entryOf(target);
    const releases = await this.#verifiedReleases(trustRootDigest, previous);
    if (releases.length > 0 && equal(releases.at(-1), entry)) return;
    await atomicJson(this.#recordPath(trustRootDigest), {
      schemaVersion: 1,
      trustRootDigest,
      releases: [...releases.filter((item) => item.releaseDigest !== entry.releaseDigest), entry]
    });
  }

  // invariant (AD-036): a release is retained only when exactly one entry
  // under the pinned root carries the pinned identity, it is still installed,
  // and a later TUF-verified activation superseded it. Reads only; `rollback`
  // re-verifies every byte before it switches.
  async retainedRelease(query: RetainedReleaseQuery): Promise<RetainedRelease | null> {
    const releases = await this.#verifiedReleases(retainedQueryRoot(query), null);
    const matches = releases.filter(
      (entry) => entry.releaseId === query.releaseId && entry.semanticVersion === query.semanticVersion
    );
    // why: the latest verified release keeps the network path, so metadata
    // expiry and publisher revocation stay observed for the steady state.
    if (matches.length !== 1 || equal(matches[0], releases.at(-1))) return null;
    return await this.#retainedManifest(matches[0]!);
  }

  async #retainedManifest(match: VerifiedReleaseEntry): Promise<RetainedRelease | null> {
    const root = join(this.#installRoot, "releases", match.releaseDigest.slice("sha256:".length));
    const record = await optionalJson(join(root, "release.json")).catch((error) =>
      fail("VES_ROLLBACK_TARGET_INVALID", "installed release manifest is unreadable", null, error)
    );
    if (record === undefined) return null;
    let bundle: HermeticDistributionBundle;
    try {
      bundle = verifyHermeticDistributionBundle((record as { bundle?: unknown }).bundle);
    } catch (error) {
      return fail("VES_ROLLBACK_TARGET_INVALID", "installed release manifest is invalid", null, error);
    }
    if (!equal(entryOf(pointer(bundle)), match))
      fail("VES_ROLLBACK_TARGET_INVALID", "installed release identity conflicts with its record", null);
    return Object.freeze({ active: pointer(bundle), bundle });
  }

  async #assertNoForeignJournal(target: ActiveReleasePointer, previous: ActiveReleasePointer | null): Promise<void> {
    const existingJournal = (await optionalJson(join(this.#installRoot, "activation-journal.json"))) as
      ActivationJournal | undefined;
    if (existingJournal !== undefined && !equal(existingJournal.target, target))
      fail("VES_ACTIVATION_RECOVERY_REQUIRED", "another activation journal requires reconciliation", previous);
  }

  async #acquireLock(): Promise<() => Promise<void>> {
    const path = join(this.#installRoot, "activation.lock");
    const owner = { pid: process.pid, nonce: randomUUID() };
    const encoded = `${JSON.stringify(owner)}\n`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let handle;
      try {
        handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
        await handle.writeFile(encoded);
        await handle.sync();
        await handle.close();
        return async () => {
          const current = await readFile(path, "utf8").catch(() => undefined);
          if (current === encoded) await rm(path, { force: true });
        };
      } catch (error) {
        await handle?.close();
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const observedText = await readFile(path, "utf8").catch(() => undefined);
        let observed: { readonly pid: number; readonly nonce: string } | undefined;
        try {
          const parsed = JSON.parse(observedText ?? "null") as Partial<typeof owner> | null;
          if (
            parsed !== null &&
            Number.isSafeInteger(parsed.pid) &&
            (parsed.pid ?? 0) > 0 &&
            typeof parsed.nonce === "string" &&
            /^[a-f0-9-]{36}$/u.test(parsed.nonce)
          )
            observed = { pid: parsed.pid as number, nonce: parsed.nonce };
        } catch {
          observed = undefined;
        }
        if (observed === undefined || this.#processAlive(observed.pid))
          throw new ActivationError(
            "VES_ACTIVATION_BUSY",
            "another activation owns the install root",
            await this.active()
          );
        const stale = `${path}.stale.${randomUUID()}`;
        try {
          await rename(path, stale);
        } catch (renameError) {
          if ((renameError as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw renameError;
        }
        const claimedText = await readFile(stale, "utf8").catch(() => undefined);
        if (claimedText !== observedText) {
          await rename(stale, path).catch(() => undefined);
          throw new ActivationError(
            "VES_ACTIVATION_BUSY",
            "activation lock changed during recovery",
            await this.active()
          );
        }
        await rm(stale, { force: true });
      }
    }
    throw new ActivationError("VES_ACTIVATION_BUSY", "activation lock could not be acquired", await this.active());
  }

  #processAlive(pid: number): boolean {
    if (pid === process.pid) return true;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== "ESRCH";
    }
  }

  async #validateFiles(
    root: string,
    bundle: HermeticDistributionBundle,
    previous: ActiveReleasePointer | null
  ): Promise<void> {
    for (const component of bundle.components) {
      const path = join(root, component.logicalPath);
      try {
        await ensureRealChain(root, path);
        const info = await stat(path);
        if (!info.isFile() || info.size !== component.sizeBytes || (await hashFile(path)) !== component.contentDigest)
          fail("VES_ACTIVATION_INTEGRITY", `component integrity failed: ${component.componentId}`, previous);
      } catch (error) {
        if (error instanceof ActivationError) throw error;
        fail("VES_ACTIVATION_INTEGRITY", `component is unavailable: ${component.componentId}`, previous, error);
      }
    }
  }

  async #openStage(staged: TufStagedRelease, previous: ActiveReleasePointer | null) {
    if (
      staged === null ||
      typeof staged !== "object" ||
      !hasExactKeys(staged, [
        "schemaVersion",
        "stageId",
        "releaseId",
        "releaseDigest",
        "platform",
        "arch",
        "sourceMode",
        "sourceId",
        "bundle",
        "components",
        "activationAllowed"
      ]) ||
      staged.schemaVersion !== 1 ||
      staged.activationAllowed !== false ||
      staged.stageId !== `stage:${staged.releaseDigest}` ||
      !DIGEST.test(staged.releaseDigest)
    )
      fail("VES_ACTIVATION_STAGE_INVALID", "staged receipt is not a non-authoritative TUF stage", previous);
    let bundle: HermeticDistributionBundle;
    try {
      bundle = verifyHermeticDistributionBundle(staged.bundle);
    } catch (error) {
      return fail("VES_ACTIVATION_STAGE_INVALID", "staged bundle is invalid", previous, error);
    }
    if (
      bundle.releaseId !== staged.releaseId ||
      bundle.releaseDigest !== staged.releaseDigest ||
      bundle.target.platform !== staged.platform ||
      bundle.target.arch !== staged.arch ||
      bundle.target.platform !== this.#platform ||
      bundle.target.arch !== this.#arch
    )
      fail("VES_ACTIVATION_RELEASE_MIXED", "staged release identity is inconsistent", previous);
    const projection = bundle.components.map(({ componentId, logicalPath, contentDigest, sizeBytes }) => ({
      componentId,
      logicalPath,
      contentDigest,
      sizeBytes
    }));
    if (!equal(projection, staged.components))
      fail("VES_ACTIVATION_RELEASE_MIXED", "staged component projection conflicts with its bundle", previous);
    const stageRoot = join(this.#stagingRoot, bundle.releaseDigest.slice("sha256:".length));
    await ensureRealChain(this.#stagingRoot, stageRoot).catch((error) =>
      fail("VES_ACTIVATION_STAGE_INVALID", "staging root is invalid", previous, error)
    );
    const persisted = await optionalJson(join(stageRoot, "staged-release.json"));
    if (!equal(persisted, staged))
      fail("VES_ACTIVATION_STAGE_INVALID", "persisted staged receipt differs from activation input", previous);
    await this.#validateFiles(stageRoot, bundle, previous);
    return { bundle, stageRoot };
  }

  async #copyClosure(
    sourceRoot: string,
    targetRoot: string,
    bundle: HermeticDistributionBundle,
    previous: ActiveReleasePointer | null
  ): Promise<void> {
    const transactionParent = dirname(targetRoot);
    try {
      if (await optionalStat(transactionParent)) {
        await ensureRealChain(this.#installRoot, transactionParent);
      } else {
        await ensureRealChain(this.#installRoot, dirname(transactionParent));
        await mkdir(transactionParent, { mode: 0o700 });
        await ensureRealChain(this.#installRoot, transactionParent);
      }
    } catch (error) {
      fail("VES_ACTIVATION_STAGE_INVALID", "transaction parent is not contained", previous, error);
    }
    const existingTarget = await optionalStat(targetRoot);
    if (existingTarget !== undefined && (await lstat(targetRoot)).isSymbolicLink())
      fail("VES_ACTIVATION_STAGE_INVALID", "transaction root is a symbolic link", previous);
    await rm(targetRoot, REMOVE_TREE);
    await mkdir(targetRoot, { recursive: true, mode: 0o700 });
    for (const component of bundle.components) {
      const source = join(sourceRoot, component.logicalPath);
      const target = join(targetRoot, component.logicalPath);
      assertWithin(targetRoot, target);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await copyFile(source, target, constants.COPYFILE_EXCL);
    }
    await this.#validateFiles(targetRoot, bundle, previous);
  }

  async #installedBundle(
    releaseDigest: string,
    previous: ActiveReleasePointer | null,
    invalidCode = "VES_ROLLBACK_TARGET_INVALID"
  ) {
    if (!DIGEST.test(releaseDigest)) fail(invalidCode, "installed release digest is invalid", previous);
    const root = join(this.#installRoot, "releases", releaseDigest.slice("sha256:".length));
    const record = await optionalJson(join(root, "release.json"));
    if (record === undefined) fail(invalidCode, "installed release is missing", previous);
    let bundle: HermeticDistributionBundle;
    try {
      bundle = verifyHermeticDistributionBundle((record as { bundle?: unknown }).bundle);
    } catch (error) {
      return fail(invalidCode, "installed release manifest is invalid", previous, error);
    }
    if (bundle.releaseDigest !== releaseDigest) fail(invalidCode, "installed release identity is invalid", previous);
    await this.#validateFiles(root, bundle, previous);
    return { root, bundle, record };
  }

  async #health(root: string, bundle: HermeticDistributionBundle, previous: ActiveReleasePointer | null) {
    try {
      return validateHealth(await this.#healthGate.evaluate({ releaseRoot: root, bundle }), bundle, previous);
    } catch (error) {
      if (error instanceof ActivationError) throw error;
      return fail("VES_ACTIVATION_HEALTH_FAILED", "activation health gate failed", previous, error);
    }
  }

  async #writeJournal(journal: ActivationJournal): Promise<void> {
    await atomicJson(join(this.#installRoot, "activation-journal.json"), journal);
  }

  async #switchPointer(target: ActiveReleasePointer): Promise<void> {
    await atomicJson(join(this.#installRoot, "active.json"), target);
  }

  async activate(staged: TufStagedRelease, provenance?: ActivationProvenance): Promise<ActivationReceipt> {
    const trustRootDigest = trustRootOf(provenance, null);
    await this.#initialize();
    const releaseLock = await this.#acquireLock();
    let previous = await this.active();
    try {
      const opened = await this.#openStage(staged, previous);
      const targetFromInput = pointer(opened.bundle);
      await this.#assertNoForeignJournal(targetFromInput, previous);
      if (equal(previous, targetFromInput)) {
        await this.#installedBundle(targetFromInput.releaseDigest, previous);
        if (trustRootDigest !== undefined) await this.#recordVerified(trustRootDigest, targetFromInput, previous);
        await rm(join(this.#installRoot, "activation-journal.json"), { force: true });
        return Object.freeze({
          schemaVersion: 1,
          operation: "activate",
          previous,
          active: targetFromInput,
          releaseReused: true
        });
      }
      const target = pointer(opened.bundle);
      const releaseRoot = join(this.#installRoot, "releases", target.releaseDigest.slice("sha256:".length));
      const transactionRoot = join(this.#installRoot, "transactions", target.releaseDigest.slice("sha256:".length));
      const payloadRoot = join(transactionRoot, "release");
      let health: ActivationHealthEvidence;
      let releaseReused = false;
      if (await optionalStat(releaseRoot)) {
        const installed = await this.#installedBundle(target.releaseDigest, previous);
        health = await this.#health(installed.root, installed.bundle, previous);
        releaseReused = true;
      } else {
        await this.#copyClosure(opened.stageRoot, payloadRoot, opened.bundle, previous);
        await this.#fault("after-copy");
        health = await this.#health(payloadRoot, opened.bundle, previous);
        await this.#fault("after-health");
        await atomicJson(join(payloadRoot, "release.json"), { schemaVersion: 1, bundle: opened.bundle, health });
        const prepared: ActivationJournal = {
          schemaVersion: 1,
          operation: "activate",
          state: "PREPARED",
          target,
          previous,
          health
        };
        await this.#writeJournal(prepared);
        await this.#fault("after-journal-prepared");
        await renameThroughTransientLock(payloadRoot, releaseRoot);
        await this.#fault("after-publish");
        await this.#writeJournal({ ...prepared, state: "PUBLISHED" });
        await this.#fault("after-journal-published");
      }
      // why: recording before the switch means a record failure leaves the
      // previous release active; a crash in between converges on retry.
      if (trustRootDigest !== undefined) await this.#recordVerified(trustRootDigest, target, previous);
      await this.#switchPointer(target);
      await this.#fault("after-pointer");
      await this.#writeJournal({
        schemaVersion: 1,
        operation: "activate",
        state: "COMMITTED",
        target,
        previous,
        health
      });
      await this.#fault("after-journal-committed");
      await rm(transactionRoot, REMOVE_TREE);
      await rm(join(this.#installRoot, "activation-journal.json"), { force: true });
      return Object.freeze({ schemaVersion: 1, operation: "activate", previous, active: target, releaseReused });
    } catch (error) {
      if (error instanceof ActivationError) throw error;
      previous = await this.active().catch(() => previous);
      return fail("VES_ACTIVATION_FAILED", "transactional activation failed", previous, error);
    } finally {
      await releaseLock();
    }
  }

  // invariant (AD-036): with `binding`, the release must be recorded as
  // TUF-verified under that root and built for this host. Unbound, it keeps
  // the operator semantics. Both re-hash every byte and pass health first.
  async rollback(releaseDigest: string, binding?: ActivationProvenance): Promise<ActivationReceipt> {
    const trustRootDigest = trustRootOf(binding, null);
    await this.#initialize();
    const releaseLock = await this.#acquireLock();
    const previous = await this.active();
    try {
      const installed = await this.#installedBundle(releaseDigest, previous);
      const target = pointer(installed.bundle);
      if (trustRootDigest !== undefined) {
        if (installed.bundle.target.platform !== this.#platform || installed.bundle.target.arch !== this.#arch)
          fail("VES_ACTIVATION_RELEASE_MIXED", "retained release is not built for this host", previous);
        const recorded = (await this.#verifiedReleases(trustRootDigest, previous)).find(
          (entry) => entry.releaseDigest === target.releaseDigest
        );
        if (recorded === undefined || !equal(recorded, entryOf(target)))
          fail("VES_ROLLBACK_TARGET_UNTRUSTED", "release was not verified under this trust root", previous);
      }
      await this.#assertNoForeignJournal(target, previous);
      const health = await this.#health(installed.root, installed.bundle, previous);
      const prepared: ActivationJournal = {
        schemaVersion: 1,
        operation: "rollback",
        state: "PREPARED",
        target,
        previous,
        health
      };
      await this.#writeJournal(prepared);
      await this.#fault("after-journal-prepared");
      await this.#switchPointer(target);
      await this.#fault("after-pointer");
      await this.#writeJournal({ ...prepared, state: "COMMITTED" });
      await this.#fault("after-journal-committed");
      await rm(join(this.#installRoot, "activation-journal.json"), { force: true });
      return Object.freeze({
        schemaVersion: 1,
        operation: "rollback",
        previous,
        active: target,
        releaseReused: true
      });
    } catch (error) {
      if (error instanceof ActivationError) throw error;
      return fail("VES_ROLLBACK_FAILED", "transactional rollback failed", await this.active(), error);
    } finally {
      await releaseLock();
    }
  }

  async uninstall(options: { readonly purgeReleases: boolean }): Promise<UninstallReceipt> {
    if (
      options === null ||
      typeof options !== "object" ||
      !hasExactKeys(options, ["purgeReleases"]) ||
      typeof options.purgeReleases !== "boolean"
    )
      throw new ActivationError("VES_UNINSTALL_INPUT_INVALID", "uninstall options are invalid", await this.active());
    await this.#initialize();
    const releaseLock = await this.#acquireLock();
    const previous = await this.active();
    try {
      await rm(join(this.#installRoot, "active.json"), { force: true });
      await rm(join(this.#installRoot, "activation-journal.json"), { force: true });
      await rm(join(this.#installRoot, "transactions"), REMOVE_TREE);
      await mkdir(join(this.#installRoot, "transactions"), { mode: 0o700 });
      if (options.purgeReleases) {
        for (const name of ["releases", "verified"] as const) {
          await rm(join(this.#installRoot, name), REMOVE_TREE);
          await mkdir(join(this.#installRoot, name), { mode: 0o700 });
        }
      }
      return Object.freeze({
        schemaVersion: 1,
        previous,
        releasesPurged: options.purgeReleases,
        userDataPreserved: true
      });
    } finally {
      await releaseLock();
    }
  }
}
