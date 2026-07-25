---
title: Evidence
description: Preserve reproducible observations while excluding secrets and unsafe content.
---

Evidence producers emit typed records with source, command or operation identity, limits, exit state, selected observations, digests, and redaction metadata.

Support bundles use an allowlist and prohibited-content scan. Credentials, raw prompts, unrestricted logs, database rows, environment dumps, and machine-local paths cannot be promoted.

Signatures and provenance bind evidence to the package and source commit. Retention policy controls when local raw material is deleted or quarantined.
