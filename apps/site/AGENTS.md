# Website Instructions

Apply the root `AGENTS.md` first.

- Repository Markdown and typed product/status data are canonical. Site pages,
  generated Markdown alternates, search indexes, and LLM text files are
  projections.
- Use `src/lib/repository-docs-loader.ts` and
  `src/lib/repository-content.ts`; do not introduce a second content system.
- Preserve the GitHub Pages `/verchestra/` base path for assets, canonicals,
  alternates, sitemap entries, robots, and direct routes.
- Keep status at `0.0.0-qualification`, T68d complete, T69 next unless canonical
  evidence changes.
- Do not claim guaranteed indexing, ranking, training inclusion, public
  installation, or production readiness.
- Do not commit `dist`, `.astro`, Pagefind, browser, or Lighthouse output.
- Test content logic with Node tests, rendered behavior with Playwright/Axe,
  built output with `check-built-site.mjs`, and performance with Lighthouse.
- Run `pnpm site:check`, `pnpm site:test`, and `pnpm site:build`; run browser and
  Lighthouse gates when page behavior or presentation changes.
