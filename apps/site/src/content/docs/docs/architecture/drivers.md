---
title: Drivers
description: Normalize different AI environments behind one bounded execution protocol.
---

Drivers implement discovery, eligibility, start, event normalization, cancellation, and close operations for an AI environment.

A Passport records the exact provider, version, model, protocol, tools, limits, and qualified roles. Orchestration requests capabilities; the resolver selects an eligible local Passport. It does not hard-code a globally “best” model.

Claude Code, Codex, and OpenCode/Qwen may therefore receive different role recommendations while executing the same portable requirements. Unsupported versions or capability drift quarantine the driver.
