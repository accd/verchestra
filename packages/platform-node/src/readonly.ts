// The read-only observation surface of @verchestra/platform-node (DDL-12,
// #207). A caller that needs a live subsystem observation — deep doctor's
// live probes (T12-T19) — imports this subpath instead of the package root,
// which re-exports genuine mutable and secret-handling adapters. Every entry
// below is a named re-export; nothing here forwards a whole module, so a
// symbol reaching this file must be a conscious, reviewed addition — the same
// discipline tests/architecture/doctor-readonly-graph.test.mjs already
// applies to the doctor composition root's own import allowlist.
//
// Symbol names, not English words, in the sibling architecture test's
// forbidden list (tests/architecture/platform-node-readonly-subpath.test.mjs)
// so this file's own prose cannot trip the guard.
//
// tests/architecture/platform-node-readonly-subpath.test.mjs statically
// proves this file's own export surface names no writer.

export { inspectRuntimeDatabase } from "./runtime-store/runtime-store.ts";
export { ProtectedPathBroker, type ProtectedPathHandle } from "./protected-path.ts";
