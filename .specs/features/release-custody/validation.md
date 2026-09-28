# Release custody validation (#408)

The requirements are documentation requirements. The evidence for each one is
the file and line where the model states it, plus the executed tooling
rehearsal. This record does **not** evidence the #408 acceptance criteria that
need humans: ratification, the verified permission arrangement, the authorized
approval rehearsal, and accountable acceptance. Those stay open under
`handoff.md` `# Blockers`.

Base revision: `2500c6c4fe59479d893912b889efce337a6cbda1`.

## Requirement to evidence

| Requirement | Evidence |
| --- | --- |
| CUST-01 responsibilities, holders, targets, controls | `docs/release-custody.md:92` (offline root/targets), `:117` (online refresh, #382), `:134` (npm), `:157` (R2), `:176` (release decision), `:192` (T75 evidence), `:202` (merge approval), `:218` (recovery/rotation). Each section has **Current holder**, **Target model**, **Independent control**, and, where one exists, **Does not constrain**. |
| CUST-02 honest posture, no relabel, no promotion claim | `docs/release-custody.md:3-10` (status banner: proposed, single-operator custody, no promotion readiness, hold unchanged); `:283` (what does not change); `docs/merge-governance.md` break-glass pointer states the posture remains single-operator custody. |
| CUST-03 residual risks and the two-person rule | `docs/release-custody.md:26-52` (definition, and what does not count: two fields, two keys, in-process threshold, two secrets, two admins); `:240-281` (RR1 permanent `Repository admin` bypass through RR9). |
| CUST-04 control map per release effect | `docs/release-custody.md:229-238`. |
| CUST-05 revocation, rotation, emergency, retrospective | `docs/release-custody.md:291-367` (triggers, tracked issue first, custodian revocation, per-role rotation, recovery when a custodian is unavailable, independent retrospective). |
| CUST-06 rehearsal, disposable, exact commands, expected denials | `docs/release-custody.md:369-527`: tooling denials D1-D5 at `:426-430`, approval rehearsal G1-G6 at `:503-508`, recording rules at `:517`. |
| CUST-07 owner checklist with sanitized verification | `docs/release-custody.md:529-635` (O1-O10; every command projects names, logins, or settings only). |
| CUST-08 no secrets or local paths | The tracked files contain no key material, token, email, or machine-local path. The only key-shaped values in the document are generated at run time into a temporary directory and removed. `pnpm agent:check` passes. |

## Executed evidence (agent, 2026-09-29, at the base revision)

**Tooling denials (section 8.1).** The exact script block in
`docs/release-custody.md` section 8.1 was extracted and run with the pinned
Node 24.14.0:

```text
D1  VES_T76_PUBLISH_SIGNING_KEY_MISSING
D2  VES_T76_PUBLISH_KEY_MISMATCH
D3  VES_T76_PUBLISH_ANCHOR_MISSING
D4  VES_T76_PUBLISH_KEY_MISMATCH
D5  VES_T76_PUBLISH_INPUT_MISSING
no publication directory was created
```

Every result matches the expected column. D3 reflects the current state, in
which the online-key anchor is not committed. The keys were throwaway,
generated in memory, and deleted with the temporary directory. Nothing was
uploaded or published.

**Positive controls.** The four suites named in section 8.1 ran with
`node --test`: 51 tests, 51 pass, 0 fail, 0 skipped, 0 todo.

**Read-only posture queries (section 2).** The GitHub API reported:

- environments `copilot` (no rules) and `github-pages` (branch policy), both
  `can_admins_bypass: true`;
- collaborators `accd` (`admin`), `MiguelCorre` (`write`), and
  `brunomjanuario` (`write`);
- repository-level secret **names** `VESTRA_RELEASE_SIGNING_KEY_PKCS8_BASE64`
  and `VESTRA_T75_EVIDENCE_SIGNING_KEY_PKCS8_BASE64`;
- ruleset bypass `[{"actor_id":5,"actor_type":"RepositoryRole","bypass_mode":"always"}]`.

The npm registry reported one maintainer, `accd`, and no provenance
attestations on `0.0.0-qualification.2`. No secret value was read. The API does
not expose secret values.

## Not yet evidenced (owner or human action required)

- Ratification of the model by the owner and an independent reviewer (O10).
- The verified permission arrangement (O2, O4-O8).
- The authorized approval rehearsal G1-G6 (O9).
- Accountable human acceptance. Until all four exist, #408 stays open and L8
  stays as written.
