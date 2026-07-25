---
title: SAP ASE and Sybase
description: First-class read-only discovery for the primary Verchestra database adapter.
---

SAP ASE / Sybase is a primary adapter, not a compatibility footnote.

The adapter identifies the observed product, validates supported server behavior, constrains database and owner scope, and compiles approved catalog or `SELECT` operations. Parser and capability checks reject writes, unsafe procedures, unapproved objects, excessive results, and ambiguous statements before execution.

Use a principal that is technically unable to write. Session configuration is an additional safety layer, not a replacement for database permissions.

Evidence records engine identity, plan digest, bounded result metadata, and redaction decisions. It does not retain connection strings or raw sensitive rows.
