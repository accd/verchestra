---
title: Oracle
description: Read-only Oracle discovery through approved catalog views and bounded selects.
---

The Oracle adapter exposes approved catalog views and application schemas through normalized metadata and query operations.

Catalog access is allowlisted. Dynamic SQL, procedures, writes, unapproved functions, and objects outside registered schemas are denied. A database read-only principal and bounded session limits are required.

Evidence stores the observed product, plan identity, limits, and redacted result metadata.
