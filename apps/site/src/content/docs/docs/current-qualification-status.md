---
title: Current qualification status
description: What T70 complete and T71 next mean for the public Verchestra project.
---

The public version is `0.0.0-qualification`.

## Verified now

Foundations through T70 have public validation reports. They cover the CLI, workspace placement, policy, drivers, probes, evidence, memory, distribution, recovery, human-review contracts, the persistent signing-key lifecycle, and enforced cost and duration ceilings, a declared gate repair loop with bounded attempts and human escalation, and a hardened policy boundary with declarative tests and signed bundles, and an isolated Self-Test trust domain that exercises production boundaries while holding no production authority, and packaged smoke and workspace Self-Test profiles reachable through the CLI.

## Next

The T68 hardening insertion, the T69 Self-Test trust domain, and the T70 smoke and workspace profiles are complete. T71 adds the full, fault, and approved-driver profiles next, and T72–T77 add deep diagnostics, regression and holdout evaluation, platform qualification, reproducible release artifacts, and the explicit 1.0 decision. The public CLI exposes init and self-test; the full and drivers profiles have no scenario content yet.

:::caution[No implied release]
Completed foundations are evidence about implemented contracts. They do not mean Verchestra is installable, production-ready, or accepted as 1.0.
:::

Read the canonical [roadmap](/verchestra/roadmap/) or inspect the [qualification evidence](/verchestra/docs/qualification/).
