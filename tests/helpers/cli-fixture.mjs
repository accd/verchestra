import { createHash } from "node:crypto";

export const releaseDigest = `sha256:${createHash("sha256").update("verchestra-1.0.0").digest("hex")}`;

export const manifest = (overrides = {}) => ({
  schemaVersion: 1,
  semanticVersion: "1.0.0",
  releaseDigest,
  minimumCliVersion: "1.0.0",
  commands: [
    {
      name: "init",
      summary: "Initialize a Workspace",
      supportsJson: true,
      mutating: true,
      options: [
        { name: "dry-run", kind: "boolean" },
        { name: "placement", kind: "string", values: ["colocated", "centralized", "mixed", "external-control"] }
      ]
    },
    { name: "bootstrap", summary: "Bootstrap this machine", supportsJson: true, mutating: true, options: [] },
    { name: "sync", summary: "Synchronize local state", supportsJson: true, mutating: true, options: [] },
    {
      name: "workspace reconcile",
      summary: "Reconcile Workspace topology",
      supportsJson: true,
      mutating: true,
      options: [{ name: "direction", kind: "string" }]
    },
    { name: "doctor", summary: "Inspect local health", supportsJson: true, mutating: false, options: [] }
  ],
  ...overrides
});

export class RecordingBus {
  calls = [];
  result = { data: { status: "ok" }, diagnostics: [] };

  async execute(command, context) {
    this.calls.push({ command, context });
    if (this.error !== undefined) throw this.error;
    return this.result;
  }
}

export function io() {
  const stdout = [];
  const stderr = [];
  return {
    stdout,
    stderr,
    ports: {
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value)
    }
  };
}
