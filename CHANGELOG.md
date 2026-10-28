# Changelog

All notable changes to Verchestra are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `vestra task check --request <file>` reports every prerequisite of a governed
  task at once, each with the code and recovery its refusal would give, and
  reads no credential value (#593).
- `vestra <command> --help` prints the command's usage and the options it
  takes.
- A refusal in human mode names its safe details, so `VES_TASK_NOT_CONFIGURED`
  says which requirement is missing without `--output json`.
- A missing gate allowlist (`task-gates.json`) prints the path that was read
  and a template with an entry per gate the request names. `task start` and
  `task resume` refuse it before any credential is read.
- When a request names a model no driver accepts, `task plan` lists the models
  each driver takes.
- `vestra --version` from a published release names the source revision it was
  sealed at, and the version JSON gains `revision`.
- Public repository foundation, community documentation, issue forms, CI, and dependency update policy.
- Static product website and searchable documentation portal with canonical content projection, cross-browser accessibility qualification, and verified GitHub Pages delivery.
- Provider-neutral root and scoped agent instructions, deterministic repository
  context/readiness gates, portable feature handoffs, and cross-agent
  evaluation corpus.
- Root and published `llms.txt`, attributed `llms-full.txt`, and deterministic
  Markdown alternates for public documentation.

### Changed

- Both published commands refuse a Node older than 24.14.0 with
  `VES_VESTRA_HOST_UNSUPPORTED` (exit 64) instead of failing inside the bundle.
- Every read from the release source gives up after 30 seconds: a stalled read
  fails with `VES_TUF_SOURCE_TIMEOUT` (exit 70) instead of hanging.
- On Windows, the Codex login hint is a PowerShell command.
- A published `task` command no longer prints Node's SQLite
  experimental-feature warning.
- Recovery text names the quick start by its GitHub URL.
- Every helper process outside a provider session is killed when it outlives
  its bound: a task's `git` after ten minutes, failing with reason
  `VES_GIT_TIMEOUT`, and a provider `--version` probe, the workspace scanner's
  `git`, the process table, and `taskkill` after one minute (#597).
- A resumed budget ledger with no stop reason is refused with
  `VES_BUDGET_INVALID`, the rule a task command already applied to a stored
  one (#597).
- `jose` 6.2.13.

### Security

- The transitive `qs` moves from 6.16.0 to 6.16.1 in the lockfile, fixing a
  denial of service in `qs.stringify` with comma-joined arrays (Dependabot
  alert 71). It reaches the product through the MCP SDK's `express` and
  `body-parser`, which only parse; no manifest changes.
- The out-of-process probe host, not yet composed into any command, closes the
  three limits its post-merge review found (#569). It stops a worker's whole
  tree, `setsid` descendants included, before killing it, and fails a probe
  whose worker exited first or whose output outlives the kill. It refuses,
  before anything starts, a launch whose executable, arguments or environment
  the approval does not name, and loader variables such as `NODE_OPTIONS`
  outright. Admission resolves the extension and looks its approval up itself.
- The probe host refuses a worker frame under a payload schema version other
  than 1 with `VES_PROBE_PAYLOAD_SCHEMA_UNSUPPORTED`, instead of reading it as
  version 1 (#570).
- CI installs the Claude Code and Codex CLIs it qualifies the drivers against
  with `npm ci` from a committed lockfile, `.github/qualified-providers/`, so
  every package is checked against a pinned sha512, the platform binaries
  included. A platform package npm skips fails the step by name.
- `git` starts only from an absolute `PATH` entry, and `taskkill` only from
  `System32`, so a `git.exe` planted in a repository never runs.
- The task path's `git` commands disable repository hooks and `fsmonitor`, so a
  versioned `core.hooksPath` never runs during a task.
- A task path's trailing dots are folded as Windows folds them, so `.git.` and
  `config.json.` are refused like `.git` and `config.json`.
- `vestra init` and the workspace scanner start `git` with the same scrubbed
  environment as a task, so an inherited `GIT_DIR` or `GIT_CONFIG_*` cannot
  point them at another repository.
- `self-test` refuses a base folder that is a link or that another user owns,
  and keeps its own base folder at mode 0700.
- On Windows, a task path that names a device (`con`, `nul`, `aux`, `prn`,
  `com1`-`com9`, `lpt1`-`lpt9`, with any extension) is refused.
- `fast-uri` 3.1.9 in the agent runtime (GHSA-w74x-v6f9-j3xg,
  GHSA-xhq7-xmqj-769h, GHSA-wjr9-j795-jxcr, GHSA-333x-w4r6-6crp).

## [0.0.0-qualification.8] - 2026-10-23

Release `release:verchestra:0.0.0-qualification.8:d83fc139a846`, publication
ledger sequence 8.

### Added

- `vestra task` proves the Codex account offers every model a run names before
  it spends anything (#406).
- A request can name a model a subscription offers with no per-token price
  (#406).
- A failed run records the cause its driver reported (#406).

### Fixed

- Windows: a per-run directory is proven readable by its owner alone without
  an elevated session (#555).
- Windows: a Credential Manager program ends before its value line unless the
  logging guard ran to its end (#565).

## [0.0.0-qualification.7] - 2026-10-04

Release `release:verchestra:0.0.0-qualification.7:2e97443ea601`, publication
ledger sequence 7.

### Added

- Coordinated runs (agent, graph, and swarm) through `vestra task`, on Claude
  and ChatGPT subscriptions with extra usage confirmed off, including
  suspension on a quota signal and resume.
- The governed task path on Windows, over a named-pipe bridge.

### Fixed

- Codex login secrets and account identifiers are withheld from node results
  and records.

## [0.0.0-qualification.6] - 2026-10-03

Release `release:verchestra:0.0.0-qualification.6:7e274f237648`, publication
ledger sequence 6.

### Added

- One routine terminates a provider's whole process tree, and Claude Code and
  Codex start in their own process group.

### Fixed

- A protected path is refused in any letter case or spelling.
- A verifier does not start once the run's budget ceiling was reached.
- A provider that cannot be spawned, or writes a line that is not a JSON
  object, ends its run instead of the host process.

## [0.0.0-qualification.5] - 2026-10-02

Release `release:verchestra:0.0.0-qualification.5:e17abb3c8970`, publication
ledger sequence 5.

### Added

- Subscription or API-key credentials, chosen per provider, with the mediated
  Claude Code subscription profile and a Workspace-owned Codex identity
  directory; subscription usage is metered without a cost.

### Fixed

- The task path runs Git with a scrubbed environment and refuses a task state
  root that resolves outside the Workspace.

## [0.0.0-qualification.4] - 2026-10-01

Release `release:verchestra:0.0.0-qualification.4:d58a25f3d80a`, publication
ledger sequence 4.

### Added

- The governed `vestra task` commands: plan, approve, start, status, resume,
  cancel, and review (#405).

### Fixed

- The documentation runs the CLI through the `verchestra` package, never a
  bare `npx vestra`.

## [0.0.0-qualification.3]

Release `release:verchestra:0.0.0-qualification.3:6725554a8e14`, publication
ledger sequence 3. See `docs/qualification/tuf-publication-ledger.json`.

## [0.0.0-qualification.2]

Publication ledger sequence 2; the ledger records no release id for it. See
`docs/qualification/tuf-publication-ledger.json`.

## [0.0.0-qualification]

Release `release:verchestra:0.0.0-qualification:a49f3dd5aa3e`, publication
ledger sequence 1.

### Added

- Qualified delivery-harness foundations through T68, including policy, workspace, drivers, read-only data probes, memory, portable evidence, handoff, distribution, TUF resolution, transactional activation, rollback, and uninstall safety.
