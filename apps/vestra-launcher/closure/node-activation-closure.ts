import { homedir } from "node:os";
import { join } from "node:path";

import type { ActiveLauncherResolution } from "../../../packages/distribution/src/transactional-activation.ts";
import { TransactionalActivationManager } from "../../../packages/distribution/src/transactional-activation.ts";
import type { DistributionSourcePort, TufStagedRelease } from "../../../packages/distribution/src/tuf-update-client.ts";
import { HttpsDistributionSource, TufUpdateClient } from "../../../packages/distribution/src/tuf-update-client.ts";
import {
  NodeActivationHealthGate,
  NodeVerifiedLauncherHandoff
} from "../../../packages/platform-node/src/activation-launcher-adapters.ts";
import { resolveStateRoot } from "../../../packages/platform-node/src/state-root.ts";
import type {
  ActivationClosurePort,
  ActivationRequest,
  HandoffRequest,
  LauncherHandoffOutcome,
  VerifiedLauncherTarget
} from "../src/activation-closure.ts";
import type { PinnedReleaseSource } from "../src/pinned-inputs.ts";
import { LauncherBootstrapError } from "../src/public-errors.ts";
import type { LauncherHost } from "../src/supported-host.ts";

// NPX-03/NPX-05. This is a build input, not a published source. It is the one
// place that names the qualified TUF and activation packages, and it reaches
// them by repository-relative path because `apps/vestra-launcher` declares no
// workspace dependency and never may. The build bundles this module and its
// whole closure into the single emitted `lib/bootstrap.js`, so the published
// tarball still imports nothing but Node built-ins.
//
// Nothing here re-implements resolution, verification, activation, health, or
// process handling. Those are the qualified adapters; this module composes them
// against machine-local roots and binds the result to the pinned release.

const TUF_ROLES = Object.freeze(["root", "snapshot", "targets", "timestamp"] as const);

/** Machine-local locations plus the source the pinned configuration selects. */
export interface ActivationEnvironment {
  readonly installRoot: string;
  readonly stagingRoot: string;
  readonly trustRootDirectory: string;
  readonly createSource: (source: PinnedReleaseSource) => DistributionSourcePort;
}

export type ActivationEnvironmentFactory = (host: LauncherHost, source: PinnedReleaseSource) => ActivationEnvironment;

