# README overhaul: validation

**Validator:** the author; independent review is pending human review.

| Check | Result |
| --- | --- |
| `node --test tests/agent-readiness/beta-tester-docs.test.mjs tests/agent-readiness/npx-package-name.test.mjs tests/unit/regex-linearity.test.mjs` | 32 pass, 0 fail |
| `apps/site`: `node --test tests/unit/*.test.mjs` | 77 pass, 0 fail (same as before the change) |
| `pnpm test:architecture` | 149 pass, 0 fail |
| `pnpm test:agent-readiness` | 466 pass, 1 fail: `context.test.mjs` "JSON context exposes the exact safe clean-clone contract", which fails identically without this change |
| `pnpm agent:check` | Same two findings with and without this change, both from the shallow clone (qualification revisions not present) and `llms.txt` status; no README, link or license finding |
| `pnpm gate:quick` | format, lint, complexity and typecheck pass; `test:unit` fails on a Node 22, root-user host (SQLite worker, self-test cleanup residue), unrelated to Markdown |
| `pnpm site:test` | Not runnable here: Astro refuses Node 22.22.0 |

The full `gate:quick` and `site:test` must run on the pinned Node 24.14.0 in CI.
