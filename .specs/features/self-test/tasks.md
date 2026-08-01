# Self-Test Tasks

1. **T1 — Registration and skeleton.** `EXPECTED_PACKAGES`, the
   repository-map row, the gate-selection security rule, and the package
   skeleton. Verify: `test:architecture` green with the empty package;
   `packages/self-test/` selects `gate:security`.
2. **T2 — Rules in application.** Errors, closed profile registry,
   non-overlap rule over `RootFacts`, Sentinel Set comparison, quarantine
   state machine, report allowlist rules, port interfaces, orchestrator.
   Unit tests.
3. **T3 — Adapter facts.** Disposable-root provisioning and probing, sentinel
   capture, bounded fixtures, cleanup with residue reporting, quarantine
   mechanics, test-only keys. Security tests: symlink and junction escape,
   production-material rejection.
4. **T4 — Composition and the signed report.** `self-test-composition.ts`,
   `SupportCodeRegistry` wiring, sealed report through the evidence boundary.
   Fault tests: sentinel mutation, incomplete cleanup, quarantine failure,
   unknown profiles, prohibited report content.
5. **T5 — Qualification.** Minimum 35 cases across unit, security, and fault
   scopes, a discrimination sensor with every mutation killed, external gate
   dispatch at the implementation revision, and
   `docs/qualification/t69-validation.md`.
