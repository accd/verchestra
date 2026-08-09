---
title: Current qualification status
description: What T72 complete and T73 next mean for the public Verchestra project.
---

The public version is `0.0.0-qualification`.

## Verified now

Foundations through T72 have public validation reports. They cover the CLI, workspace placement, policy, drivers, probes, evidence, memory, distribution, recovery, human-review contracts, the persistent signing-key lifecycle, enforced cost and duration ceilings, a declared gate repair loop with bounded attempts and human escalation, a hardened policy boundary with declarative tests and signed bundles, an isolated Self-Test trust domain with all four packaged profiles, and `doctor --deep` with a closed read-only check catalog, stable diagnostic exits, sentinel invariance, and purpose-bound signed reports.

## Next

The T69 Self-Test trust domain, T70 smoke and workspace profiles, T71 full, fault, and approved-driver profiles, and T72 deep diagnostics are complete. T73 adds public regression campaigns next; T74–T77 add sealed holdout evaluation, platform qualification, reproducible release artifacts, and the explicit 1.0 decision. The public CLI exposes init, all four Self-Test profiles, and `doctor --deep`. Seven source-mode doctor checks still report fixture presence rather than live subsystem health; their provisioned-machine upgrades remain tracked for T75.

:::caution[No implied release]
Completed foundations are evidence about implemented contracts. They do not mean Verchestra is installable, production-ready, or accepted as 1.0.
:::

Read the canonical [roadmap](/verchestra/roadmap/) or inspect the [qualification evidence](/verchestra/docs/qualification/).
