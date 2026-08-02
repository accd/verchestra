---
title: Current qualification status
description: What T69 complete and T70 next mean for the public Verchestra project.
---

The public version is `0.0.0-qualification`.

## Verified now

Foundations through T69 have public validation reports. They cover the CLI, workspace placement, policy, drivers, probes, evidence, memory, distribution, recovery, human-review contracts, the persistent signing-key lifecycle, and enforced cost and duration ceilings, a declared gate repair loop with bounded attempts and human escalation, and a hardened policy boundary with declarative tests and signed bundles, and an isolated Self-Test trust domain that exercises production boundaries while holding no production authority.

## Next

The T68 hardening insertion and the T69 Self-Test trust domain are complete. T70 adds the smoke and workspace Self-Test profiles next, and T71–T77 add the remaining profiles, deep diagnostics, regression and holdout evaluation, platform qualification, reproducible release artifacts, and the explicit 1.0 decision. No Self-Test profile is composed into the public CLI yet.

:::caution[No implied release]
Completed foundations are evidence about implemented contracts. They do not mean Verchestra is installable, production-ready, or accepted as 1.0.
:::

Read the canonical [roadmap](/verchestra/roadmap/) or inspect the [qualification evidence](/verchestra/docs/qualification/).
