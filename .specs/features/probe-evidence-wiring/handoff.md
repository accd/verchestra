---
schema: verchestra-feature-handoff/v1
feature: probe-evidence-wiring
issue: 34
status: verification
branch: feat/probe-evidence-in-execution-package
baseRevision: e534c497d91e29cf95ed1dc5ad335bc2ecc2a0e3
lastCompletedTask: T2
nextTask: Independent verification and human review of the probe evidence pull request
lastGate: pnpm gate:security
updatedAt: 2026-07-30T11:40:00Z
---

# Scope

Deferred external-review item R8. `promoteProbeEvidence`
(`packages/data-probe/src/database-knowledge.ts`) was complete and well designed
but referenced nowhere outside its own package, so the read-only database state
that informed a plan never reached the sealed Execution Package. Wiring it in
closes the reproducibility promise: whoever resumes the package can verify the
same classified, redacted state the agent decided from.

# Completed Evidence

The architecture forced the shape. `packages/evidence` and
`packages/data-probe` are siblings in `docs/repository-map.md`, each allowed to
depend only on `contracts`, `domain`, and `application`. Neither may import the
other, so the package cannot hold a probe object and the probe cannot hold a
package. The reference is therefore pure data, and verification lives in
`application`, the only layer permitted to see both sides.

T1: `ExecutionPackagePayload` gains optional `probeEvidence`. Every field is a
digest, an opaque ref, a closed enum, or a count - deliberately no free text,
because a reference able to carry a string would be a way to smuggle a probed
value past the redaction data-probe already applied, and this payload is sealed
and travels. Validation rejects non-digests, undeclared classifications,
stringly booleans, negative or fractional claim counts, unknown fields, empty
lists, and repeated result digests. The redaction rule is enforced at seal time:
anything above `public` must already be redacted.

T2: `verifyProbeEvidence` in
`packages/application/src/execution/probe-evidence.ts` re-resolves each sealed
reference through a `ProbeEvidencePort` and reports four distinct failures -
`unresolvable`, `digest-mismatch`, `classification-changed`, and
`redaction-lost`. Every reference is checked and every failure reported, so one
bad probe cannot hide the others behind an early return. Malformed references
fail closed before the port is contacted at all.

Evidence: 28 tests in `tests/integration/probe-evidence-in-package.test.mjs`,
including that `probeEvidence` is covered by the package digest - without that,
a reference could be swapped after sealing and the whole promise would be
unenforceable. Discrimination sensor 8/8 KILLED: unredacted non-public evidence
accepted, undeclared classification accepted, redaction loss undetected, digest
change undetected, missing result passing silently, malformed reference reaching
the port, reclassification ignored, and `probeEvidence` omitted from the sealed
payload. `pnpm gate:full` PASS, `pnpm gate:security` PASS, `pnpm agent:check`
PASS.

# Next Exact Action

Independent verification and human review of the pull request. No qualification
report applies: R8 is a review item, not a roadmap task, so no
`docs/qualification/` document is required or permitted.

# Blockers

Merging. Every open pull request is authored by the sole code owner and the
ruleset requires an approving code-owner review, so no branch can satisfy it -
issue #126.

# Decisions

- The reference carries no free text. Digests, refs, closed enums, and counts
  only; anything else is a redaction bypass in a sealed artifact that travels.
- Non-public probe evidence must be redacted before it can be sealed, rather
  than being redacted later by a consumer that might forget.
- Reclassification after sealing fails closed. A probe that became restricted is
  not a probe the old plan was cleared for.
- Losing redaction is reported as `redaction-lost`, distinct from
  `digest-mismatch`, because a leak and a stale input need different responses.

# Files Intentionally Left Unchanged

- `packages/data-probe`: no producer change. `promoteProbeEvidence` already
  returns everything the reference needs; the missing piece was a consumer.
- The composition root. Wiring a real `ProbeEvidencePort` to the data-probe
  implementation belongs to #64, which owns the end-to-end vertical slice.
  Inventing that wiring here would put an untested edge in the release path.
