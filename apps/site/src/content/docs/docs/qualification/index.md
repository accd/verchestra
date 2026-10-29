---
title: Qualification overview
description: Navigate public evidence for the fully verified qualification chain and the signed 1.0 hold.
---

Qualification reports are generated and reviewed in the repository. This portal indexes the canonical files directly.

## Current boundary

- T01–T68: the foundation chain, complete, with continuous public validation evidence.
- T68a–T68d: the inserted hardening chain (key lifecycle, budgets, gate repair, policy boundary), complete.
- T69–T77: the Self-Test trust domain, packaged profiles, deep doctor, public regression campaigns, sealed-holdout promotion, platform and security qualification, the verified release candidate, and independent acceptance, complete.
- The 1.0 decision: a signed reject, recorded as a hold. The candidate keeps operating as `0.0.0-qualification`; a promote round would decide on a fresh candidate with its own decision file.

Evidence describes exactly what was tested. It does not generalize to untested platforms, provider versions, database topologies, or production workloads.

Start with [T77 validation](./t77-validation/) and follow requirement references back through the earlier reports.
