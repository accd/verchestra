---
title: PostgreSQL
description: Read-only PostgreSQL metadata and bounded query discovery.
---

The PostgreSQL adapter limits discovery to registered databases, approved schemas, catalog metadata, and bounded `SELECT` plans.

It verifies the observed product and applies transaction, timeout, row, byte, and object-scope controls. PostgreSQL system catalogs are available only through approved metadata operations; arbitrary catalog or function access is denied.

Always use a read-only database role. Verchestra records query and result digests, never the credential.
