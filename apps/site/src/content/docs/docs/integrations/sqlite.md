---
title: SQLite
description: Treat a local SQLite file as a governed read-only data source.
---

SQLite has no server-side user permissions, so file-system authority matters. The adapter opens approved database files in read-only mode and verifies product and schema behavior.

Only registered schemas and normalized read operations are allowed. Internal tables, unsafe pragmas, attachments, writes, and file paths outside the registered target are denied.

The database file is project input, not Verchestra memory. Never commit a sensitive database merely to enable discovery.
