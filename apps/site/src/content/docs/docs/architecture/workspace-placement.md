---
title: Workspace placement
description: Keep shared delivery state trackable while machine authority stays local.
---

Tracked `.verchestra` artifacts contain portable project facts, packages, decisions, and evidence manifests. Documented local subtrees such as `.local`, `.runtime`, `.cache`, `.sessions`, `.worktrees`, and `.secrets` are ignored.

Monorepos can colocate project artifacts or centralize everything at the root. Placement is recorded in workspace policy and reconciled idempotently when projects appear or move.

Per-machine driver selection and credentials may also live in an operating-system configuration directory outside the repository. A teammate recreates those bindings after `git pull`; they do not recreate shared discovery.
