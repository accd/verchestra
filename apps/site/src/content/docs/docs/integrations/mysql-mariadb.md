---
title: MySQL and MariaDB
description: Engine-aware read-only discovery across the MySQL family.
---

MySQL and MariaDB share a family adapter with explicit engine identity. Version and product checks prevent a MariaDB server from being treated as qualified MySQL, or the reverse.

The adapter constrains approved schemas, system-catalog access, statement time, rows, bytes, and normalized operations. Engine-specific timeout behavior is compiled rather than assumed.

A read-only principal remains mandatory even when a server offers a read-only transaction mode.
