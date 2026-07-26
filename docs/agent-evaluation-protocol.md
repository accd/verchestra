# Agent Evaluation Protocol

`pnpm agent:eval` sends the same provider-neutral corpus to every adapter and
validates structured outcomes in a disposable detached worktree.

## Local profile

Real profiles live under ignored `.verchestra/.local/agent-eval/`. A profile is
JSON with:

- `schemaVersion: 1`;
- a unique `name` and `provider`;
- exact `toolVersion` and `modelVersion`;
- an executable `command`;
- an `args` array using `{corpusFile}`, `{resultFile}`, and optionally
  `{workspace}` placeholders.

The command runs directly without a shell. It must read the corpus, perform no
external write, and write:

```json
{
  "schemaVersion": 1,
  "results": [
    {
      "id": "case-id",
      "result": {
        "decision": "proceed",
        "canonicalPath": "AGENTS.md",
        "command": "corepack pnpm agent:context -- --json",
        "status": "T68 complete; T69 next",
        "patches": []
      }
    }
  ]
}
```

Create separate local profiles for Claude Code, Codex, and OpenCode/Qwen. The
adapter is responsible for translating this neutral protocol into the tool's
local CLI invocation. Do not commit profiles, credentials, provider output, or
runtime worktrees.

## Commands

```bash
pnpm agent:eval -- --config .verchestra/.local/agent-eval/claude.json
pnpm agent:eval -- --matrix .verchestra/.local/agent-eval
```

An unavailable provider is reported as `not configured`. A pass qualifies only
the exact recorded tool and model versions. Live results never replace
`pnpm agent:check`, repository gates, independent verification, or human review.

