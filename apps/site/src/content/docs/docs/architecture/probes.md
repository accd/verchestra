---
title: Probes
description: Compile approved data questions into auditable, read-only operations.
---

The probe subsystem registers a stable database identity, selects an engine adapter, normalizes the requested operation, checks capabilities, and compiles a bounded plan.

Execution requires both a read-only principal and an engine-aware read-only session. Schema, object, function, concurrency, time, row, and byte violations produce no promoted evidence.

Adapters never accept arbitrary model-generated database commands as authority. The model proposes an intent; deterministic code validates and compiles the operation.
