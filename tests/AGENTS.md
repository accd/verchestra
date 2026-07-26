# Test Instructions

Apply the root `AGENTS.md` first.

- Derive assertions from specification outcomes, not implementation shape.
- Keep tests deterministic, isolated, and free of real credentials, networks,
  production data, home directories, and provider state.
- Use `tests/unit` for pure behavior, `contract` for schemas/interfaces,
  `integration` for component boundaries, `e2e` for journeys, `security` for
  authority and data controls, and `fault-injection` for recovery behavior.
- Every behavior change needs a happy path plus each specified edge or failure
  path. Cite exact assertions in validation evidence.
- Mutation/discrimination tests must operate in disposable fixtures or copies
  and restore all state.
- Never delete, skip, loosen, or replace a failing assertion to make a gate
  pass.
- Use `scripts/test-scope.mjs` through the matching declared test command, then
  run `pnpm gate:quick`.
