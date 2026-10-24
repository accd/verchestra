# Dependency security, October 2026

## Problem

On 2026-10-23 the Dependabot alerts API reported nine open alerts. #577 fixed the
two on `zod` in `packages/agent-runtime` (the runtime path). Dependabot's own
security update for the rest failed. All remaining alerts are on packages that
reach only the documentation site or development tooling, never the CLI or the
`verchestra` launcher:

| Package | Severity | Reaches | Patched |
| --- | --- | --- | --- |
| `dompurify` 3.4.16 | critical, high, low | `mermaid` 12.0.0 in `apps/site` | 3.4.17 |
| `proxy-addr` 2.0.7 | critical | `express` 4 under `@lhci/cli` (site devDependency), `express` 5 under the Pi SDK (root devDependency) | 2.0.8 |
| `compression` 1.8.1 | high | `@lhci/cli` | 1.8.2 |
| `zod` 4.6.5 | high | `@astrojs/sitemap` in `apps/site` | 4.6.6 |
| `zod` 3.25.76 | high | `chromium-bidi` (Playwright/Puppeteer) | 4.6.6 only |
| `katex` 0.16.47 | low | `mermaid` | 0.18.2 |
| `postcss-selector-parser` 6.1.4 | medium | `postcss-nested` 6.2.0 (expressive-code) | 7.1.6 |

## Requirements

- **DSO-01**: Each override SHALL be an exact version inside every parent's
  declared range (the rule of `dependency-security-2026-09`, DSB-03).
- **DSO-02**: `dompurify`, `proxy-addr`, `compression` and the `@astrojs/sitemap`
  copy of `zod` SHALL resolve to their patched versions.
- **DSO-03**: No package outside those four SHALL change in `pnpm-lock.yaml`.
- **DSO-04**: The three alerts whose fix crosses a parent's major (`katex`,
  `postcss-selector-parser`, `zod` 3.x) SHALL stay open and recorded here, not
  forced: `mermaid` declares `katex` `^0.16`, `postcss-nested` 6 declares
  `postcss-selector-parser` `^6`, and `chromium-bidi` declares `zod` `^3`.
- **DSO-05**: `pnpm gate:quick` and `pnpm site:check` SHALL pass; no assertion,
  Lighthouse threshold or workflow changes.

## Scope

`pnpm-workspace.yaml` overrides and `pnpm-lock.yaml`. The `.8` candidate (built
at `d83fc13`) is unaffected: none of these packages is in its closure.
