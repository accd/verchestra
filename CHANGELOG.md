# Changelog

All notable changes to Verchestra are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Public repository foundation, community documentation, issue forms, CI, and dependency update policy.
- Static product website and searchable documentation portal with canonical content projection, cross-browser accessibility qualification, and verified GitHub Pages delivery.
- Provider-neutral root and scoped agent instructions, deterministic repository
  context/readiness gates, portable feature handoffs, and cross-agent
  evaluation corpus.
- Root and published `llms.txt`, attributed `llms-full.txt`, and deterministic
  Markdown alternates for public documentation.

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
