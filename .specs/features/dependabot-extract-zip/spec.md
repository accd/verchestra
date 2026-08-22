# Dependabot extract-zip remediation

## Problem

Dependabot alert #22 reports a high-severity symlink path-traversal issue in
`extract-zip@2.0.1`, pulled transitively by Lighthouse 12.6.1 through
`@lhci/cli@0.15.1`. The advisory has no patched `extract-zip` release.

## Requirements

- **SEC-01**: The committed lockfile SHALL contain no `extract-zip` package.
- **SEC-02**: Site checks SHALL retain the existing Lighthouse assertions and
  page-quality contract while using a supported Lighthouse dependency chain.
- **SEC-03**: The dependency graph SHALL be reproducible with the frozen
  lockfile and pass the repository security gate.
- **SEC-04**: The change SHALL not claim the Dependabot alert is resolved until
  GitHub re-evaluates the default branch after merge.

## Scope

Upgrade the transitive Lighthouse chain to `lighthouse@13.4.1`, which resolves
Puppeteer 25 and `@puppeteer/browsers@3.2.1` without `extract-zip`, and add a
lockfile regression assertion. Product behavior, thresholds, and the roadmap
are unchanged.
