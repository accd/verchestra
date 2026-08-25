import type { PinnedReleaseSource } from "./pinned-inputs.ts";
import type { LauncherHost } from "./supported-host.ts";

// NPX-03/NPX-06. The bootstrap owns the decision sequence; it does not own the
// TUF client, the activation manager, or the child process. Those live in
// qualified workspace packages that no published source may import, so the
// bootstrap states what it needs as a port and the build supplies the adapter.
//
// This file is part of the published surface, so it declares types only: no
// Node built-in, no third-party name, and nothing that could resolve at run
// time. A build that supplies no adapter fails closed rather than approximating
// a resolve, which is exactly what `VES_VESTRA_ACTIVATION_UNAVAILABLE` means.

/** A launcher the activation path has already verified, plus how to run it. */
export interface VerifiedLauncherTarget {
  readonly runtimeExecutable: string;
  readonly launcherPath: string;
  readonly releaseId: string;
  readonly semanticVersion: string;
}

/** The child's observable result: an exit status or a terminating signal. */
export interface LauncherHandoffOutcome {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface ActivationRequest {
  readonly host: LauncherHost;
  readonly source: PinnedReleaseSource;
  readonly trustedRoot: Uint8Array;
}

export interface HandoffRequest {
  readonly target: VerifiedLauncherTarget;
  readonly args: readonly string[];
}

/**
 * Resolves, verifies, and activates the pinned release, then transfers control
 * to it. Both operations either succeed completely or throw; neither returns a
 * partially verified result.
 */
export interface ActivationClosurePort {
  activate(request: ActivationRequest): Promise<VerifiedLauncherTarget>;
  handoff(request: HandoffRequest): Promise<LauncherHandoffOutcome>;
}
