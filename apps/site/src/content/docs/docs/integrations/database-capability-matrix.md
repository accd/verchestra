---
title: Database capability matrix
description: Supported read-only probe engines and their first-class safety contract.
---

All database adapters share the same boundary: registered targets, read-only identity, bounded operations, parser-level denial, resource limits, and redacted evidence.

| Engine | Adapter identity | Discovery surface |
| --- | --- | --- |
| **SAP ASE / Sybase** | `sybase` / `sap-ase` | catalogs, schemas, approved objects, bounded selects |
| PostgreSQL | `postgresql` | catalogs, schemas, approved objects, bounded selects |
| MySQL | `mysql` | catalogs, schemas, approved objects, bounded selects |
| MariaDB | `mariadb` | catalogs, schemas, approved objects, bounded selects |
| SQL Server | `sqlserver` | catalogs, schemas, approved objects, bounded selects |
| Oracle | `oracle` | approved catalog views, schemas, bounded selects |
| SQLite | `sqlite` | approved schemas, metadata, bounded selects |
| MongoDB | `mongodb` | approved databases and collections, bounded reads |

“Supported” describes the implemented adapter contract and its repository qualification evidence. It is not a production-readiness claim for every external version or topology.
