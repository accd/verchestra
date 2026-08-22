// The read-only observation surface of @verchestra/platform-node (DDL-12,
// #207). A caller that needs a live subsystem observation — deep doctor's
// live probes (T12-T19) — imports this subpath instead of the package root,
// which re-exports genuine mutable and secret-handling adapters. Every entry
// below is a named re-export or a function defined directly in this file;
// nothing here forwards a whole module, so a symbol reaching this file must
// be a conscious, reviewed addition — the same discipline
// tests/architecture/doctor-readonly-graph.test.mjs already applies to the
// doctor composition root's own import allowlist.
//
// Symbol names, not English words, in the sibling architecture test's
// forbidden list (tests/architecture/platform-node-readonly-subpath.test.mjs)
// so this file's own prose cannot trip the guard.
//
// tests/architecture/platform-node-readonly-subpath.test.mjs statically
// proves this file's own export surface names no writer.

export { ProtectedPathBroker, type ProtectedPathHandle } from "./protected-path.ts";

// Deferred, not a static re-export: node:sqlite prints an experimental-feature
// warning to stderr the moment anything imports it, and runtime-store.ts
// imports node:sqlite at its own top level. This file is loaded on every CLI
// invocation (apps/vestra-cli/src/main.ts imports doctor-composition.ts
// unconditionally), so a static re-export here would print that warning for
// every command — including ones that never touch the doctor or SQLite at
// all (tests/e2e/cli-launchers-e2e.test.mjs's byte-equal stderr comparison
// caught exactly this while building T12). The dynamic import below defers
// loading runtime-store.ts — and paying that cost — until a live probe
// actually calls this function. tests/architecture/doctor-readonly-graph.test.mjs's
// transitive closure walker recognizes this form of import edge too, so the
// property it proves does not quietly weaken.
export async function inspectRuntimeDatabase(
  path: string,
  options: { readonly assertExtensionsDisabled?: boolean } = {}
): Promise<{ readonly integrity: "ok"; readonly runs: number; readonly migrations: number }> {
  const { inspectRuntimeDatabase: real } = await import("./runtime-store/runtime-store.ts");
  return real(path, options);
}

import type { SecretAdapter } from "./secret-broker.ts";
export type { SecretAdapter };

// Presence only (DDL-09): calls SecretAdapter.has directly, never the
// handle-minting method the broker in the sibling module exposes, which is a
// side effect, not an observation. That broker exposes no read-only presence
// method of its own, so a doctor probe must go through the adapter interface.
export async function secretPresence(
  adapter: SecretAdapter,
  workspaceId: string,
  logicalName: string
): Promise<boolean> {
  return adapter.has(workspaceId, logicalName);
}
