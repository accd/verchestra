---
title: Read-only database discovery
description: Gather schema and bounded sample evidence without creating a hidden database writer.
---

Database probes use explicit read-only credentials and a database-specific capability plan.

The workflow:

1. identify the engine, topology, and approved schemas;
2. validate that the credential cannot write;
3. compile engine-specific metadata and bounded `SELECT` operations;
4. apply row, time, size, and sensitive-column limits;
5. emit redacted evidence with query digests;
6. close connections and preserve no credential material.

SQLite is live-qualified in this repository; PostgreSQL, MySQL/MariaDB, SQL Server, Oracle, SAP ASE / Sybase, and MongoDB are contract-verified here and qualified at the edge. The same no-writer contract applies to every engine.

An ER model can improve discovery and should be registered as a source when available. It does not replace live, bounded metadata evidence.

To run one confirmed read-only statement against a SQLite file through Verchestra's own worker, follow the [probe quick start](https://github.com/accd/verchestra/blob/main/docs/probe-quick-start.md): it registers the database, writes, registers and approves the worker, and ends at the result envelope.
