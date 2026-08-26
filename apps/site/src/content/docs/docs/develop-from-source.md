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
