# Dependency security, October 2026: validation

**Date:** 2026-10-24
**Host:** Windows 11, Node 24.14.0, pnpm 10.34.5

| Requirement | Evidence | Result |
| --- | --- | --- |
| DSO-01 | Declared ranges read from the installed parents: `express` 4.22.3 `proxy-addr ~2.0.7`, `express` 5.2.1 `^2.0.7`, `@lhci/cli` 0.15.1 `compression ^1.7.4`, `mermaid` 12.0.0 `dompurify ^3.4.12`, `@astrojs/sitemap` 3.7.4 `zod ^4.3.6`; every override is exact and inside them. | PASS |
| DSO-02 | `pnpm why`: `dompurify@3.4.17`, `proxy-addr@2.0.8`, `compression@1.8.2`; `zod@4.6.5` no longer resolves anywhere. | PASS |
| DSO-03 | `pnpm-lock.yaml` diff: only the four packages change, plus `destroy` 1.2.0 that `compression` 1.8.2 declares. | PASS |
| DSO-04 | `katex`, `postcss-selector-parser` and `zod` 3.25.76 stay at their current versions; the reasons are in `spec.md`. | PASS (open by design) |
| DSO-05 | `tests/agent-readiness/dependency-policy.test.mjs` 7 of 7; `gate:quick` 3014 of 3015 (the symbolic-link environment case of this host); site unit 50 of 50, `site build` 135 pages, `check:built` links and metadata valid. | PASS locally; CI Site quality is authoritative |

## Local note

`astro check` (`check:astro`) fails on this Windows host with
`TypeError: this.bridge.deleteEnv is not a function` from
`@emnapi/runtime` 2.0.0-alpha.3 after prompting to install `@astrojs/check`. It
fails identically on `main` at `d83fc13` with a frozen install, so it is not
caused by this change; CI's Site quality runs it on Linux and passes on `main`.
