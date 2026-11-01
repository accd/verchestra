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

## T2: self-test recording (2026-10-31)

The GIF records a real run of the published package, not a mock-up. It was
recorded with vhs from `docs/assets/self-test.tape` on Linux x64 with Node
24.14.0, after an off-camera warm-up activated the release.

- `npx verchestra@0.0.0-qualification.9 --version` printed
  `Verchestra 0.0.0-qualification.9 (revision 50ae23c84c88)`.
- `npx verchestra@0.0.0-qualification.9 self-test --profile smoke` exited 0
  with `self_test.check_count: 6`, `self_test.failure_codes: []` and
  `self_test.verdict: PASS`.
- The frames show no home directory, user name or machine-local path.
- `docs/assets/self-test.gif` is about 106 KB.

## T3: light and dark banner (2026-11-01)

- `docs/assets/banner.html` was rendered with Playwright's Chromium at
  1280x320 and device scale factor 2. Manrope came from
  `@fontsource-variable/manrope`, which is already in the lockfile; the font
  check reported it loaded in both themes. The colors are the site's tokens
  from `apps/site/src/styles/global.css`.
- After corner fill and quantization, `banner-light.png` is about 128 KB and
  `banner-dark.png` about 131 KB. Both renders were reviewed by eye.
- `# Verchestra` stays the first line and the pitch stays the first prose
  paragraph after it, so the llms title and description are unchanged.
- PR accd/verchestra#723 (T2) merged to `main` as `6e435e9` before this task.
