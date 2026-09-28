# Governed Task CLI Foundations Threat Model (#405)

## Assets

- The user's repository and every path outside the task's change scope.
- Protected paths (`.git`, `.verchestra/policy`, and task-declared paths).
- The Anthropic credential brokered for one run.
- The user's ambient Claude Code login, settings, memory, and `CLAUDE.md`.
- Durable checkpoints, receipts, and the task commit that later evidence cites.

## Actors and trust

| Actor | Trust |
| --- | --- |
| Task Request author | Untrusted input; bounded and normalized before use. |
| Repository content (files, commit messages) | Untrusted data; may contain prompt injection. |
| Model output and tool calls | Untrusted; every effect is re-checked by the executor. |
| Claude Code process and the relay child it launches | Untrusted executors of model intent; hold no write authority. |
| Verchestra controller process | Trusted; owns scope, authority, receipts, and checkpoints. |
| Other local users | Hostile; must not reach the bridge channel or files. |
| Other processes of the same user | Out of scope (they can already read the repository). |

## Threats and controls

| Threat | Control | Evidence |
| --- | --- | --- |
| Model writes outside scope or to a protected path | Built-in tools disabled; writes only through `control.invokeTool`; executor checks scope, protected paths, capability grant, and tool-effect authority; adapter re-confines by realpath | GTC-12, GTC-19, GTC-20 |
| Symlink or `..` escape from the worktree | Logical-path grammar, per-component `lstat`, link refusal, realpath containment | GTC-12, GTC-18 |
| Model runs shell commands | `--tools ""`, `command` denied by the tool adapter, allowlist limited to bridge tools, init tool surface verified | GTC-12, GTC-20 |
| Model reads secrets or files outside context | Read tools limited to worktree ∩ approved read scope; `.git` and protected paths refused; bounded bytes/results | GTC-18 |
| Another local user drives the bridge | Unix socket in a per-run `0700` directory; 256-bit token; single authenticated connection | GTC-17 |
| Ambient login, settings, or `CLAUDE.md` imported | `--bare`, isolated `HOME`/`CLAUDE_CONFIG_DIR`, `--setting-sources ""`, allowlisted environment | GTC-20 |
| Credential leaks into events or evidence | Credential only in child env; must be a sensitive value; redaction on content; checkpoints carry counts only | GTC-20, GTC-22 |
| Duplicate or replayed tool request | Idempotency per `requestId` with durable receipts; conflicting reuse rejected | GTC-13 |
| Content swapped between approval and write | Content addressed by SHA-256; the adapter re-hashes before writing | GTC-14 |
| Tampered checkpoint state steers resume | Digest-verified, shape-validated, identity-bound load; contiguous sequences | GTC-08, GTC-09, GTC-10 |
| Task commit lost when worktree is removed | Opt-in anchoring of `refs/heads/vestra/<run>/<task>` before removal; mismatch keeps the worktree | GTC-15 |
| Oversized request, frame, or file exhausts memory | Bounds on request text, JSON-RPC frames, file reads, searches, payloads | GTC-05, GTC-16, GTC-18 |
| Budget bypass by a silent driver | Usage forwarded to the executor meter; the executor's duration timer still fires | GTC-22 |

## Residual risks (accepted, documented)

- The controller checks paths and then acts; a concurrent writer inside the
  worktree could swap a parent directory between check and write. The
  implementer has no write tool of its own, so the only writer is the adapter.
- Claude Code keeps network access to the provider API. This is process
  configuration, not an OS sandbox; egress confinement is outside this slice.
- A process of the same OS user can read the per-run config and connect with
  the token. That actor can already read the repository and credentials.
- The mediated profile is qualified with a labeled fake executable and a
  read-only `--help`/`--version` probe of the installed build; live model
  behavior is evidence for #406, not this slice.
