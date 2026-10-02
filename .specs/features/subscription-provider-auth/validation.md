# Subscription Provider Authentication Validation (ADP-A)

## Verdict

**Result:** NOT RUN (T1 only: evidence and specification)

**Specification:** `.specs/features/subscription-provider-auth/spec.md`

**Commit range:** `af7d047e6d45970ee75c8991bed8ba969982cbb4..<head>`

## TA1 evidence

Recorded in `spec.md` under "Evidence (TA1)" with each source. The probes were
read-only: `claude --version`, `claude --help`, `claude setup-token --help`,
`claude auth --help` and its subcommands' `--help`, `codex --version`,
`codex --help`, `codex login --help`, `codex login status --help`, and
`codex login status` in a disposable `CODEX_HOME` with a disposable `HOME`. No
prompt was sent to a model.

## Requirement evidence

Filled in by T2–T6.
