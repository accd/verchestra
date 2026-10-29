---
title: Security and isolation evidence
description: Validate policy boundaries, no-writer guarantees, redaction, and trust-domain separation.
---

Security qualification covers path containment, secret handling, capability denial, approval transitions, lease identity, driver isolation, probe no-writer behavior, support-bundle allowlists, and crash recovery.

Negative tests matter: unsafe inputs must fail closed and produce no promoted evidence. Discrimination checks deliberately remove a control or inject a fault to prove the sensor detects the intended violation.

T69–T72 added an isolated Self-Test identity and signed diagnostics without weakening these production boundaries; see [T72 validation](../t72-validation/).
