// invariant: SSI-73 and SSI-74 on the task path. What a Windows run needs
// from the machine is proven before its first transition, so a missing
// prerequisite is `not configured`, named, with no workflow change, worktree,
// or provider process behind it. The run then proves each again where it is
// used: the transport per channel, the driver per isolation directory and per
// launch, so a change made in between still refuses.
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

import type { BridgeChannel, BridgeTransport } from "@verchestra/agent-runtime";
import { documentedManagedPolicySources, managedPolicyPresent } from "@verchestra/drivers";
import { WindowsNamedPipeBridgeTransport, registryKeyPresent } from "@verchestra/platform-node";

import { notConfigured, stableCode } from "./task-errors.ts";
import { provenOwnerOnly } from "./task-implementer.ts";

// invariant: the prerequisites a transport names (`powershell-7`,
// `powershell-logging-off`, `owner-only-acl`) are fixed identifiers; nothing
// else becomes a requirement.
const REQUIREMENT = /^[a-z0-9]+(?:-[a-z0-9]+){0,7}$/u;

// invariant: everything the check needs from the machine. The node host is
// the only production one; a test hands a fake to observe the check anywhere.
export interface WindowsTaskHost {
  readonly bridgeTransport: () => BridgeTransport;
  readonly ownerOnly: (directory: string) => Promise<boolean>;
  readonly managedPolicyPresent: () => Promise<boolean>;
}

export const nodeWindowsTaskHost: WindowsTaskHost = Object.freeze({
  bridgeTransport: () => new WindowsNamedPipeBridgeTransport(),
  ownerOnly: provenOwnerOnly,
  managedPolicyPresent: () => managedPolicyPresent(documentedManagedPolicySources("win32"), registryKeyPresent)
});

export interface WindowsTaskPrerequisites {
  readonly platform: string;
  // The parent of every Claude Code isolation directory of the run.
  readonly sessionsRoot: string;
  // why: only a Claude Code session reaches the bridge, and only its
  // subscription profile refuses a managed policy (SSI-74).
  readonly claude: "none" | "api-key" | "subscription";
  readonly host?: WindowsTaskHost;
}

export async function requireWindowsPrerequisites(options: WindowsTaskPrerequisites): Promise<void> {
  if (options.platform !== "win32" || options.claude === "none") return;
  const host = options.host ?? nodeWindowsTaskHost;
  await requireBridgeChannel(host.bridgeTransport());
  await requireOwnerOnlySessions(options.sessionsRoot, host.ownerOnly);
  if (options.claude === "subscription" && (await host.managedPolicyPresent()))
    throw notConfigured(
      "claude-managed-policy",
      "A machine-wide Claude Code policy is present, so the subscription profile cannot prove its isolation"
    );
}

// why: the transport proves PowerShell 7, its logging policy, and the ACL of
// its own directory only by opening a channel, so one is opened and closed.
// No relay exists yet, so any connection is refused.
async function requireBridgeChannel(transport: BridgeTransport): Promise<void> {
  let channel: BridgeChannel;
  try {
    channel = await transport.listen((connection) => connection.destroy());
  } catch (error) {
    throw bridgeRefusal(error);
  }
  await channel.close();
}

// invariant: a transport's `not configured` keeps the prerequisite it named;
// any other refusal (a pipe name already taken, a helper that did not start)
// is the transport's own and is reported as it is.
function bridgeRefusal(error: unknown): unknown {
  const requirement = (error as { readonly requirement?: unknown } | undefined)?.requirement;
  if (stableCode(error) !== "VES_BRIDGE_NOT_CONFIGURED" || typeof requirement !== "string") return error;
  if (!REQUIREMENT.test(requirement)) return error;
  return notConfigured(requirement, "A prerequisite of the Windows bridge is missing", { cause: error });
}

// why: the driver proves each isolation directory owner-only as it creates it
// under the sessions root; a probe there shows the proof holds on that volume
// before the run begins, and is removed whatever the proof says.
async function requireOwnerOnlySessions(
  sessionsRoot: string,
  ownerOnly: (directory: string) => Promise<boolean>
): Promise<void> {
  await mkdir(sessionsRoot, { recursive: true, mode: 0o700 });
  const probe = await mkdtemp(join(sessionsRoot, "acl-probe-"));
  try {
    if (!(await ownerOnly(probe).catch(() => false)))
      throw notConfigured("owner-only-acl", "The sessions directory could not be proven owner-only");
  } finally {
    await rm(probe, { recursive: true, force: true });
  }
}
