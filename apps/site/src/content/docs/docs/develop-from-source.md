---
title: Develop from source
description: Work on the Verchestra source tree from a clean clone.
---

To run Verchestra, [install and run](/verchestra/docs/install-and-run/) the published launcher. This page is for working on the source tree instead:

```bash
git clone https://github.com/accd/verchestra.git
cd verchestra
corepack enable
pnpm install --frozen-lockfile
pnpm gate:quick
```

## Initialize a workspace from the checkout

`init` is the qualified workspace command. From the root of a disposable Git repository, invoke the checked-out CLI directly (the script path below is relative to your Verchestra checkout) and pass an explicit, portable workspace identity:

```bash
node apps/vestra-cli/bin/vestra.mjs init --dry-run \
  --workspace-id workspace_018f0b6d-7b1a-7abc-8def-0123456789ab \
  --name "My workspace" \
  --placement centralized \
  --output json
```

`--dry-run` is read-only and returns the canonical ordered plan. Review it, then repeat the command without `--dry-run` to apply the qualified workspace files. Repeating the identical apply is a no-op. `bootstrap`, `sync`, and `workspace reconcile` are intentionally not advertised yet.

Adding `--probe-engine postgresql` (one of `postgresql`, `mysql`, `mariadb`, `sqlserver`, `sap-ase`, `oracle`, `sqlite`, or `mongodb`) to the same command emits a probe scaffold under `.verchestra/probes/<engine>` through the same preview and apply; the scaffold's contents and rules are in the [data-probe contract](https://github.com/accd/verchestra/blob/main/docs/data-probe-contract.md).

## Run and verify the documentation portal

Run the documentation portal:

```bash
pnpm site:dev
```

Build and verify it:

```bash
pnpm site:test
pnpm site:build
```

Use Node `24.14.0` and the locked pnpm version. Do not add credentials, machine profiles, runtime state, support archives, or generated output to Git.
