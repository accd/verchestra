---
title: MongoDB
description: Bounded read-only discovery for approved MongoDB databases and collections.
---

The MongoDB adapter maps relational “schema” scope to approved databases and collections. It validates server identity and compiles bounded metadata or read operations.

Mutation stages, server-side code, unapproved pipelines, cross-database scope, excessive results, and sensitive output are denied. Use a role restricted to the exact read surface.

Connection strings are local secrets. Evidence contains target identity, operation digest, limits, and redacted result metadata.
