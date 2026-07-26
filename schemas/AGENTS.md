# Schema Instructions

Apply the root `AGENTS.md` first.

- Schemas are canonical public contracts. Preserve versioned directories and
  backward compatibility unless a reviewed breaking change is explicit.
- Change generated TypeScript or documentation through the schema and
  `scripts/generate-contract-types.mjs`; never edit generated output directly.
- Keep schemas deterministic, closed where appropriate, and free of secrets,
  environment values, or machine-local paths.
- Add contract tests for valid examples, every specified rejection, and
  generated-output parity.
- Run `pnpm test:contract`, `pnpm typecheck`, and then `pnpm gate:quick`.

