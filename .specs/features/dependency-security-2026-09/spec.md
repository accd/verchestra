# September 2026 Dependency Security Batch

## Problem

On 2026-09-28, GitHub listed 18 open Dependabot alerts against `main` (2 critical,
7 high, 9 moderate) and 10 open Dependabot pull requests. `pnpm audit` found two
more advisories that no alert covered: `brace-expansion` (high) and `ip-address`
(moderate). Two of the pull requests, the Pi 0.85.1 group (#415) and the OpenCode
1.18.23 group (#400), fail because their drivers are pinned to one exact
qualified version.

## Goals

- Resolve every open alert by upgrading to a patched release, not by dismissing it.
- Merge each compatible Dependabot pull request by rebase, one at a time, with
  required checks green on the exact head.
- Requalify the Pi and OpenCode driver updates under their existing exact-pin
  policy instead of loosening it.
- Stop duplicate per-directory security proposals such as #410.

## Out of scope

| Exclusion                                                        | Reason                                                                              |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Node 26, `tuf-js` 6, `@types/node` majors                        | They change the Node 24.14.0 baseline; the existing ignore rules stay.              |
| New majors of `fast-uri` 4, `js-yaml` 5, `devalue` 6, `vitest` 5 | A patched release exists inside the current major, so no major migration is needed. |

## Decisions

- The owner approved this batch on 2026-09-28 and authorized the agent to approve
  and rebase-merge through `gh`. That authorization is the human approval of
  record. Every required check stays mandatory.
- Transitive fixes use the smallest mechanism that works: an existing exact
  override is bumped (`fast-uri`, `js-yaml`, `minimatch>brace-expansion`), or the
  lockfile is refreshed within the declared ranges (`express` → `body-parser` →
  `qs`, `socks` → `ip-address`). No override was added that breaks a parent's
  declared range.
- `third-party-web` also resolves to 0.30.0. It is declared as `latest` by
  `@paulirish/trace_engine`, so any lockfile refresh re-resolves it. It is a
  Lighthouse data package in the site's dev tooling.

## Acceptance criteria

1. **DSB-01**: WHEN the batch completes THEN the Dependabot alerts API SHALL
   report zero open alerts.
2. **DSB-02**: WHEN `pnpm audit` runs on `main` THEN it SHALL report no
   vulnerability.
3. **DSB-03**: WHEN overrides change THEN each SHALL remain an exact version,
   and `pnpm install --frozen-lockfile` SHALL succeed.
4. **DSB-04**: WHEN Dependabot proposes security updates THEN they SHALL arrive
   grouped, and astro/@astrojs updates SHALL arrive as one unit. This is asserted
   by `tests/agent-readiness/dependency-policy.test.mjs`.
5. **DSB-05**: WHEN a driver runtime update merges THEN its exact pin, spike
   oracle and a new immutable qualification report SHALL move together, and the
   focused qualification suite SHALL pass with zero skips.
6. **DSB-06**: WHEN the batch completes THEN no Dependabot pull request SHALL
   remain open unless it was opened after this batch. Each superseded pull
   request SHALL be closed with its reason.
7. **DSB-07**: No assertion, Lighthouse threshold, workflow permission or
   qualification boundary SHALL be weakened.
