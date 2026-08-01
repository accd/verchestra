// Self-Test trust domain adapter (T69, #10). Node-bound facts only:
// disposable-root provisioning and path-fact probing, sentinel capture,
// bounded fixtures, cleanup, quarantine mechanics, and test-only key material.
// Rules and verdicts live in packages/application; sibling-adapter wiring
// lives only in the CLI composition root (.specs/features/self-test/design.md).
export const packageName = "@verchestra/self-test" as const;
