import { readFileSync } from "node:fs";

import type { InstalledCliManifest } from "./cli.ts";

// The T76 candidate builder compiles the sealed release's semantic version
// into the bundled launcher with an esbuild `define` of this constant. In the
// repository it is never declared, so the `typeof` guard below reads
// "undefined" and dev mode is untouched; in a sealed bundle it is a string
// literal and the filesystem is never consulted.
declare const __VERCHESTRA_SEALED_SEMANTIC_VERSION__: string;

// The single source of truth for "is this module running inside a T76 sealed
// bundle rather than a repository checkout". Only the builder's esbuild
// `define` can make the guarded constant a string, so nothing at run time can
// claim sealed form it does not have. Everything that must resolve a file of
// its own release (release-layout.ts) asks here rather than keeping a second
// local copy of this test.
export function isSealedRelease(): boolean {
  return typeof __VERCHESTRA_SEALED_SEMANTIC_VERSION__ === "string";
}

// Ownership of the release identity is explicit and has exactly two sources.
// In source mode the repository root package.json owns the version, and there
// is no verified release artifact to bind a digest to, so releaseDigest is null
// rather than invented. In sealed (T76 candidate) form the build owns the
// version, injected at bundle time - not the repository package.json, which
// does not exist in a staged release layout. The launcher still reports no
// release digest: that digest covers a manifest containing the launcher's own
// content digest, so any compiled-in value would be circular (see the
// activation-health protocol note in
// packages/platform-node/src/activation-launcher-adapters.ts).
export function resolveReleaseIdentity(root = new URL("../../../", import.meta.url)): {
  semanticVersion: string;
  releaseDigest: string | null;
} {
  if (isSealedRelease()) {
    return { semanticVersion: __VERCHESTRA_SEALED_SEMANTIC_VERSION__, releaseDigest: null };
  }
  const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8")) as { version?: unknown };
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error("repository package.json does not declare a version");
  }
  return { semanticVersion: manifest.version, releaseDigest: null };
}

const identity = resolveReleaseIdentity();

export const installedReleaseManifest: InstalledCliManifest = Object.freeze({
  schemaVersion: 1,
  semanticVersion: identity.semanticVersion,
  releaseDigest: identity.releaseDigest,
  minimumCliVersion: identity.semanticVersion,
  commands: Object.freeze([
    Object.freeze({
      name: "init",
      summary: "Initialize a Workspace",
      supportsJson: true,
      mutating: true,
      options: Object.freeze([
        Object.freeze({ name: "dry-run", kind: "boolean" as const }),
        Object.freeze({ name: "workspace-id", kind: "string" as const }),
        Object.freeze({ name: "name", kind: "string" as const }),
        Object.freeze({
          name: "placement",
          kind: "string" as const,
          values: Object.freeze(["centralized", "colocated"])
        })
      ])
    }),
    Object.freeze({
      name: "self-test",
      summary: "Run a packaged Self-Test profile against a disposable, isolated trust domain",
      supportsJson: true,
      mutating: false,
      options: Object.freeze([
        Object.freeze({
          name: "profile",
          kind: "string" as const,
          values: Object.freeze(["smoke", "full", "workspace", "drivers"])
        })
      ])
    }),
    Object.freeze({
      name: "doctor",
      summary: "Run read-only deep diagnostics and emit a signed report",
      supportsJson: true,
      mutating: false,
      options: Object.freeze([Object.freeze({ name: "deep", kind: "boolean" as const })])
    })
  ])
});
