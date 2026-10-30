# Quick start: probe a SQLite database through Verchestra's worker

This guide takes one read-only statement from a request file to a printed
result envelope. You write Verchestra's own SQLite probe worker into your
repository, review and commit it like any other code, register and approve
it, and run one probe through it against a SQLite file. Only Workspace code
you approved runs, and you confirm every probe before it starts.

> **Status:** `0.0.0-qualification`. This is not a production release and not
> 1.0. The published npm package (`verchestra@0.0.0-qualification`) predates
> `vestra probe worker` and the probe commands this guide uses, so today the
> guide runs from a source checkout. The governed task path has its own guide,
> [Quick start: deliver one governed task](quick-start.md).

## What you need

- **Linux or macOS** for the probe itself. `vestra probe run`, `vestra
  extension approve` and `vestra extension check` refuse Windows with
  `VES_PROBE_HOST_PLATFORM_UNSUPPORTED`; `vestra probe worker` writes the file
  on every platform.
- **`git`** on `PATH`, and a repository with at least one commit and an
  `origin` that is a URL or a host path, not a local directory. The skill lock
  records the origin without its credentials.
- **Node 24.14.0** and Corepack, for the checkout. The approval names one
  Node executable by its absolute path, and pins its real path and its bytes.
- **A credential store** for the Workspace signing passphrase: the keychain
  on macOS, a running Secret Service session on Linux.
- **A SQLite file.** The worker opens it read-only. It is project input, not
  Verchestra memory: never commit a sensitive database to enable a probe.

## 1. Run Verchestra from a source checkout

Clone and build once. `build:probe-worker` writes the worker bundle to the
checkout's `apps/vestra-cli/dist/sqlite-probe-worker.mjs`, which Git ignores;
without it `vestra probe worker` refuses with `VES_PROBE_WORKER_UNAVAILABLE`
and names this command.

```bash
git clone https://github.com/accd/verchestra.git ~/src/verchestra
cd ~/src/verchestra
corepack enable
pnpm install --frozen-lockfile
corepack pnpm build:probe-worker
vestra() { node ~/src/verchestra/apps/vestra-cli/bin/vestra.mjs "$@"; }
```

The last line makes `vestra` in this shell run the checkout's launcher,
`node apps/vestra-cli/bin/vestra.mjs`, from any directory. Every `vestra` line
below goes through it.

## 2. Initialize the Workspace

Run this from the root of your repository, then bind the evidence signing
passphrase, which unlocks the Workspace key that signs the database
registration, the skill lock, the worker's approval and each probe's approval.
Paste a long random value at the hidden prompt of `secret set`; it is never
printed.

```bash
cd ~/src/my-repo
vestra init --workspace-id "workspace_$(node -e 'console.log(crypto.randomUUID())')" \
  --name "My repository" --placement colocated
vestra secret set --name evidence-signing-passphrase
```

## 3. Register the database

A registration names the database, how it is classified and what may be read
from it. It contacts nothing. Save this as `orders-database.json`:

```json
{
  "schemaVersion": 1,
  "database": {
    "databaseId": "orders",
    "engine": "sqlite",
    "logicalEnvironment": "staging",
    "classification": "confidential",
    "approvedSchemas": ["main"],
    "schemaSourceRefs": ["repo:db/orders.sql"],
    "allowedPurposes": ["diagnostics"],
    "logicalCredentialName": "orders-reader",
    "production": false
  },
  "policy": {
    "allowedObjects": ["main.orders"],
    "allowedFunctions": ["count"],
    "deniedFunctions": [],
    "allowCatalogAccess": false,
    "maxTimeoutMs": 20000,
    "maxRows": 100,
    "maxBytes": 1048576,
    "maxConcurrency": 2
  }
}
```

```bash
vestra database add --definition orders-database.json
```

`logicalCredentialName` is a label the plan carries. No secret stands behind
it for SQLite, and Verchestra resolves none.

## 4. Write the worker

```bash
vestra probe worker --engine sqlite --entry probe/sqlite-worker.mjs
```

The command writes the worker bundle to `probe/sqlite-worker.mjs` and prints
`path`, `engine` (`sqlite`), `digest` (the `sha256:` of the bytes it wrote)
and `written` (`true`). The path follows the rule `vestra extension add`
applies to an entry: inside the repository's Git top level, with no link on
it and not a directory; anything else is refused with
`VES_PROBE_WORKER_TARGET_INVALID`.

Running it again on a file with the same bytes changes nothing and prints
`written: false`. A file with other bytes is never overwritten: the command
refuses with `VES_PROBE_WORKER_TARGET_CONFLICT`. To take a newer worker,
remove the file, write it again, and register the new digest.

