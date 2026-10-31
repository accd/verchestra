# Doctor scoped verdict verification

**Verdict**: PASS
**Profile**: light
**Diff range**: fcbf126b8f417e20abb7ded43d89e492445baf56..5a669d364d9cfd25dedf6bfa8b8649d01c6f0722
**Round**: 1 - full
**Verifier**: independent sub-agent (author != verifier)

Base confirmed: `git rev-parse origin/main` = `fcbf126b8f417e20abb7ded43d89e492445baf56`
(the dispatch brief spelled it `fcbf126bc0d2...`, which is not a valid revision; the
range above is the real one). HEAD = `5a669d36`, 5 commits ahead, worktree clean.

All proofs ran in one batched invocation at HEAD:

```
node --test --test-reporter=spec --test-name-pattern="<17 named proofs>" \
  tests/unit/doctor-not-offered.test.mjs tests/contract/doctor-report.test.mjs \
  tests/e2e/doctor-cli-e2e.test.mjs tests/integration/doctor-sentinel-bracket.test.mjs \
  tests/agent-readiness/doctor-docs.test.mjs
```

exit 0 - tests 19, pass 19, fail 0 (the `doctor-report@2` pattern matched three tests).
Every named test appears individually with a check mark; each is new or edited in the diff.

## Checks

