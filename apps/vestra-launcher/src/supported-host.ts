import { LauncherBootstrapError } from "./public-errors.ts";

// NPX-07. The public launcher cannot import a workspace package at runtime, so
// it re-states the qualified host set instead of sharing one. That duplication
// is deliberate and verified: an architecture test asserts this list and the
// platform-node adapter's `supportedLauncherHost` accept exactly the same
// targets, so they cannot drift apart silently.
export const SUPPORTED_LAUNCHER_PLATFORMS = Object.freeze(["win32", "linux", "darwin"] as const);
export const SUPPORTED_LAUNCHER_ARCHES = Object.freeze(["x64", "arm64"] as const);

export type LauncherPlatform = (typeof SUPPORTED_LAUNCHER_PLATFORMS)[number];
export type LauncherArch = (typeof SUPPORTED_LAUNCHER_ARCHES)[number];

export interface LauncherHost {
  readonly platform: LauncherPlatform;
  readonly arch: LauncherArch;
}

/**
 * Total, effect-free host decision. It runs before any filesystem read, any
 * network call, and any child process, so an unsupported host stops the
 * bootstrap before unverified code could execute.
 */
export function supportedHost(input: { readonly platform: string; readonly arch: string }): LauncherHost {
  const platform = SUPPORTED_LAUNCHER_PLATFORMS.find((candidate) => candidate === input.platform);
  const arch = SUPPORTED_LAUNCHER_ARCHES.find((candidate) => candidate === input.arch);
  if (platform === undefined || arch === undefined)
    throw new LauncherBootstrapError(
      "VES_VESTRA_HOST_UNSUPPORTED",
      `this release does not support ${input.platform}-${input.arch}`
    );
  return Object.freeze({ platform: platform as LauncherPlatform, arch: arch as LauncherArch });
}
