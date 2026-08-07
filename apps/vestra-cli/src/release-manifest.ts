import { readFileSync } from "node:fs";

import type { InstalledCliManifest } from "./cli.ts";

// Ownership of the release identity is explicit and has exactly two sources.
// In source mode the repository root package.json owns the version, and there
// is no verified release artifact to bind a digest to, so releaseDigest is null
// rather than invented. Once T76 produces a verified release candidate, a
// generated manifest shipped beside the binary owns both, and the digest is
// bound to that artifact.
export function resolveReleaseIdentity(root = new URL("../../../", import.meta.url)): {
  semanticVersion: string;
  releaseDigest: string | null;
} {
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
