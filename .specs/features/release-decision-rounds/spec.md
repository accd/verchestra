# Release decision rounds (#18)

`docs/qualification/release-decision-1.0.0.md` is a signed **reject**, a
recorded hold. It, `docs/release-custody.md`, and the status surfaces say a
future promote round decides on a fresh candidate with its own decision file.
Until this feature, `RELEASE-DECISION-CONTRACT.md` said "There is at most one
per version", and `readReleaseDecisions` in `scripts/agent-readiness.mjs`
refused a second 1.0.0 file. The only way to record a later decision was to
replace the signed hold, which erases accountable history. This feature lets a
version have a later **round** that supersedes an earlier reject without ever
editing or deleting the earlier signed file.

## Requirements

- **RDR-01. Round 1 is unchanged.** Round 1 stays
  `release-decision-<version>.md` with no round fields. The committed 1.0.0
  file validates unchanged, byte for byte, and its signature still verifies.
- **RDR-02. A later round has its own name.** Round _n_ ≥ 2 is
  `release-decision-<version>.round-<n>.md`, with _n_ written without leading
  zeros. A `.round-1` or zero-padded suffix, and any `release-decision-*.md`
  outside the convention, fail closed instead of being skipped.
- **RDR-03. The round fields bind to the name.** Round _n_ ≥ 2 carries
  `round: <n>`, `supersedes`, and `supersedesDigest: sha256:<64 hex>`. A
  frontmatter `round` that disagrees with the filename's round fails closed. A
  round 1 file carrying any of the three fields fails closed.
- **RDR-04. The signature covers the round fields.** The signed body is every
  frontmatter field except `signature`, plus the body digest, so a verifier
  that ignored a round field would accept a signature this one refuses.
- **RDR-05. One linear history per version.** At most one file per version and
  round; a round whose round _n − 1_ is missing (a gap, or no round 1) fails
  closed.
- **RDR-06. A promote is final.** Any round after a `promote` fails closed.
- **RDR-07. A round supersedes only its immediate predecessor.** `supersedes`
  must be `release-decision-<version>.md` for round 2 and
  `release-decision-<version>.round-<n-1>.md` after that.
- **RDR-08. Earlier rounds are immutable.** `supersedesDigest` must equal the
  sha256 of the superseded file's current bytes, so editing an earlier round,
  even in a way its own signature does not see, breaks the next round.
- **RDR-09. A later round is decided later.** `decidedAt` must be strictly
  later than the previous round's.
- **RDR-10. A later round decides on a fresh candidate.** `candidateRevision`
  must differ from the previous round's, and the previous round's candidate
  must be an ancestor of it, read through the same `git merge-base
--is-ancestor` seam as the existing reachability check.
- **RDR-11. Every round is validated in full.** Every existing per-file rule
  (schema, trusted revision, gate, register, chain, three distinct identities,
  signature, `reviewedIn`) applies to every round.
- **RDR-12. The effective decision is the highest valid round; history stays
  visible.** `readReleaseDecisions` maps each version to its effective
  decision and to every round's history.
- **RDR-13. Consumers use the effective decision.** Every consumer of
  `readReleaseDecisions` reads the round-aware result.
- **RDR-14. The contract states rounds.** `RELEASE-DECISION-CONTRACT.md`
  replaces "at most one per version", documents the round frontmatter, adds a
  fail-closed row per new rule, says rounds do not make a promote easier, and
  marks the "As of this contract's introduction" sentence historical without
  deleting it.
- **RDR-15. No enforcement is weakened.** The existing test "a version may
  have at most one decision file" keeps its assertion for two files claiming
  the same version and round. No existing assertion is removed or loosened.

## Design

The interface stays `validateReleaseDecision(source, version, options)` and
`readReleaseDecisions(root, options)`. The implementation deepens behind them;
no consumer gains a second seam.

1. **Per-file rules stay in `validateReleaseDecision`.** It takes
   `options.round` (default 1), names errors by the round's file name, and adds
   `checkDecisionRound` (RDR-03, RDR-07, the digest's form). These checks need
   only the file and its name.
2. **Succession rules live in `settleDecisionRounds`.** They need the
   predecessor's bytes and fields (RDR-05 to RDR-10), so `readReleaseDecisions`
   reads each round once as a `Buffer`, hashes those exact bytes, decodes the
   same bytes for validation, and groups rounds by version.
3. **Rounds are grouped by the round the file declares.** This mirrors how
   versions were already grouped by the version the file declares: a file
   whose name and frontmatter disagree still collides with the file that
   rightfully holds that round, rather than slipping past the duplicate rule.
4. **Descent uses the existing seam.** `revisionTrust` gains `isAncestor`, and
   `isTrustedRevision` is now written in terms of it, so reachability and
   descent are one Git fact read one way. Revisions are compared only after
   they parse as full commit ids, so no frontmatter value reaches `git` as an
   option.
5. **Refinement: the effective decision is the highest round whose whole
   predecessor chain is valid**, not the highest round that is valid on its
   own. A round binds to its predecessor's bytes; a round above a gap or above
   an invalid round stands on nothing, so it must never take effect. This is
   the conservative reading of "highest valid round", and it means a promote
   can never take effect on top of a broken chain.
6. **Refinement: misnamed decision files are reported.** The brief's
   "filename round that disagrees" case includes names the pattern cannot
   read (`.round-1`, `.round-02`, `.round2`). The qualification-report reader
   already reports a task-shaped file named outside its convention for the
   same reason: silent non-discovery would let a later round sit on disk while
   an earlier one stays in effect.
7. **`decidedAt` ordering** parses only values that already match the RFC 3339
   UTC pattern, and compares them at millisecond precision. An unparseable
   instant, or two instants in the same millisecond, fail closed.
8. **Consumers (RDR-13).** `readReleaseDecisions` has exactly one consumer:
   `checkReleaseDecisions` in `checkRepository` (`pnpm agent:check`), which
   reads its errors. `compileAgentContext` (`pnpm agent:context`), the site
   loader (`apps/site/src/lib/repository-docs-loader.ts`, which projects only
   `t<NN>-validation.md` reports), and the status surfaces (`AGENTS.md`,
   `llms.txt`, `ROADMAP.md`, `.specs/STATE.md`, the site's
   `current-qualification-status.md`) do not read decision files; they are
   prose, checked by `agent:check` only for version and task status. No
   surface lists decisions today, so the history is exposed in the
   `readReleaseDecisions` result (`rounds`) for the first consumer that does.
   The site does not project the contract (it links to it on GitHub), so no
   site source changes.

## Out of scope

- Any round-2 decision file in the repository. Tests use temporary fixtures.
- `release-decision-1.0.0.md`, `docs/release-custody.md`,
  `docs/merge-governance.md`, `acceptance-matrix.md`, and every qualification
  report.
- Promotion mechanics beyond the decision (the `stale version` check, the
  package version, the five-target release digest).
