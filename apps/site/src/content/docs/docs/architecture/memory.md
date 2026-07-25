---
title: Memory
description: Combine deterministic project state with policy-filtered semantic retrieval.
---

Memory uses SQLite for lifecycle and provenance, SQLite FTS for exact retrieval, and `sqlite-vec` for semantic retrieval. These components are open source and packaged as rebuildable local infrastructure.

Committed manifests identify approved sources and durable knowledge. Machine-local indexes and embeddings remain untracked because they can be rebuilt and may contain sensitive derived context.

Every result carries source identity, recency, and retrieval metadata. Memory informs discovery; it does not automatically become accepted truth.
