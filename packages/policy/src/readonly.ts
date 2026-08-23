// The read-only observation surface of @verchestra/policy (DDL-12, #207). A
// caller that needs a live policy observation — deep doctor's cedar-policy
// probe (T14) — imports this subpath. Every entry below is a named
// re-export; nothing here forwards a whole module, so a symbol reaching this
// file must be a conscious, reviewed addition — the same discipline
// tests/architecture/doctor-readonly-graph.test.mjs already applies to the
// doctor composition root's own import allowlist.
//
// tests/architecture/policy-readonly-subpath.test.mjs statically proves this
// file's own export surface names no writer.

export { policyViewDigest, type PolicyView } from "./cedar-policy.ts";
export { verifyPolicyBundle, type PolicyBundle, type PolicyBundleCrypto } from "./policy-bundle.ts";
