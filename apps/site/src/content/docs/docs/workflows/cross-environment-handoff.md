---
title: Cross-environment handoff
description: Continue the same delivery contract on another machine or AI driver.
---

A handoff transfers durable work, not hidden authority.

For example, one engineer can complete discovery and specification with Claude Code. They commit the Execution Package and publish the agreed tracker state. A second engineer pulls the repository and continues with OpenCode/Qwen.

The receiving environment:

1. verifies package and source digests;
2. resolves its own qualified driver;
3. rebuilds local credentials and capabilities;
4. resumes from the last idempotent checkpoint;
5. appends evidence without rewriting accepted history.

The sequence below is the target workflow a handoff follows end to end; today `init` is the part composed into the CLI, and the other steps are qualified piece by piece in the [qualification reports](/verchestra/docs/qualification/).

```mermaid
sequenceDiagram
  participant S as Source environment
  participant V as Verchestra
  participant R as Receiving environment
  participant H as Human reviewer
  S->>V: Capture requirements, evidence, and decisions
  V->>V: Seal a portable Execution Package
  V->>R: Publish signed Handoff
  R->>V: Rebuild local authority and run declared gates
  V->>H: Present independent verification evidence
  H->>V: Accept or reject
```

Provider-specific prompts are never the handoff contract. Jira or Confluence may expose a human-readable projection, but the signed repository package remains the executable source of truth.
