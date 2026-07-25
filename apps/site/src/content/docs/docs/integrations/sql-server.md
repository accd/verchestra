---
title: SQL Server
description: Read-only SQL Server discovery with bounded metadata and query plans.
---

The SQL Server adapter treats database, schema, and object identity explicitly. Discovery may inspect approved metadata and execute bounded reads against allowlisted objects.

The plan denies data-definition, data-modification, execution, unsafe functions, multi-statement ambiguity, and unbounded results. Time, row, and byte limits are enforced alongside a read-only login.

Topology and server version belong in qualification evidence; connection secrets remain local.
