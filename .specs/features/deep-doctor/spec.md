# T72 Deep Doctor and Signed Diagnostic Reports Specification

## Problem statement

The installed CLI exposes `init` and the four Self-Test profiles, but a user
who wants to know whether *this machine* can run a delivery — before starting
one — has no read-only health surface. T72 adds `vestra doctor --deep`: a
diagnostic that inspects the installation, contracts, policy engine, durable
stores, native assets, Git, secret presence, drivers, connectors, probes, the
sandbox, and the clock, and emits a bounded, redacted, signed report. It never
repairs, never calls a paid provider, never mutates the subject, and never
exposes a secret value, raw provider payload, private database content, or a
machine-local path.

## Goals

- Add a `doctor` verb with a `--deep` option to the installed CLI manifest and
  dispatch it through a read-only composition root, never the mutating bus.
- Run a closed, registered catalog of subsystem checks using only read-only
  fact ports; no mutable or paid adapter method is reachable.
- Produce one closed diagnostic report projected identically to human and JSON
  renderers, validated against a registered JSON schema, with stable exit codes.
- Map every unhealthy or missing subsystem to an exact blocked-capability id and
  a registered, safe remediation code.
- Redact machine-local paths (pseudonymized) and reject prohibited content, then
  seal and sign the report with a TEST-ONLY diagnostic identity.
- Prove the Sentinel Set is byte-identical before and after diagnostic runs.

## Out of scope

| Exclusion | Owner / reason |
| --- | --- |
| Repairing detected problems | Non-goal (#13); doctor is read-only |
| Paid provider calls or remote mutations | Forbidden in the diagnostic surface |
| Exposing secret values, raw provider payloads, or private database content | Forbidden (#13); redaction rejects them |
| A shallow `doctor` (no `--deep`) mode with different checks | Only `--deep` is specified here; a bare `doctor` may alias the same closed catalog |
| New provider adapters or probe engines | Reuses existing read-only adapters (T35–T37, T60–T65) |
| DSSE/in-toto attestation of the report | T76 decision; the report seals with the existing `ArtifactSealer` |

## Requirements

### DOC-01 — Read-only diagnostic execution

WHEN `doctor --deep` runs THEN every subsystem observation SHALL come from a
read-only fact port, and no mutable, writing, or paid adapter method SHALL be
reachable from the diagnostic execution path.

### DOC-02 — Closed check catalog

WHEN the diagnostic runs THEN it SHALL produce exactly the registered closed set
of check ids covering installation, contract schema, Cedar policy, SQLite
durable state, native asset, Git, secret presence, Driver, Connector, Probe,
sandbox, and clock; a missing, duplicated, or unknown check id SHALL fail
closed with a stable Self-Test/doctor error code.

### DOC-03 — Blocked capability and safe remediation

WHEN a check observes a missing or unhealthy subsystem THEN the report SHALL
name the exact blocked capability id and a registered remediation code, and
SHALL never carry a raw error message, secret, or machine-local path.

### DOC-04 — Sentinel invariance

WHEN a diagnostic run completes, for both an all-pass run and a run with failing
checks, THEN the Sentinel Set captured before execution SHALL be byte-identical
to the Sentinel Set captured after, or the run SHALL fail closed.

### DOC-05 — One closed report, human and JSON, stable exits

WHEN the diagnostic report is rendered THEN the human and JSON renderers SHALL
project the same closed `doctor.*` payload; the payload SHALL validate against
the registered `doctor-report` JSON schema; and the process SHALL exit 0 when
every check passes and with a distinct, stable non-zero code when a check fails,
a capability is blocked, or execution fails internally.

### DOC-06 — Redaction and signing

WHEN the report is produced THEN machine-local paths SHALL be pseudonymized,
prohibited content (secrets, authority-injection, raw paths, database content)
SHALL be rejected before sealing, and the report SHALL be sealed and signed with
a TEST-ONLY diagnostic identity bound to the `doctor-report` purpose.

### DOC-07 — Adequate evidence

WHEN T72 is submitted for verification THEN at least 30 contract, E2E, and
security cases SHALL pass, no assertion SHALL be skipped or weakened,
`pnpm gate:security` SHALL pass, and independent verification plus human review
SHALL remain required.

## Edge cases

- A subsystem whose fixture is absent (no Cedar bundle, no runtime database, no
  Git) reports `blocked` with a remediation code, not an exception.
- A read-only adapter that reports it is NOT read-only fails the check closed.
- A check whose observed value would carry a secret, DB URL, `SQLite format 3`
  header, or absolute path is rejected by the prohibited-content scanner before
  sealing.
- Two runs against the same machine produce the same ordered `checkId:status`
  fingerprint (determinism), path pseudonyms excepted where salted per run.
- A diagnostic run leaves the sentinels and every guarded root byte-identical.
- `--output json` and the human summary carry the same verdict and check set.
- The signing key is generated per run and never persisted or printed.

## Traceability

| Requirement | Upstream | Status |
| --- | --- | --- |
| DOC-01 | VES-RLS-003 | In tasks |
| DOC-02 | VES-TST-007 | In tasks |
| DOC-03 | VES-TST-008 | In tasks |
| DOC-04 | VES-TST-004 (sentinel invariance) | In tasks |
| DOC-05 | VES-CLI-005 | In tasks |
| DOC-06 | VES-RLS-004 | In tasks |
| DOC-07 | Issue #13 completion | In tasks |

Coverage: 7 requirements, 7 mapped to tasks, 0 unmapped.
