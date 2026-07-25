---
title: Feature delivery
description: Move a feature from request to independent verification and accountable acceptance.
---

```text
request → discovery → specification → design → tasks
        → execution → verification → human review
```

The orchestration layer turns the request into an Execution Package containing requirements, decisions, atomic tasks, authority, and completion gates. A qualified driver executes that package without owning the policy.

Verification is independent: the author cannot validate their own completion claim. Evidence is mapped back to requirements, and discrimination checks prove that the tests can fail for the intended reason.

`EXECUTION_READY` means the package is complete enough to execute. It is not human approval. Human review remains an explicit final state after independent evidence exists.
