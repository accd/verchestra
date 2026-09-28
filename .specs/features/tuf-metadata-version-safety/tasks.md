# TUF metadata version safety tasks

1. **T1 (#391)** — detect a same-version, different-content timestamp in
   `TufUpdateClient` and fail `VES_TUF_STALE_METADATA` before any target read;
   extend the e2e collision tests, add the HTTPS reproduction and the security
   precision tests. Status: done.
2. **T2 (#387 follow-up)** — add the committed publication ledger, enforce
   strict monotonicity per root digest in the publish script before signing,
   remove the `?? 1` fallbacks, add the ledger contract test and publication
   tests, and update the runbook and tuf-role-separation handoff. Status: done.
3. **T3** — run focused tests, `pnpm gate:quick`, `gate:build`, `gate:security`,
   `gate:release`, and `pnpm agent:check`; record results in `validation.md`.
