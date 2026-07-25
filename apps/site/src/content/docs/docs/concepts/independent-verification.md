---
title: Independent verification
description: Require fresh evidence from an identity that did not author the implementation.
---

Independent verification enforces `author != verifier`.

The verifier starts from the requirements and current source state, not from the author's completion narrative. It maps evidence to every requirement, runs the declared gates, and performs a discrimination test that deliberately breaks a relevant condition to prove the sensor detects failure.

Missing evidence scores zero. A plausible explanation is not a substitute for a reproducible result.

Verification reports may still fail or be incomplete. Human review decides whether the exact remaining risk is acceptable.
