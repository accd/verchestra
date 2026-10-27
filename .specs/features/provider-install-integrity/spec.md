# Provider install integrity (#596, item 2)

## Problem

Four workflows install the provider CLIs the fleet qualifies the drivers
against: `ci.yml`, `full-validation.yml`, `platform-matrix.yml` and
`t76-candidate-build.yml`. Each runs `npm install --global` of
`@anthropic-ai/claude-code@2.1.282` and `@openai/codex@0.115.0`. The versions are
pinned, but no lockfile or hash checks the bytes. Both CLIs take their native
binary from optional platform packages: eight for Claude Code, six for Codex.
A global install resolves those through the registry on every run, unchecked
(SEC-010, audit of 2026-10-24).

## Requirements

- **PI-01**: Each of the four workflows SHALL install the providers with
  `npm ci` from a committed lockfile. The lockfile SHALL pin a sha512 integrity
  and a registry.npmjs.org tarball for every package, the platform binaries
  included.
- **PI-02**: A package the lockfile names for the runner's OS and CPU that npm
  did not install SHALL fail the step and be named. npm treats a failed optional
  package as a warning, including one that fails its integrity check.
- **PI-03**: Lifecycle scripts SHALL stay off, except the postinstall of
  `@anthropic-ai/claude-code`, which is rebuilt by name. The lockfile SHALL record
  no other install script.
- **PI-04**: The versions in the committed manifest SHALL be the versions each
  workflow verifies with `--version`.
- **PI-05**: The providers SHALL be installed outside the checkout. They SHALL
  reach later steps through `GITHUB_PATH`, so the probes still resolve them by
  `PATH` on Linux, macOS and Windows.
- **PI-06**: A change to the manifest, the lockfile or the install check SHALL
  select the conservative gates.

## Shape

| Path                                            | Role                                                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `.github/qualified-providers/package.json`      | private manifest with the two exact pins                                                                                 |
| `.github/qualified-providers/package-lock.json` | npm lockfile v3: 16 packages, each with `integrity` and `resolved`                                                       |
| `scripts/verify-provider-install.mjs`           | after `npm ci`, refuses a missing or different package for this OS and CPU                                               |
| the four workflows                              | copy both files to `$RUNNER_TEMP/qualified-providers`, `npm ci`, check, rebuild Claude Code, add `.bin` to `GITHUB_PATH` |

## Decisions

- **A lockfile, not tarball hashes.** A hash of the two top-level tarballs
  would leave the 14 platform packages unchecked, and those packages hold the
  binaries the probes execute. Claude Code's postinstall only links its binary
  out of the platform package (`install.cjs`: a hard link, else a copy). It
  fetches nothing, so the lockfile covers every byte installed.
- **Outside the checkout.** A `node_modules` inside the checkout would be
  walked by the architecture tests and seen by the candidate build's tree
  checks. `$RUNNER_TEMP` is per job and outside the checkout.
- **No Codex rebuild.** `@openai/codex@0.115.0` has no install script, so the
  rebuild names only Claude Code. A future Codex with one fails PI-03's test
  until its rebuild is reviewed.
- **Read from the checked-out revision.** `platform-matrix.yml` and
  `t76-candidate-build.yml` check out a candidate revision, so the lockfile is
  the candidate's own, like the gate stages they derive. A revision older than
  this change has no lockfile, and its install fails at the copy.
- **Not in Dependabot version updates.** The pins move only with a driver
  requalification, as every pin bump so far has. `dependabot.yml` does not
  list the directory. Security alerts still reach it through the dependency
  graph.
- **The bump procedure.** Edit both versions in `package.json`, run
  `npm install --package-lock-only --ignore-scripts` in the directory, and move
  the four workflows' `--version` checks. The tests refuse a manifest and a
  workflow that disagree.
