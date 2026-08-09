---
title: SAP ASE and Sybase
description: First-class read-only discovery with full contract parity for SAP ASE and Sybase.
---

SAP ASE / Sybase has full contract parity with every other engine — a dedicated adapter and parser, not a compatibility footnote. Like every engine except SQLite, it is contract-verified in this repository and live-qualified at the edge: your team runs the conformance kit against its own server.

The adapter identifies the observed product, validates supported server behavior, constrains database and owner scope, and compiles approved catalog or `SELECT` operations. Parser and capability checks reject writes, unsafe procedures, unapproved objects, excessive results, and ambiguous statements before execution.

Use a principal that is technically unable to write. Session configuration is an additional safety layer, not a replacement for database permissions.

Evidence records engine identity, plan digest, bounded result metadata, and redaction decisions. It does not retain connection strings or raw sensitive rows.
