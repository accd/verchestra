import { ProbeProtocolError } from "./probe-protocol.ts";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,511}$/u;
// invariant: product workers own this namespace. A workspace extension that
// claims it could otherwise pass the product handshake pin by name alone.
const PRODUCT_COMPONENT_NAMESPACE = "probe-worker:";
const PROBE_CAPABILITIES = new Set(["database-read"]);
// why: the out-of-process host implements exactly the `process-contained` grade of
// the isolation policy (docs/qualification/isolation.md). A grant that names a
// stronger grade asks for controls this host does not provide, so it is refused
// rather than silently downgraded.
const HOST_ISOLATION_PROFILE = "process-contained";
// why: the isolation policy refuses `high-untrusted-executable` work under
// `process-contained` (selectIsolationProfile, VES_STRONG_ISOLATION_UNAVAILABLE).
// The controller must therefore classify the worker explicitly; only code that
// a human approved by digest in a signed lock may run on this host.
const HOST_RISK = "approved-workspace-executable";

function deny(code: string, message: string): never {
  throw new ProbeProtocolError(code, message);
}

// why: the product port of the qualified isolation-policy rule
// (spikes/isolation/src/isolation-policy.mjs). Executable behavior never rides a
// Skill; it must be reclassified as a Tool or Plugin and carry an explicit
// controller grant. Codes are identical to the qualified rule.
export function authorizeSkillExecution(input: {
  readonly kind: string;
  readonly requestsExecution: boolean;
  readonly explicitGrant: boolean;
}): { readonly authorized: boolean; readonly authority: "none" | "controller-grant" } {
  if (!input.requestsExecution) return Object.freeze({ authorized: false, authority: "none" });
  if (input.kind !== "tool" && input.kind !== "plugin")
    deny("VES_SKILL_EXECUTION_RECLASSIFY", "Executable behavior must be classified as a Tool or Plugin");
  if (input.explicitGrant !== true) deny("VES_EXECUTION_GRANT_REQUIRED", "Controller execution grant is required");
  return Object.freeze({ authorized: true, authority: "controller-grant" });
}

// invariant: the shape GovernedSkillRegistry.resolveExecutableExtension returns is the
// only admitted source of a workspace worker identity: a signed skill lock entry
// whose executable content is pinned by digest and whose extensionRef carries a
// human approval reference.
export interface WorkspaceProbeWorkerExtension {
  readonly lockDigest: string;
  readonly skillId: string;
  readonly extensionRef: { readonly kind: string; readonly id: string; readonly approvalRef: string };
  readonly entry: { readonly path: string; readonly digest: string };
}

export interface WorkspaceProbeWorkerRequest {
  readonly skillId: string;
  readonly extensionId: string;
  readonly entryPath: string;
}

// invariant: the registry the composition root wires. GovernedSkillRegistry
// satisfies it, and verifies the lock's digest and signatures before it answers.
export interface WorkspaceProbeWorkerExtensions<Lock> {
  resolveExecutableExtension(lock: Lock, request: WorkspaceProbeWorkerRequest): Promise<WorkspaceProbeWorkerExtension>;
}

// invariant: what a human approved for one extension: its entry's bytes and the
// exact launch that runs them (probeLaunchDigest in platform-node).
export interface WorkspaceProbeWorkerApproval {
  readonly approvalRef: string;
  readonly extensionId: string;
  readonly componentDigest: string;
  readonly launchDigest: string;
}

// invariant: an adapter answers only with an approval it verified, that is not
// revoked and has not expired; for anything else it answers undefined. Where
// approvals are issued and stored is the host's T3 decision.
export interface WorkspaceProbeWorkerApprovals {
  lookup(approvalRef: string): Promise<WorkspaceProbeWorkerApproval | undefined>;
}

