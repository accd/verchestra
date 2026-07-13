import type { InstalledCliManifest } from "./cli.ts";

export const installedReleaseManifest: InstalledCliManifest = Object.freeze({
  schemaVersion: 1,
  semanticVersion: "1.0.0",
  releaseDigest: "sha256:7694480949c03beef23af30826c127dcabd514307694480949c03beef23af308",
  minimumCliVersion: "1.0.0",
  commands: Object.freeze([
    Object.freeze({
      name: "init",
      summary: "Initialize a Workspace",
      supportsJson: true,
      mutating: true,
      options: Object.freeze([Object.freeze({ name: "dry-run", kind: "boolean" as const })])
    }),
    Object.freeze({
      name: "bootstrap",
      summary: "Bootstrap this machine",
      supportsJson: true,
      mutating: true,
      options: Object.freeze([])
    }),
    Object.freeze({
      name: "sync",
      summary: "Synchronize local state",
      supportsJson: true,
      mutating: true,
      options: Object.freeze([])
    }),
    Object.freeze({
      name: "workspace reconcile",
      summary: "Reconcile Workspace topology",
      supportsJson: true,
      mutating: true,
      options: Object.freeze([])
    }),
    Object.freeze({
      name: "doctor",
      summary: "Inspect local health",
      supportsJson: true,
      mutating: false,
      options: Object.freeze([])
    })
  ])
});
