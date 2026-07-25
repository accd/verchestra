# Documentation Instructions

Apply the root `AGENTS.md` first.

- Repository documentation is canonical; site copies and LLM-readable output
  are generated projections.
- Keep all content English-only and distinguish implemented, qualified,
  planned, and production-ready states precisely.
- Preserve `0.0.0-qualification`, T68 complete, and T69 next unless contiguous
  evidence and the roadmap change together.
- Use repository-relative links and commands that exist in `package.json`.
- Never include credentials, production data, private schemas, usernames, home
  directories, machine-local paths, or claims of guaranteed AI indexing,
  ranking, or training inclusion.
- Qualification reports are immutable evidence for their recorded revision;
  add a new report rather than rewriting history.
- Run link/readiness checks and the smallest relevant site test, then
  `pnpm gate:quick`.