// invariant: issued by the controller, never by the worker: every field binds the grant to
// one Workspace, one locked extension, one approval, one executable digest and one launch.
export interface WorkspaceProbeWorkerGrant {
  readonly grantRef: string;
  readonly workspaceId: string;
  readonly lockDigest: string;
  readonly extensionId: string;
  readonly approvalRef: string;
  readonly componentDigest: string;
  readonly launchDigest: string;
  readonly capabilities: readonly string[];
  readonly isolationProfile: string;
  readonly risk: string;
}

export interface WorkspaceProbeWorkerTrust {
  readonly kind: "workspace";
  readonly workspaceId: string;
  readonly componentId: string;
  readonly componentDigest: string;
  readonly launchDigest: string;
  readonly approvalRef: string;
  readonly grantRef: string;
  readonly lockDigest: string;
  readonly capabilities: readonly string[];
}

// invariant: the supervisor accepts only trust values minted here. A structurally
// identical object literal is not admitted, so the workspace variant cannot be
// reached by constructing its shape.
const admitted = new WeakSet<object>();

export function isAdmittedWorkspaceTrust(value: unknown): value is WorkspaceProbeWorkerTrust {
  return typeof value === "object" && value !== null && admitted.has(value);
}

function wellFormed(extension: WorkspaceProbeWorkerExtension): boolean {
  return (
    [extension.lockDigest, extension.entry?.digest].every((value) => DIGEST.test(String(value))) &&
    [extension.extensionRef.id, extension.extensionRef.approvalRef].every((value) => SAFE.test(String(value)))
  );
}

function checkExtension(extension: WorkspaceProbeWorkerExtension | undefined): WorkspaceProbeWorkerExtension {
  if (extension === undefined || extension === null || typeof extension !== "object")
    deny("VES_PROBE_WORKSPACE_TRUST_DENIED", "Workspace Probe worker has no locked extension");
  const reference = extension.extensionRef;
  if (typeof reference?.approvalRef !== "string" || reference.approvalRef.length === 0)
    deny("VES_PROBE_WORKSPACE_TRUST_APPROVAL", "Workspace Probe worker requires an approval reference");
  if (!wellFormed(extension)) deny("VES_PROBE_WORKSPACE_TRUST_INVALID", "Workspace Probe worker extension is invalid");
  if (reference.id.startsWith(PRODUCT_COMPONENT_NAMESPACE))
    deny("VES_PROBE_WORKSPACE_TRUST_NAMESPACE", "Workspace Probe worker claims the product component namespace");
  return extension;
}

function approvalNames(approval: WorkspaceProbeWorkerApproval, extension: WorkspaceProbeWorkerExtension): boolean {
  return (
    approval.approvalRef === extension.extensionRef.approvalRef &&
    approval.extensionId === extension.extensionRef.id &&
    approval.componentDigest === extension.entry.digest &&
    DIGEST.test(String(approval.launchDigest))
  );
}

function checkApproval(
  approval: WorkspaceProbeWorkerApproval | undefined,
  extension: WorkspaceProbeWorkerExtension
): WorkspaceProbeWorkerApproval {
  if (approval === undefined || approval === null || typeof approval !== "object")
    deny("VES_PROBE_WORKSPACE_TRUST_APPROVAL", "Workspace Probe worker approval is not on record");
  if (!approvalNames(approval, extension))
    deny("VES_PROBE_WORKSPACE_TRUST_APPROVAL", "Workspace Probe worker approval names another extension or launch");
  return approval;
}

function grantBinds(
  grant: WorkspaceProbeWorkerGrant | undefined,
  workspaceId: string,
  extension: WorkspaceProbeWorkerExtension,
  approval: WorkspaceProbeWorkerApproval
): boolean {
  if (grant === undefined || grant === null || typeof grant !== "object") return false;
  if (grant.workspaceId !== workspaceId)
    deny("VES_PROBE_WORKSPACE_TRUST_WORKSPACE", "Workspace Probe worker grant belongs to another Workspace");
  if (grant.approvalRef !== extension.extensionRef.approvalRef)
    deny("VES_PROBE_WORKSPACE_TRUST_APPROVAL", "Workspace Probe worker grant names another approval");
  return (
    SAFE.test(String(grant.grantRef)) &&
    grant.lockDigest === extension.lockDigest &&
    grant.extensionId === extension.extensionRef.id &&
    grant.componentDigest === extension.entry.digest &&
    grant.launchDigest === approval.launchDigest
  );
}

