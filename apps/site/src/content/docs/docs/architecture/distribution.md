---
title: Distribution
description: The planned verified path from source tree to reproducible release.
---

Distribution foundations include hermetic bundle identities, SBOM inputs, provenance, signature verification, TUF metadata, staged activation, health gates, rollback, and uninstall contracts.

T76 produced and published the reproducible candidate release. T77 recorded the final acceptance evidence and the enforcement the explicit promote-or-reject decision needs; that decision has since been made — a signed **reject** (a recorded hold), so the candidate keeps operating as `0.0.0-qualification` and is not promoted to `1.0.0`.

:::caution[A qualification installer, not a 1.0 release]
This path is exercised in public: `npx verchestra` resolves, verifies, and activates the signed release through it. What it installs is `0.0.0-qualification`, not a production release. See [install and run](/verchestra/docs/install-and-run/).
:::