const unavailable = (message: string, diagnosticCode: string): never => {
  throw new LauncherBootstrapError("VES_VESTRA_ACTIVATION_UNAVAILABLE", message, diagnosticCode);
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function parseTrustRoot(trustedRoot: Uint8Array): Readonly<Record<string, unknown>> {
  let document: unknown;
  try {
    document = JSON.parse(Buffer.from(trustedRoot).toString("utf8"));
  } catch {
    return unavailable("the packaged trust root is not a readable TUF document", "VES_TUF_TRUST_ROOT_INVALID");
  }
  if (!isRecord(document) || !Array.isArray(document["signatures"]) || document["signatures"].length === 0)
    unavailable("the packaged trust root carries no signature", "VES_TUF_TRUST_ROOT_INVALID");
  return document as Readonly<Record<string, unknown>>;
}

function anchoringRole(value: unknown, keys: Readonly<Record<string, unknown>>): boolean {
  if (!isRecord(value)) return false;
  const keyids = value["keyids"];
  const threshold = value["threshold"];
  if (!Array.isArray(keyids) || keyids.length === 0) return false;
  if (!Number.isSafeInteger(threshold)) return false;
  const required = threshold as number;
  if (required < 1 || required > keyids.length) return false;
  return keyids.every((keyid) => typeof keyid === "string" && Object.hasOwn(keys, keyid));
}

/**
 * Refuses a trust root that cannot anchor a resolution at all. The published
 * `pinned-inputs` check proves the bytes are the reviewed root document; this
 * one proves the document names keys and delegates the four TUF roles, so a
 * package built from non-authoritative inputs stops here — before a directory
 * is created, before a name is resolved, and before a byte is fetched.
 */
export function assertAnchoringTrustRoot(trustedRoot: Uint8Array): void {
  const signed = parseTrustRoot(trustedRoot)["signed"];
  if (!isRecord(signed)) return unavailable("the packaged trust root has no signed role", "VES_TUF_TRUST_ROOT_INVALID");
  const keys = signed["keys"];
  const roles = signed["roles"];
  if (!isRecord(keys) || Object.keys(keys).length === 0)
    return unavailable("the packaged trust root declares no signing key", "VES_TUF_TRUST_ROOT_INVALID");
  if (!isRecord(roles) || !TUF_ROLES.every((role) => anchoringRole(roles[role], keys)))
    return unavailable(
      "the packaged trust root does not delegate the required TUF roles",
      "VES_TUF_TRUST_ROOT_INVALID"
    );
}

/**
 * The machine-local layout the published launcher uses. Only `homedir()` and
 * the platform decide it: no environment variable may select a state root, a
 * repository, a trust root, or a release. Each distinct pinned trust root gets
 * its own anchor directory, so a reviewed root change never collides with the
 * refusal that protects an installed root from being replaced.
 */
export const machineLocalEnvironment: ActivationEnvironmentFactory = (host, source) => {
  const stateRoot = resolveStateRoot({ platform: host.platform, env: {}, homeDirectory: homedir() });
  const launcherRoot = join(stateRoot, "launcher");
  return Object.freeze({
    installRoot: join(launcherRoot, "install"),
    stagingRoot: join(launcherRoot, "staging"),
    trustRootDirectory: join(launcherRoot, "trust", source.rootDigest.slice("sha256:".length)),
    createSource: (pinned: PinnedReleaseSource) =>
      new HttpsDistributionSource({
        mode: "online",
        sourceId: pinned.sourceId,
        metadataBaseUrl: pinned.metadataBaseUrl,
        targetBaseUrl: pinned.targetBaseUrl
      })
  });
};

/** The resolved release must be the exact release the tarball pins. */
function assertPinnedRelease(staged: TufStagedRelease, source: PinnedReleaseSource): TufStagedRelease {
  if (staged.releaseId !== source.releaseId)
    unavailable("the resolved release is not the release this build pins", "VES_TUF_RELEASE_VIEW_MIXED");
  if (staged.bundle.semanticVersion !== source.semanticVersion)
    unavailable("the resolved release version is not the version this build pins", "VES_TUF_RELEASE_VIEW_MIXED");
  return staged;
}

/**
 * Binds the verified launcher to the hermetic runtime that must execute it. The
 * launcher path comes from `resolveActiveLauncher`, which reverified every
 * installed component byte; the runtime path comes from the same release, which
 * the digest equality below proves is the release just resolved.
 */
function verifiedTarget(
  installRoot: string,
  resolution: ActiveLauncherResolution,
  staged: TufStagedRelease
): VerifiedLauncherTarget {
  if (resolution.active.releaseDigest !== staged.releaseDigest)
    unavailable("the activated release is not the release that was resolved", "VES_ACTIVATION_RELEASE_MIXED");
  const runtimes = staged.bundle.components.filter((component) => component.kind === "node-runtime");
  if (runtimes.length !== 1)
    unavailable("the activated release has no unique hermetic runtime", "VES_ACTIVATION_RELEASE_MIXED");
  const releaseRoot = join(installRoot, "releases", resolution.active.releaseDigest.slice("sha256:".length));
  return Object.freeze({
    runtimeExecutable: join(releaseRoot, ...runtimes[0]!.logicalPath.split("/")),
    launcherPath: resolution.executablePath,
    releaseId: resolution.active.releaseId,
    semanticVersion: resolution.active.semanticVersion
  });
}

/**
 * NPX-03/NPX-05/NPX-06. Resolves the pinned release through the packaged trust
 * root, stages it, activates it transactionally behind the observed activation
 * health gate, and transfers control with a shell-free argument vector.
 */
export class NodeActivationClosure implements ActivationClosurePort {
  readonly #environmentFor: ActivationEnvironmentFactory;

  constructor(environmentFor: ActivationEnvironmentFactory) {
    this.#environmentFor = environmentFor;
  }

  async activate(request: ActivationRequest): Promise<VerifiedLauncherTarget> {
    assertAnchoringTrustRoot(request.trustedRoot);
    const environment = this.#environmentFor(request.host, request.source);
    const client = new TufUpdateClient({
      trustRootDirectory: environment.trustRootDirectory,
      stagingRoot: environment.stagingRoot,
      trustedRoot: request.trustedRoot,
      source: environment.createSource(request.source)
    });
    const staged = assertPinnedRelease(
      await client.resolveAndStage({ platform: request.host.platform, arch: request.host.arch }),
      request.source
    );
    const manager = new TransactionalActivationManager({
      installRoot: environment.installRoot,
      stagingRoot: environment.stagingRoot,
      platform: request.host.platform,
      arch: request.host.arch,
      healthGate: new NodeActivationHealthGate()
    });
    await manager.activate(staged);
    return verifiedTarget(environment.installRoot, await manager.resolveActiveLauncher(), staged);
  }

  async handoff(request: HandoffRequest): Promise<LauncherHandoffOutcome> {
    const result = await new NodeVerifiedLauncherHandoff().execute({
      runtimeExecutable: request.target.runtimeExecutable,
      launcherPath: request.target.launcherPath,
      args: request.args
    });
    return Object.freeze({ exitCode: result.exitCode, signal: result.signal });
  }
}
