---
title: Current qualification status
description: What a fully verified qualification chain does and does not mean for the public Verchestra project.
---

The public version is `0.0.0-qualification`.

## Verified now

Foundations through T77 have public validation reports. They cover the CLI, workspace placement, policy, drivers, probes, evidence, memory, distribution, recovery, human-review contracts, the persistent signing-key lifecycle, enforced cost and duration ceilings, a declared gate repair loop with bounded attempts and human escalation, a hardened policy boundary with declarative tests and signed bundles, an isolated Self-Test trust domain with all four packaged profiles, `doctor --deep` with a closed read-only check catalog, stable diagnostic exits, sentinel invariance, purpose-bound signed reports, a frozen public regression-campaign corpus with distribution-and-confidence reporting rather than single-run scores, a sealed-holdout evaluator with evaluator-owned evidence and a zero-authority candidate boundary, platform, security, and fault qualification across all five supported platforms with a signed evidence index, and a signed TUF release publication whose sealed launchers were verified by live activation on Windows and Linux.

## Next

The T69 Self-Test trust domain, T70 smoke and workspace profiles, T71 full, fault, and approved-driver profiles, T72 deep diagnostics, T73 public regression campaigns, T74 sealed-holdout promotion, T75 platform, security, and fault qualification, T76 verified release publication, and T77 final acceptance evidence and release-decision machinery are complete. Every task the roadmap declares now has a validation report, so the declared qualification chain is fully verified. The public CLI exposes init, all four Self-Test profiles, and `doctor --deep`. Seven source-mode doctor checks still report fixture presence rather than live subsystem health; their provisioned-machine upgrades remain tracked beyond T76.

What remains is not a task. It is the signed promote-or-reject decision that [`RELEASE-DECISION-CONTRACT.md`](https://github.com/accd/verchestra/blob/main/docs/qualification/RELEASE-DECISION-CONTRACT.md) defines, which requires an operational reviewer, a security reviewer, and an accountable human, all distinct. That decision has not been made.

:::caution[No implied release]
Completed foundations are evidence about implemented contracts. A fully verified qualification chain is evidence that every declared task has a report — it is not a release decision and it is not a version change. The published `verchestra` npm package installs `0.0.0-qualification`; that does not mean Verchestra is production-ready or accepted as 1.0.
:::

Read the canonical [roadmap](/verchestra/roadmap/) or inspect the [qualification evidence](/verchestra/docs/qualification/).
