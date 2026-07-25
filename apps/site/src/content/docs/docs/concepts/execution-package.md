---
title: Execution Package
description: The portable, signed contract that carries delivery work between environments.
---

An Execution Package is the durable unit of Verchestra delivery. It binds:

- source identity and digests;
- requirements and accepted decisions;
- ordered, verifiable tasks;
- policy and authority requirements;
- expected artifacts and evidence;
- checkpoint and recovery state;
- independent verification and human-review gates.

The package is provider-neutral. Claude Code, Codex, and OpenCode/Qwen can interpret it through different drivers, but none may silently change its accepted requirements.

Packages are append-oriented and content-addressed. A material change produces a new identity and invalidates stale approvals.
