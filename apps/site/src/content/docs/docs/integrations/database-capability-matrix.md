---
title: Database capability matrix
description: The published probe contract, the conformance kit, and how engines qualify at the edge.
---

All database adapters share the same boundary: registered targets, read-only identity, bounded operations, parser-level denial, resource limits, and redacted evidence.

| Engine | Adapter identity | Discovery surface |
| --- | --- | --- |
| SQLite | `sqlite` | approved schemas, metadata, bounded selects |
| MongoDB | `mongodb` | approved databases and collections, bounded reads |
| MySQL | `mysql` | catalogs, schemas, approved objects, bounded selects |
| MariaDB | `mariadb` | catalogs, schemas, approved objects, bounded selects |
| Oracle | `oracle` | approved catalog views, schemas, bounded selects |
| PostgreSQL | `postgresql` | catalogs, schemas, approved objects, bounded selects |
| SAP ASE / Sybase | `sybase` / `sap-ase` | catalogs, schemas, approved objects, bounded selects |
| SQL Server | `sqlserver` | catalogs, schemas, approved objects, bounded selects |

## How an engine qualifies

Two different claims apply, and the table above earns only the first by itself:

- **Contract-verified** — every engine: the adapter implements the shared read-only contract and passes the repository's conformance suite against recorded fixtures.
- **Live-qualified** — SQLite only, today: the real driver runs through the identical supervisor bounds and assertions inside this repository's gates.

Every other engine qualifies **at the edge**: your team implements the published connection port for its engine inside your own repository, runs the conformance kit against your own database, and commits the probe — from then on the kit re-verifies it in your CI on every engine or contract upgrade. SQLite leads the table because it is the one engine this repository live-qualifies itself.

"Supported" therefore describes the implemented adapter contract and its repository qualification evidence. It is not a production-readiness claim for every external version or topology, and it never claims a live engine this repository does not run.
