import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { canonicalizeJsonV2 } from "@verchestra/domain";

import { ActivationLauncherError, type ActivationLauncherErrorCode } from "./activation-launcher-errors.ts";

// NPX-05/NPX-06/NPX-07. `ActivationHealthGatePort` is declared by
// packages/distribution, but a process-spawning implementation is a concrete
// adapter, and an adapter may not import a sibling adapter
// (scripts/architecture.mjs, VES_ARCH_ADAPTER_COUPLING). So the port is
// satisfied structurally from here: the views below mirror exactly the fields
// the port reads, and `HermeticDistributionBundle` is assignable to
// `ActivationHealthBundleView` without either package importing the other.
//
// Every launcher runs through the release's own hermetic Node runtime
// component, never ambient Node and never a shell. That is also what keeps
// Windows honest: `bin/*.mjs` is not directly spawnable there, and enabling a
// shell to work around it is the one escape this contract must never take.

const execFileAsync = promisify(execFile);

const HEALTH_CHECK_NAMES = Object.freeze(["migration", "native", "driver"] as const);
const CANONICAL_LAUNCHER_IDS = Object.freeze(["launcher:vestra", "launcher:verchestra"] as const);
const SUPPORTED_PLATFORMS = Object.freeze(["win32", "linux", "darwin"] as const);
const SUPPORTED_ARCHES = Object.freeze(["x64", "arm64"] as const);
// A launcher cannot report the release digest: that digest is computed over a
// manifest that contains the launcher's own content digest, so any self-reported
// value would be circular, and at pre-publication health time the installed
// `release.json` does not exist yet. The launcher therefore reports what it can
// genuinely observe about itself — its compiled-in semantic version, the three
// named checks, and its normalized behavior — and the gate binds that evidence
// to the release digest of the closure it actually ran.
const REPORT_KEYS = Object.freeze(["schemaVersion", "report", "componentId", "semanticVersion", "checks", "behavior"]);
const CHECK_KEYS = Object.freeze(["name", "status", "observation"]);
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_OUTPUT_LIMIT_BYTES = 1_048_576;

/** The fixed argument every canonical launcher answers with a health report. */
export const ACTIVATION_HEALTH_ARGUMENT = "--activation-health";

export type CanonicalLauncherId = (typeof CANONICAL_LAUNCHER_IDS)[number];
export type ActivationHealthCheckName = (typeof HEALTH_CHECK_NAMES)[number];
export type SupportedLauncherPlatform = (typeof SUPPORTED_PLATFORMS)[number];
export type SupportedLauncherArch = (typeof SUPPORTED_ARCHES)[number];

export interface SupportedLauncherHost {
  readonly platform: SupportedLauncherPlatform;
  readonly arch: SupportedLauncherArch;
}

export interface ActivationHealthComponentView {
  readonly componentId: string;
  readonly kind: string;
  readonly logicalPath: string;
}

export interface ActivationHealthBundleView {
  readonly semanticVersion: string;
  readonly releaseDigest: string;
  readonly components: readonly ActivationHealthComponentView[];
}

export interface ObservedActivationCheck {
  readonly name: ActivationHealthCheckName;
  readonly status: "pass";
  readonly evidenceDigest: string;
}

export interface ObservedLauncherHealth {
  readonly componentId: CanonicalLauncherId;
  readonly exitCode: 0;
  readonly semanticVersion: string;
  readonly releaseDigest: string;
  readonly normalizedBehaviorDigest: string;
}

export interface ObservedActivationHealth {
  readonly schemaVersion: 1;
  readonly checks: readonly ObservedActivationCheck[];
  readonly launchers: readonly ObservedLauncherHealth[];
}

export interface NodeActivationHealthGateOptions {
  readonly timeoutMs?: number;
  readonly outputLimitBytes?: number;
  readonly environment?: Readonly<Record<string, string>>;
}

export interface VerifiedLauncherHandoffRequest {
  readonly runtimeExecutable: string;
  readonly launcherPath: string;
  readonly args: readonly string[];
}

export interface VerifiedLauncherHandoffResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

interface ObservedLauncherReport {
  readonly componentId: CanonicalLauncherId;
  readonly semanticVersion: string;
  readonly releaseDigest: string;
  readonly checks: readonly Readonly<Record<string, unknown>>[];
  readonly behavior: unknown;
}

interface ChildObservation {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly output: string;
  readonly timedOut: boolean;
  readonly outputLimitExceeded: boolean;
}

const fail = (code: ActivationLauncherErrorCode, message: string, cause?: unknown): never => {
  throw new ActivationLauncherError(code, message, cause === undefined ? undefined : { cause });
};

const sha256 = (value: string): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;

const canonical = (value: unknown, label: string): string => {
  try {
    return canonicalizeJsonV2(value);
  } catch (error) {
    return fail("VES_LAUNCHER_HEALTH_REPORT_INVALID", `${label} is not canonical JSON`, error);
  }
};