| Check | Claim | Proof run | Evidence | Result |
| --- | --- | --- | --- | --- |
| C1 | six not-offered checks, absent -> `not-offered`, no remediation | `an absent not-offered subsystem is not-offered with no remediation` passed | `tests/unit/doctor-not-offered.test.mjs:66` - `assert.equal(fact.status, "not-offered", checkId)`; `:67` - `assert.equal(fact.remediationCode, undefined, checkId)` (loop over all 6, `:64`) | PASS |
| C2 | six offered checks, absent -> `blocked` with registered remediation | `an absent offered subsystem stays blocked with its remediation` passed | `tests/unit/doctor-not-offered.test.mjs:75` - `assert.equal(fact.status, "blocked", checkId)`; `:76` - `assert.equal(fact.remediationCode, DOCTOR_REMEDIATION_BY_CHECK[checkId], checkId)` | PASS |
| C3 | offered pass + not-offered only -> `PASS`, exit 0 | `not-offered checks alone leave the verdict PASS and exit 0` passed | `tests/unit/doctor-not-offered.test.mjs:82` - `assert.equal(report["doctor.verdict"], "PASS")`; `:83` - `assert.equal(doctorExitCode(report["doctor.verdict"]), 0)` | PASS |
| C4 | `not_offered_capabilities` exact sorted list; blocked and remediation empty | `not-offered capabilities are listed apart from blocked ones` passed | `tests/unit/doctor-not-offered.test.mjs:91` - `assert.deepEqual(report["doctor.not_offered_capabilities"], ["connectors.available", ... "state.durable"])`; `:99` - `assert.deepEqual(report["doctor.blocked_capabilities"], [])`; `:100` - `assert.deepEqual(report["doctor.remediation_codes"], [])` | PASS |
| C5 | `doctor-report@2` registered, validates scoped PASS, rejects missing field | `doctor-report@2 is registered and validates a scoped PASS report`, `doctor-report@2 rejects a report without the not-offered capability list` passed | `tests/contract/doctor-report.test.mjs:151` - `assert.ok(registry.list().includes("doctor-report@2"))`; `:152` - `assert.deepEqual(registry.validate("doctor-report", "2", scopedPass), scopedPass)`; `:158` - `assert.throws(() => registry.validate("doctor-report", "2", copy), { code: "VES_SCHEMA_VALIDATION_FAILED", schema: "doctor-report@2" })` | PASS |
| C6 | CLI `doctor --deep --output json` validates against @2; contract-schema passes | `doctor --deep emits a JSON report that validates against doctor-report@2` passed | `tests/e2e/doctor-cli-e2e.test.mjs:64` - `assert.doesNotThrow(() => registry.validate("doctor-report", "2", output.data))`; `:65` - `assert.ok(output.data["doctor.check_codes"].includes("doctor.contract-schema:pass"))` | PASS |
| C7 | sealed artifact names `doctor-report` version 2 | `the sealed report names doctor-report version 2` passed | `tests/integration/doctor-sentinel-bracket.test.mjs:95` - `assert.deepEqual(result.artifact.schema, { name: "doctor-report", version: 2 })` | PASS |
| C8 | six not-offered checks, present and healthy -> `pass` | `a provisioned not-offered subsystem passes` passed | `tests/unit/doctor-not-offered.test.mjs:107` - `assert.equal(fact.status, "pass", checkId)`; `:108` - `assert.equal(fact.remediationCode, undefined, checkId)` | PASS |
| C9 | six not-offered checks, present but unhealthy -> `fail` with remediation; verdict FAIL, exit 1 | `an unhealthy not-offered subsystem fails with its remediation` passed | `tests/unit/doctor-not-offered.test.mjs:115` - `assert.equal(fact.status, "fail", checkId)`; `:116` - `assert.equal(fact.remediationCode, DOCTOR_REMEDIATION_BY_CHECK[checkId], checkId)`; `:118` - `assert.equal(report["doctor.verdict"], "FAIL", checkId)`; `:119` - `assert.equal(doctorExitCode(report["doctor.verdict"]), 1, checkId)` | PASS |
| C10 | one offered blocked + six not-offered -> `BLOCKED`, exit 4 | `a blocked offered check still makes the verdict BLOCKED and exit 4` passed | `tests/unit/doctor-not-offered.test.mjs:126` - `assert.equal(report["doctor.verdict"], "BLOCKED")`; `:127` - `assert.equal(doctorExitCode(report["doctor.verdict"]), 4)` | PASS |
| C11 | bare source dir -> CLI `BLOCKED`, exit 4, six `:not-offered` codes | `a bare source machine reports BLOCKED and exits 4` passed | `tests/e2e/doctor-cli-e2e.test.mjs:72` - `assert.equal(report["doctor.verdict"], "BLOCKED")`; `:73` - `assert.equal(result.status, 4)`; `:78` - `assert.ok(report["doctor.check_codes"].includes(\`${checkId}:not-offered\`), checkId)` (loop over 6) | PASS |
| C12 | human renderer prints every JSON check code incl. not-offered, same verdict | `the human and JSON renderers project the same verdict and checks` passed | `tests/e2e/doctor-cli-e2e.test.mjs:86` - `assert.match(human, new RegExp(\`doctor\\.verdict: ${json["doctor.verdict"]}\`, "u"))`; `:87` - `for (const code of json["doctor.check_codes"]) assert.ok(human.includes(code), code)`; `:88` - `assert.ok(json["doctor.check_codes"].some((code) => code.endsWith(":not-offered")))` | PASS |
| C13 | `not-offered` outside the set, or with remediation, fails closed | `not-offered is closed to the declared checks and carries no remediation` passed | `tests/unit/doctor-not-offered.test.mjs:138` - `assert.throws(() => buildDoctorReport(facts, 1), { code: "VES_DOCTOR_CHECK_FACT_INVALID" }, checkId)` (outside set, 6 ids); `:147` - same expression (with remediation, 6 ids) | PASS |
| C14 | `doctor-report@1` stays registered and validates passing/blocked reports | `doctor-report@1 is a registered canonical schema`, `validates a blocked diagnostic report with remediation` passed | `tests/contract/doctor-report.test.mjs:27` - `assert.ok(registry.list().includes("doctor-report@1"))`; `:35` - `assert.deepEqual(registry.validate("doctor-report", "1", blocked), blocked)` | PASS |
| C15 | README, quick start, site install page state PASS and name the six | `the docs say a healthy installation reports PASS and name what is not offered` passed | `tests/agent-readiness/doctor-docs.test.mjs:23` - `assert.match(text, /healthy installation[^.]*reports \`PASS\`/u, ...)`; `:30` - `assert.ok(text.includes(\`\\\`${capability}\\\`\`), ...)` (3 pages x 6 capabilities) | PASS |
| C16 | quick start no longer calls `BLOCKED` expected | `the quick start no longer calls BLOCKED expected` passed | `tests/agent-readiness/doctor-docs.test.mjs:36` - `assert.doesNotMatch(guide, /\`BLOCKED\` is its expected verdict/u)`; `:37` - `assert.doesNotMatch(guide, /set up only for \`task\`, \`BLOCKED\`/u)` | PASS |

## Level and sampling