function checkIsolation(grant: WorkspaceProbeWorkerGrant): void {
  if (grant.risk === "high-untrusted-executable")
    deny(
      "VES_STRONG_ISOLATION_UNAVAILABLE",
      "High-risk untrusted executable work requires native or container isolation"
    );
  if (grant.risk !== HOST_RISK)
    deny("VES_PROBE_WORKSPACE_TRUST_INVALID", "Workspace Probe worker grant risk classification is invalid");
  if (grant.isolationProfile !== HOST_ISOLATION_PROFILE)
    deny("VES_ISOLATION_PROFILE_UNAVAILABLE", "Requested isolation profile is unavailable on this host");
}

function grantedCapabilities(grant: WorkspaceProbeWorkerGrant): readonly string[] {
  checkIsolation(grant);
  const capabilities = Array.isArray(grant.capabilities) ? grant.capabilities : [];
  if (capabilities.length === 0 || capabilities.some((capability) => !PROBE_CAPABILITIES.has(capability)))
    deny("VES_PROBE_WORKSPACE_TRUST_CAPABILITY", "Workspace Probe worker grant capability is not permitted");
  return Object.freeze([...capabilities]);
}

// invariant: admission resolves the extension and looks its approval up itself,
// through the ports the composition root wires; it never takes an extension a
// caller built (#569, PHC-03, PHC-04). Denied by default: an unresolved
// extension, an approval that is absent or names another extension or launch, an
// absent or unbound grant, a foreign Workspace, the product namespace, and any
// isolation grade other than the one this host implements all fail before a
// worker can be negotiated.
export class WorkspaceProbeAdmission<Lock> {
  readonly #extensions: WorkspaceProbeWorkerExtensions<Lock>;
  readonly #approvals: WorkspaceProbeWorkerApprovals;

  constructor(ports: {
    readonly extensions: WorkspaceProbeWorkerExtensions<Lock>;
    readonly approvals: WorkspaceProbeWorkerApprovals;
  }) {
    this.#extensions = ports.extensions;
    this.#approvals = ports.approvals;
  }

  async admit(input: {
    readonly workspaceId: string;
    readonly lock: Lock;
    readonly request: WorkspaceProbeWorkerRequest;
    readonly grant?: WorkspaceProbeWorkerGrant;
  }): Promise<WorkspaceProbeWorkerTrust> {
    if (!SAFE.test(String(input.workspaceId)))
      deny("VES_PROBE_WORKSPACE_TRUST_INVALID", "Workspace Probe worker Workspace is invalid");
    const extension = checkExtension(await this.#extensions.resolveExecutableExtension(input.lock, input.request));
    const approval = checkApproval(await this.#approvals.lookup(extension.extensionRef.approvalRef), extension);
    authorizeSkillExecution({
      kind: extension.extensionRef.kind,
      requestsExecution: true,
      explicitGrant: grantBinds(input.grant, input.workspaceId, extension, approval)
    });
    const grant = input.grant as WorkspaceProbeWorkerGrant;
    const trust: WorkspaceProbeWorkerTrust = Object.freeze({
      kind: "workspace",
      workspaceId: input.workspaceId,
      componentId: extension.extensionRef.id,
      componentDigest: extension.entry.digest,
      launchDigest: approval.launchDigest,
      approvalRef: extension.extensionRef.approvalRef,
      grantRef: grant.grantRef,
      lockDigest: extension.lockDigest,
      capabilities: grantedCapabilities(grant)
    });
    admitted.add(trust);
    return trust;
  }
}