const hasExactKeys = (value: object, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * NPX-07: the supported-host decision is a pure, total function of the declared
 * target, so an unsupported host stops before any network, staging, activation,
 * or child-process effect.
 */
export function supportedLauncherHost(input: {
  readonly platform: string;
  readonly arch: string;
}): SupportedLauncherHost {
  const platform = SUPPORTED_PLATFORMS.find((candidate) => candidate === input.platform);
  const arch = SUPPORTED_ARCHES.find((candidate) => candidate === input.arch);
  if (platform === undefined || arch === undefined)
    fail("VES_LAUNCHER_HOST_UNSUPPORTED", `host ${input.platform}-${input.arch} is not a qualified launcher target`);
  return Object.freeze({ platform: platform as SupportedLauncherPlatform, arch: arch as SupportedLauncherArch });
}

function safeEnvironment(explicit?: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  if (explicit !== undefined) return { ...explicit, CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" };
  const result: NodeJS.ProcessEnv = { CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" };
  for (const key of ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE"]) {
    const value = process.env[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function positiveBound(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0)
    fail("VES_LAUNCHER_ARGUMENT_INVALID", "process budget must be a positive integer");
  return value;
}

function assertCleanArguments(args: readonly string[]): readonly string[] {
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string"))
    fail("VES_LAUNCHER_ARGUMENT_INVALID", "launcher arguments must be a string vector");
  if (args.some((argument) => argument.includes("\0")))
    fail("VES_LAUNCHER_ARGUMENT_INVALID", "launcher argument contains a null byte");
  return Object.freeze([...args]);
}

function assertAbsoluteExecutable(path: unknown, label: string): string {
  if (typeof path !== "string" || path.length === 0 || !isAbsolute(path) || path.includes("\0"))
    fail("VES_LAUNCHER_PATH_INVALID", `${label} must be an absolute contained path`);
  return resolve(path as string);
}

function containedComponentPath(releaseRoot: string, component: ActivationHealthComponentView): string {
  const target = resolve(releaseRoot, ...component.logicalPath.split("/"));
  const child = relative(releaseRoot, target);
  if (child.length === 0 || child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child))
    fail("VES_LAUNCHER_PATH_INVALID", `component ${component.componentId} escapes the activated release root`);
  return target;
}

function assertBundleView(bundle: unknown): ActivationHealthBundleView {
  if (
    !isRecord(bundle) ||
    typeof bundle["semanticVersion"] !== "string" ||
    typeof bundle["releaseDigest"] !== "string" ||
    !Array.isArray(bundle["components"]) ||
    (bundle["components"] as unknown[]).some(
      (component) =>
        !isRecord(component) ||
        typeof component["componentId"] !== "string" ||
        typeof component["kind"] !== "string" ||
        typeof component["logicalPath"] !== "string"
    )
  )
    fail("VES_LAUNCHER_RELEASE_INVALID", "activated release manifest is not a readable component closure");
  return bundle as unknown as ActivationHealthBundleView;
}

function uniqueComponent(
  bundle: ActivationHealthBundleView,
  predicate: (component: ActivationHealthComponentView) => boolean,
  message: string
): ActivationHealthComponentView {
  const matches = bundle.components.filter(predicate);
  if (matches.length !== 1) fail("VES_LAUNCHER_RELEASE_INVALID", message);
  return matches[0]!;
}

async function terminateTree(pid: number): Promise<void> {
  if (process.platform === "win32") {
    await execFileAsync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }).catch(() => undefined);
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    return;
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((settle) => setTimeout(settle, 25));
    try {
      process.kill(-pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      throw error;
    }
  }
  fail("VES_LAUNCHER_TERMINATION_INCOMPLETE", "launcher process group remained alive after termination");
}

async function observeChild(
  executable: string,
  args: readonly string[],
  limits: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly timeoutMs: number;
    readonly outputLimitBytes: number;
  }
): Promise<ChildObservation> {
  const captured: Buffer[] = [];
  let capturedBytes = 0;
  let totalBytes = 0;
  let timedOut = false;
  let outputLimitExceeded = false;
  let termination: Promise<void> | undefined;
  const child = spawn(executable, [...args], {
    cwd: limits.cwd,
    env: limits.env,
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const collect = (chunk: Buffer): void => {
    totalBytes += chunk.byteLength;
    const remaining = Math.max(0, limits.outputLimitBytes - capturedBytes);
    if (remaining > 0) {
      const part = chunk.subarray(0, remaining);
      captured.push(part);
      capturedBytes += part.byteLength;
    }
    if (totalBytes > limits.outputLimitBytes && !outputLimitExceeded) {
      outputLimitExceeded = true;
      termination ??= terminateTree(child.pid!);
    }
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  const timer = setTimeout(() => {
    timedOut = true;
    termination ??= terminateTree(child.pid!);
  }, limits.timeoutMs);
  const closed = await new Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>(
    (settle, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => settle({ code, signal }));
    }
  )
    .catch((error: unknown) =>
      fail("VES_LAUNCHER_PROCESS_FAILED", "the activated launcher could not be started", error)
    )
    .finally(() => clearTimeout(timer));
  await termination;
  return Object.freeze({
    exitCode: closed.code,
    signal: closed.signal,
    output: Buffer.concat(captured).toString("utf8"),
    timedOut,
    outputLimitExceeded
  });
}

function assertNormalTermination(observation: ChildObservation, componentId: string): void {
  if (observation.timedOut) fail("VES_LAUNCHER_TIMEOUT", `${componentId} exceeded its activation health budget`);
  if (observation.outputLimitExceeded)
    fail("VES_LAUNCHER_OUTPUT_EXCEEDED", `${componentId} produced more output than the health bound allows`);
  if (observation.signal !== null)
    fail("VES_LAUNCHER_SIGNAL_TERMINATED", `${componentId} was terminated by signal ${observation.signal}`);
  if (observation.exitCode !== 0)
    fail("VES_LAUNCHER_EXIT_NONZERO", `${componentId} exited with status ${String(observation.exitCode)}`);
}

function parseReportDocument(output: string, componentId: CanonicalLauncherId): Readonly<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch (error) {
    return fail("VES_LAUNCHER_HEALTH_REPORT_INVALID", `${componentId} did not emit one JSON health report`, error);
  }
  if (!isRecord(parsed) || !hasExactKeys(parsed, REPORT_KEYS))
    fail("VES_LAUNCHER_HEALTH_REPORT_INVALID", `${componentId} health report has missing or unknown fields`);
  return parsed as Readonly<Record<string, unknown>>;
}

function parseReportChecks(
  document: Readonly<Record<string, unknown>>,
  componentId: CanonicalLauncherId
): readonly Readonly<Record<string, unknown>>[] {
  const checks = document["checks"];
  if (
    !Array.isArray(checks) ||
    checks.length !== HEALTH_CHECK_NAMES.length ||
    checks.some((check) => !isRecord(check) || !hasExactKeys(check, CHECK_KEYS))
  )
    fail("VES_LAUNCHER_HEALTH_REPORT_INVALID", `${componentId} health report does not carry the three named checks`);
  const observed = checks as readonly Readonly<Record<string, unknown>>[];
  for (const name of HEALTH_CHECK_NAMES) {
    const check = observed.filter((entry) => entry["name"] === name);
    if (check.length !== 1)
      fail("VES_LAUNCHER_HEALTH_REPORT_INVALID", `${componentId} health report does not name ${name} exactly once`);
    if (check[0]!["status"] !== "pass")
      fail("VES_LAUNCHER_HEALTH_CHECK_FAILED", `${componentId} observed ${name} as not passing`);
  }
  return observed;
}

function parseLauncherReport(
  output: string,
  componentId: CanonicalLauncherId,
  bundle: ActivationHealthBundleView
): ObservedLauncherReport {
  const document = parseReportDocument(output, componentId);
  if (document["schemaVersion"] !== 1 || document["report"] !== "activation-health")
    fail("VES_LAUNCHER_HEALTH_REPORT_INVALID", `${componentId} did not emit a version 1 activation health report`);
  if (document["componentId"] !== componentId)
    fail("VES_LAUNCHER_HEALTH_RELEASE_MISMATCH", `${componentId} reported another component identity`);
  if (document["semanticVersion"] !== bundle.semanticVersion)
    fail("VES_LAUNCHER_HEALTH_RELEASE_MISMATCH", `${componentId} reported a version other than the staged release`);
  if (!isRecord(document["behavior"]))
    fail("VES_LAUNCHER_HEALTH_REPORT_INVALID", `${componentId} health report carries no behavior projection`);
  return Object.freeze({
    componentId,
    semanticVersion: bundle.semanticVersion,
    releaseDigest: bundle.releaseDigest,
    checks: parseReportChecks(document, componentId),
    behavior: document["behavior"]
  });
}

function evidenceFrom(reports: readonly ObservedLauncherReport[]): ObservedActivationHealth {
  if (reports.length !== CANONICAL_LAUNCHER_IDS.length)
    fail("VES_LAUNCHER_RELEASE_INVALID", "both canonical launchers must be observed");
  const first = reports[0]!;
  const second = reports[1]!;
  const behaviorEncoding = canonical(first.behavior, "behavior projection");
  if (canonical(second.behavior, "behavior projection") !== behaviorEncoding)
    fail("VES_LAUNCHER_HEALTH_DIVERGED", "canonical launchers observed different behavior");
  const checkFor = (report: ObservedLauncherReport, name: ActivationHealthCheckName) =>
    report.checks.find((entry) => entry["name"] === name)!;
  const checks = HEALTH_CHECK_NAMES.map((name) => {
    const encoding = canonical(checkFor(first, name), `${name} check`);
    if (canonical(checkFor(second, name), `${name} check`) !== encoding)
      fail("VES_LAUNCHER_HEALTH_DIVERGED", `canonical launchers observed different ${name} evidence`);
    return Object.freeze({ name, status: "pass" as const, evidenceDigest: sha256(encoding) });
  });
  const normalizedBehaviorDigest = sha256(behaviorEncoding);
  return Object.freeze({
    schemaVersion: 1 as const,
    checks: Object.freeze(checks),
    launchers: Object.freeze(
      reports.map((report) =>
        Object.freeze({
          componentId: report.componentId,
          exitCode: 0 as const,
          semanticVersion: report.semanticVersion,
          releaseDigest: report.releaseDigest,
          normalizedBehaviorDigest
        })
      )
    )
  });
}

/**
 * NPX-05. Observes activation health by running both canonical launchers from
 * the staged release bytes through that release's own hermetic Node runtime.
 * Nothing here synthesizes evidence: every digest is derived from what a real
 * child process printed, and any abnormal termination fails closed.
 *
 * Structurally satisfies `ActivationHealthGatePort` from
 * `packages/distribution/src/transactional-activation.ts`.
 */
export class NodeActivationHealthGate {
  readonly #timeoutMs: number;
  readonly #outputLimitBytes: number;
  readonly #environment: NodeJS.ProcessEnv;

  constructor(options: NodeActivationHealthGateOptions = {}) {
    this.#timeoutMs = positiveBound(options.timeoutMs, DEFAULT_TIMEOUT_MS);
    this.#outputLimitBytes = positiveBound(options.outputLimitBytes, DEFAULT_OUTPUT_LIMIT_BYTES);
    this.#environment = safeEnvironment(options.environment);
  }

  async evaluate(input: {
    readonly releaseRoot: string;
    readonly bundle: ActivationHealthBundleView;
  }): Promise<ObservedActivationHealth> {
    const releaseRoot = assertAbsoluteExecutable(input.releaseRoot, "activated release root");
    const bundle = assertBundleView(input.bundle);
    const runtime = uniqueComponent(
      bundle,
      (component) => component.kind === "node-runtime",
      "activated release has no unique hermetic Node runtime"
    );
    const runtimeExecutable = containedComponentPath(releaseRoot, runtime);
    const reports: ObservedLauncherReport[] = [];
    for (const componentId of CANONICAL_LAUNCHER_IDS) {
      const launcher = uniqueComponent(
        bundle,
        (component) => component.componentId === componentId && component.kind === "launcher",
        `activated release has no unique ${componentId} component`
      );
      const observation = await observeChild(
        runtimeExecutable,
        [containedComponentPath(releaseRoot, launcher), ACTIVATION_HEALTH_ARGUMENT],
        {
          cwd: releaseRoot,
          env: this.#environment,
          timeoutMs: this.#timeoutMs,
          outputLimitBytes: this.#outputLimitBytes
        }
      );
      assertNormalTermination(observation, componentId);
      reports.push(parseLauncherReport(observation.output, componentId, bundle));
    }
    return evidenceFrom(reports);
  }
}

/**
 * NPX-06. Transfers control to an already verified launcher path. Arguments
 * stay an argument vector from end to end — there is no shell, no command
 * string, and no interpolation — and the child's exit status or terminating
 * signal is the observable result.
 */
export class NodeVerifiedLauncherHandoff {
  readonly #environment: NodeJS.ProcessEnv | undefined;

  constructor(options: { readonly environment?: Readonly<Record<string, string>> } = {}) {
    this.#environment = options.environment === undefined ? undefined : { ...options.environment };
  }

  async execute(request: VerifiedLauncherHandoffRequest): Promise<VerifiedLauncherHandoffResult> {
    const runtimeExecutable = assertAbsoluteExecutable(request.runtimeExecutable, "hermetic runtime executable");
    const launcherPath = assertAbsoluteExecutable(request.launcherPath, "verified launcher path");
    const args = assertCleanArguments(request.args);
    const child = spawn(runtimeExecutable, [launcherPath, ...args], {
      shell: false,
      windowsHide: true,
      stdio: "inherit",
      ...(this.#environment === undefined ? {} : { env: this.#environment })
    });
    return await new Promise<VerifiedLauncherHandoffResult>((settle, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => settle(Object.freeze({ exitCode: code, signal })));
    }).catch((error: unknown) =>
      fail("VES_LAUNCHER_PROCESS_FAILED", "the verified launcher could not be started", error)
    );
  }
}
