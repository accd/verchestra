---
title: Current qualification status
description: What T71 complete and T72 next mean for the public Verchestra project.
---

The public version is `0.0.0-qualification`.

## Verified now

Foundations through T71 have public validation reports. They cover the CLI, workspace placement, policy, drivers, probes, evidence, memory, distribution, recovery, human-review contracts, the persistent signing-key lifecycle, and enforced cost and duration ceilings, a declared gate repair loop with bounded attempts and human escalation, and a hardened policy boundary with declarative tests and signed bundles, and an isolated Self-Test trust domain that exercises production boundaries while holding no production authority, and packaged smoke, workspace, full, fault, and approved-driver Self-Test profiles reachable through the CLI, the last three driving the complete delivery path, hard-crash convergence, and denied-authority driver checks.

## Next

The T69 Self-Test trust domain, the T70 smoke and workspace profiles, and the T71 full, fault, and approved-driver profiles are complete. T72 adds deep diagnostics and signed diagnostic reports next, and T73–T77 add regression and holdout evaluation, platform qualification, reproducible release artifacts, and the explicit 1.0 decision. The public CLI exposes init and all four Self-Test profiles; deep diagnostics do not exist yet.

:::caution[No implied release]
Completed foundations are evidence about implemented contracts. They do not mean Verchestra is installable, production-ready, or accepted as 1.0.
:::

Read the canonical [roadmap](/verchestra/roadmap/) or inspect the [qualification evidence](/verchestra/docs/qualification/).
