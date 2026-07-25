---
title: Monorepo operating modes
description: Place shared and project-specific Verchestra artifacts safely in complex workspaces.
---

Verchestra supports three placement modes.

## Colocated

Shared orchestration lives at the monorepo root; project-specific artifacts live inside each tracked project.

## Centralized

All AI-delivery artifacts stay under the root workspace and refer to project directories by stable identifiers. Use this when child repositories cannot contain AI files.

## Nested-aware

The root inventory may include ignored child directories that are separate GitLab or GitHub repositories. Verchestra records repository boundaries and never assumes that the outer repository owns their files.

A reconciliation command can discover new projects, preserve existing IDs, and generate only missing artifacts. Placement is policy, so a refresh cannot silently move tracked files between modes.
