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
| Approval of something other than what was reviewed | The binding digest covers package, source state, scope, destinations, budgets, gates, policy, and context manifest; the human types it back; the package and policy are re-proven before sealing | GTC-29 |
| A review sealing a Run Capsule over a package other than the approved one | `review` proves the package against the digest the plan bound, through the reader `approve` uses, before the surface is read or the review is recorded | RRH-01, RRH-02 (`.specs/features/run-record-hardening/`) |
| An approval outliving a policy change | The binding is rebuilt from the current Workspace policy at every check; a changed policy makes it stale | GTC-31 |
| A script approving or reviewing by accident | No terminal and no `--confirm-stdin` is refused; the flag still requires the exact digest on stdin | GTC-29, GTC-36 |
| A request smuggling an executable into a gate | Gates name a `commandRef`; executables come only from the user's machine-local allowlist | GTC-28, GTC-34 |
| Credential exposure across roles | Each provider child gets only its own key from the broker; neither key reaches the other child or any evidence | GTC-32 |
| A verifier that rubber-stamps | Its claims are checked: cited lines must exist at the commit and reverting the named file must fail the gates | GTC-33 |
| Tampered run state steering a later command | Plan, commit, evidence, and review records are sealed by digest and re-validated on load | GTC-37 |
| A link planted below a task state root redirecting a read, a write, or the recursive delete of a scratch checkout | Every directory from the per-Run root down is checked to be a real one before each read and write (`VES_STATE_ROOT_ESCAPE`); a link in the place of an artifact is refused by readers and writers and never replaced | RRH-04..10 (`.specs/features/run-record-hardening/`) |
| Two writers in one Workspace | One writer lease per Workspace, proven before the first transition | GTC-30 |

## Residual risks (accepted, documented)

- Human approval and review are local decisions confirmed by typing a digest
  back; they are not a cryptographic proof of identity. `--confirm-stdin`
  exists for scripted use and is documented as such.
- The `evidence-signing-passphrase` and both provider keys are readable by any
  process of the same user that can run `/usr/bin/security` (AD-034).
- Token and cost ceilings are evaluated when usage is reported, and Claude
  Code reports at the end of its session; the duration timer is the hard
  guard.
- A run interrupted during the implementer session resumes with a new session
  in the same worktree; writes it re-issues are new receipts.

- The controller checks paths and then acts; a concurrent writer inside the
  worktree could swap a parent directory between check and write. The
  implementer has no write tool of its own, so the only writer is the adapter.
- The task state checks read and then act. A link placed below a task state
  root between a check and the read or write that follows it is not detected.
  The only writer there besides Verchestra is another process of the same
  user.
- Claude Code keeps network access to the provider API. This is process
  configuration, not an OS sandbox; egress confinement is outside this slice.
- A process of the same OS user can read the per-run config and connect with
  the token. That actor can already read the repository and credentials.
- Claude Code starts the relay with its own environment merged into the relay's
  configured environment, so the relay process can see the brokered
  credential. The relay never reads, logs, or forwards it, and holds no other
  authority.
- The executor compares change scope and protected paths case-sensitively. On a
  case-insensitive volume the worktree tool adapter and the read tools also
  refuse case aliases of `.git` and protected roots; the executor's own
  comparison is unchanged in this slice.
- The mediated profile is qualified with a labeled fake executable and a
  read-only `--help`/`--version` probe of the installed build; live model
  behavior is evidence for #406, not this slice.
