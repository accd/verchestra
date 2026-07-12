# SQLite Memory Stack Qualification

## Decision

Verchestra 1.0 qualifies the `node:sqlite` API bundled with exact-pinned Node 24.14.0 for local relational and FTS authority. The qualified runtime reports SQLite 3.51.2 with `ENABLE_FTS5`. File databases open with defensive mode, foreign keys, WAL, and an explicit busy timeout.

`sqlite-vec` 0.1.9 is qualified only as an optional, derived semantic index. The platform asset is checksum-pinned, loaded during controlled initialization, version-checked, and extension loading is immediately disabled. Any missing, mismatched, damaged, or dropped vector index degrades to a fully functional relational/FTS database; vector state never participates in the canonical state digest.

## Exact qualification identity

| Component | Qualified identity |
| --- | --- |
| Node | 24.14.0 |
| Bundled SQLite | 3.51.2 |
| Required compile option | `ENABLE_FTS5` |
| sqlite-vec package | 0.1.9 (latest stable; pre-v1) |
| sqlite-vec runtime version | `v0.1.9` |
| Windows x64 release asset | `vec0.dll`, 289,280 bytes |
| Asset SHA-256 | `fcf98662a7ad9dce394b96a88f91032047823831b951c76636787c312a6476e6` |

The package and platform asset are exact-pinned by `pnpm-lock.yaml`. Alpha 0.1.10 builds are not eligible for Verchestra 1.0.

## Proven safety contract

- Relational `documents` records and FTS5 rows are authoritative; vectors are derived and rebuildable.
- Migrations have immutable SHA-256 checksums and execute atomically. Reusing a migration ID with changed SQL fails closed.
- Canonical ingestion validates the full batch before writing, uses an explicit transaction, and is idempotent by content digest.
- Retrieval requires both Workspace and Project scope and returns provenance, freshness, an untrusted-content marker, and a safe explanation.
- `PRAGMA writable_schema` remains disabled under defensive mode.
- Loadable extensions are denied by default. Vector-enabled initialization temporarily permits only the checksum- and version-qualified asset, then permanently disables further loading on that connection.
- A vector bootstrap or write failure disables semantic retrieval without rolling back or mutating relational/FTS authority.
- Online backup uses SQLite's backup API into a unique staging file. Integrity validation and a content checksum precede publication.
- Lock and corruption paths map to stable recoverable Verchestra errors. Staging-validation and publication failures leave the active database and canonical digest unchanged.
- Backup manifests bind the backup file SHA-256, canonical state digest, and document count.

## Production boundary

This is a dependency qualification spike, not the production memory adapter. T49–T52 must preserve these invariants while adding generation metadata, hybrid retrieval policy, invalidation/tombstones, recovery-set manifests for both `runtime.sqlite` and `memory.sqlite`, and the full supported-platform matrix.

The production adapter must not expose `DatabaseSync`, extension loading, or sqlite-vec imports outside its boundary. It must preserve lexical-only operation and treat all retrieved content as untrusted data, never as authority or instructions.

## Primary sources

- Node SQLite API: <https://nodejs.org/docs/latest-v24.x/api/sqlite.html>
- SQLite WAL: <https://www.sqlite.org/wal.html>
- SQLite PRAGMA reference: <https://www.sqlite.org/pragma.html>
- sqlite-vec repository: <https://github.com/asg017/sqlite-vec>
- sqlite-vec v0.1.9 release: <https://github.com/asg017/sqlite-vec/releases/tag/v0.1.9>