## 5. Commit the worker

The worker is one self-contained file that imports only Node built-ins. Review
it and commit it like any other code:

```bash
git add probe/sqlite-worker.mjs
git commit -m "Add Verchestra's SQLite probe worker"
```

## 6. Register the worker

```bash
vestra extension add --skill acme-orders-sqlite --extension plugin:acme-orders-sqlite \
  --entry probe/sqlite-worker.mjs --approval-ref orders-sqlite --version 1.0.0 --license Apache-2.0
```

`extension add` pins the file's digest in the Workspace's signed skill lock,
under the extension id and approval reference you choose. The digest is the
one `vestra probe worker` printed. The lock is tracked content; commit it too.

## 7. Approve the launch with the database file

The worker takes exactly two values from its approved environment:
`PROBE_SQLITE_PATH`, the absolute path of the SQLite file, and
`PROBE_COMPONENT_ID`, the extension id it names itself by, which must equal
the `--extension` you registered.

```bash
vestra extension approve --approval-ref orders-sqlite --executable "$(command -v node)" \
  --env PROBE_SQLITE_PATH="$HOME/data/orders.sqlite" --env PROBE_COMPONENT_ID=plugin:acme-orders-sqlite
```

`approve` prints the worker's component digest and the launch digest on
stderr and asks you to type the launch digest back. The launch digest covers
the executable's real path and bytes, the arguments, the environment and the
worker's digest, so the database file and the id are part of what you approve.
One approval names one database file; approve another reference for another
file. An approval expires after 30 days unless `--expires` says otherwise,
and an upgraded Node needs a new one.

A worker approved without either variable, with an empty one, or with a
relative path exits before its handshake, and every run through it ends
`FAILED`. A worker whose `PROBE_COMPONENT_ID` is not its extension id is
refused at its handshake with `VES_PROBE_HANDSHAKE_COMPONENT`.

## 8. Check admission

```bash
vestra extension check --approval-ref orders-sqlite
```

`check` reports the lock, the extension, the approval, admission, the entry
and the launch as admission would judge them, without starting the worker. It
exits 0 when every row passes; otherwise it exits 4 and names each row that
fails.

## 9. Run a probe

A request names the purpose, one `SELECT` over `main`-qualified objects with
anonymous binds, its parameters, and the bounds. Save it as
`orders-request.json`:

```json
{
  "schemaVersion": 1,
  "purpose": "diagnostics",
  "sql": "SELECT id, status FROM main.orders WHERE id = ?",
  "parameters": [1],
  "bounds": { "timeoutMs": 20000, "rowLimit": 100, "byteLimit": 100000, "concurrencyLimit": 1 }
}
```

```bash
vestra probe run --database orders --approval-ref orders-sqlite --request orders-request.json --output json
```

Before anything starts, `probe run` prints a review on stderr: the database,
its classification, the purpose, the statement's fingerprint, the objects
read, the bounds, the worker and its launch digest, and a binding digest. Type
the binding digest back to start the run; anything else aborts it. A script
can pipe the digest in with `--confirm-stdin` instead.

## 10. Read the envelope

The run prints one JSON envelope on stdout. `ok` is `true` and `data` holds
the run's `runId`, `approvalId` and `grantId`, and its `result`:

| Field | What it says |
| --- | --- |
| `status` | `complete` |
| `rowCount`, `byteCount` | how many rows the worker returned, and their size |
| `resultDigest` | the digest of those rows; the rows themselves are neither printed nor kept |
| `queryFingerprint` | the fingerprint of the statement the review showed |
| `principalFingerprint` | the fingerprint of SQLite's read-only identity |
| `identityReadOnly`, `sessionReadOnly` | `true`: the file was opened read-only, with `query_only` set |
| `grantRef` | the single-use grant the run ran under, revoked when it ended |

The envelope carries no row and no parameter value. The run is recorded as
`COMPLETED`; a refused run is recorded as `FAILED` and its grant revoked.

## Limits

- `vestra probe run` runs on Linux and macOS only. The out-of-process probe
  host is qualified on POSIX hosts.
- SQLite is the only engine. `vestra probe worker` refuses any other
  `--engine` with `VES_PROBE_WORKER_ENGINE_UNSUPPORTED`.
- Verchestra delivers no database credential to a worker. The SQLite worker
  needs none: it reads the file its approved launch names.
- A written worker is not updated in place, and an approval does not survive
  an upgraded executable: write, register and approve again.
