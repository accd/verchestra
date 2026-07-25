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

Provider-specific prompts are never the handoff contract. Jira or Confluence may expose a human-readable projection, but the signed repository package remains the executable source of truth.