- Table-driven claims over six members (C1, C2, C8, C9, C13) each loop over all six ids, not a sample.
- `exit 0` and `exit 1` are proven at the `doctorExitCode` layer only (C3, C9); `apps/vestra-cli/src/main.ts:94` confirms `doctorExitCode(run.verdict)` is the sole mapping, so this is accepted as declared in `checks.md`. `exit 4` is crossed at the CLI boundary (C11).
- Precision gap (low): AC 5 says `doctor.contract-schema` passes **only when** `@2` is registered. C6 proves the positive side; no test drives a registry lacking `@2` to show the check then does not pass. The code is direct (`apps/vestra-cli/src/doctor-composition.ts:178`, `registry.list().includes("doctor-report@2")`).
- C8 relies on the `probes()` helper default being `healthy` (`tests/unit/doctor-not-offered.test.mjs:42`); it passes the healthy observation explicitly via `factFor`, so the assertion is genuine.

## Swept rows marked existing

- concurrency: `tests/integration/doctor-sentinel-bracket.test.mjs` - the diff only appends a new test after line 83; the existing bracket tests (incl. the ordering assertion `assert.deepEqual(order, ["before-capture", "probe-start", "probe-end", "after-capture"])`) are unchanged. Constraint present.
- dependency failure: `packages/application/src/doctor/doctor-facts.ts:71` - `setTimeout(() => rejectObservation(new Error("doctor probe timed out")), DOCTOR_PROBE_TIMEOUT_MS)`; the comment at `:91` records a rejecting/timed-out probe as present-but-unhealthy. The new not-offered branch (`:56`) fires only on `!observation.present`, so a timeout still yields `fail`. Constraint present.

## Edited existing tests (weakening review)

All edited test files plus unedited consumers (`tests/security/doctor-diagnostic.test.mjs`, `tests/public-regression/campaigns.test.mjs`) ran together at HEAD: 222 pass, 0 fail, 0 skipped.

- `tests/integration/doctor-{availability-probes,cedar-policy-probe,connector-availability,probe-availability,sandbox-probe,sqlite-probe}.test.mjs`: each `:blocked` expectation for an absent observation became `:not-offered`, exactly AC 1. Equality strength unchanged; pass/fail cases untouched. Not a weakening. Note: two of them (`a bundle present without its trust anchor`, `a valid record with available: false`) concern partially provisioned fixtures that the probe reports as absent, so they also move to `not-offered`; consistent with the plan's "absent" rule.
- `tests/integration/doctor-source-mode.test.mjs`: per-check exact expectation (`secret-presence` -> `blocked`, others -> `not-offered`); the "never fail" assertion retained. Not a weakening.
- `tests/unit/doctor-facts.test.mjs`: sorted-pair deepEqual replaced by exact deepEqual on both `blocked_capabilities` and the new `not_offered_capabilities`. Stronger, not weaker.
- `tests/unit/doctor-rules.test.mjs`: test title only (six -> seven field allowlist); assertion unchanged and derives from `DOCTOR_REPORT_FIELDS`.
- `tests/agent-readiness/beta-tester-docs.test.mjs`: the positive `/\`blocked\` is its expected verdict/` match was replaced with `/a healthy installation reports \`pass\`/`; its negation is owned by C16. Follows AC 12. Not a weakening.
- `tests/contract/task-request-v1-golden.test.mjs`: strips exactly one `DoctorReportV2` block (asserts `match(...).length === 1`) before hashing; the pinned value `sha256:341983f6ffe969ccff397457284597d7a36e54732115291414326be77ba38512` is byte-identical to `origin/main` (compared via `git show origin/main:...`). All other pinned hashes unchanged. Not a weakening; `node scripts/generate-contract-types.mjs --check` reports "generated contracts are current", so `generated.ts` agrees with the schema.
- `tests/e2e/doctor-cli-e2e.test.mjs`: validation target `@1` -> `@2`, status regex adds `not-offered`, BLOCKED/exit-4 assertions retained and new per-code assertions added. Not a weakening.
- `tests/contract/schema-registry.test.mjs`: exact registry list gains `doctor-report@2`. Not a weakening.

## Binding sources (opened, not required at light)

- `docs/qualification/qualification-line-exit-record.md:67` (X5): the second branch, "a `doctor` verdict that scopes them", is what the plan implements; whether it meets X5 stays open question 1 (owner).
- `docs/qualification/acceptance-matrix.md:791` (L2): consistent with the problem statement.
- `.specs/STATE.md:194` (AD-024) and `:3381` (AD-088): the six paths stay fixtures, `init` unchanged; no contradiction found.

## Gate

`node --test --test-name-pattern="<17 named proofs>" <5 files>` - 19 passed, 0 failed.
Edited and consumer doctor suites (19 files) - 222 passed, 0 failed, 0 skipped.
`node scripts/generate-contract-types.mjs --check` - exit 0.
