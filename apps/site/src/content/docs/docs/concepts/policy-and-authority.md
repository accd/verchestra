---
title: Policy and authority
description: Separate orchestration intent from the local capability to create effects.
---

Policy answers whether an effect is allowed. Authority proves that this environment can perform it.

A driver proposes capabilities; the policy layer narrows them. Credentials and leases are resolved locally and expire independently from the Execution Package. Approval-sensitive effects require an explicit grant before execution.

This prevents a portable package from becoming a portable secret or a universal permission token. The same task may be executable on one machine and blocked on another while preserving identical requirements.
