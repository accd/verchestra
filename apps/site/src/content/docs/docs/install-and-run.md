---
title: Install and run
description: Install the published Verchestra launcher with npx, run the portability demonstration, and remove its managed state.
---

Verchestra is published as one npm package, `verchestra@0.0.0-qualification`.
Installing it needs no clone, no build, no credential, and no configuration.

```bash
npx verchestra --help
```

The package provides two equivalent binaries, `verchestra` and `vestra`.

:::caution[This installs the qualification build]
The published package installs `0.0.0-qualification`. It is not a production
release and not 1.0. The 1.0 decision is T77.
:::

## What the first run does

The first run does the real work:

1. it checks that your platform and architecture are qualified by the release;
2. it reads the trust root and release source pinned inside the package;
3. it resolves and stages that exact release through TUF, verifying every
   component byte;
4. it activates the release transactionally behind a health gate; and
5. it hands control to the activated release's own launcher.

Your ambient Node runs the bootstrap and nothing else. The activated release
carries its own Node runtime, so Node is not a prerequisite beyond what `npx`
itself needs. Expect a couple of minutes on a cold first run, and a few seconds
once a release is activated.

One prerequisite is not bundled: a `git` binary must be on `PATH`, because the
Self-Test profiles provision their fixtures by invoking `git`.

## Prove portability on your own machine

```bash
npx verchestra self-test --profile smoke
```

A `self_test.verdict: PASS` with an empty `self_test.failure_codes` means this
machine resolved and verified a signed release, activated it, and ran the
packaged Self-Test profile inside a disposable, isolated trust domain — with no
repository checkout anywhere in the journey. The run also reports its check
count, duration, and redaction count, and seals a report.

:::caution[Known limitation]
`self-test` currently refuses when the working directory is an ancestor of the
operating system's temporary directory. On Windows the default home directory
is such an ancestor, so a shell opened at its default location fails with
`VES_CLI_COMMAND_FAILED`. Run the command from a project directory until the
fix ships. Tracked as
[issue #370](https://github.com/accd/verchestra/issues/370).
:::

## Managed state, recovery, and cleanup

The launcher keeps its staged releases, its activated install, its trust anchor,
and the active-release pointer under one machine-local state root. Nothing of
yours is stored there.

| Platform | Managed state root                               |
| -------- | ------------------------------------------------ |
| Windows  | `%LOCALAPPDATA%\Verchestra\state`                |
| macOS    | `~/Library/Application Support/Verchestra/state` |
| Linux    | `~/.local/state/verchestra`                      |

The launcher derives that location from your home directory and the platform
alone. It deliberately reads no environment variable, so redirecting
`LOCALAPPDATA` or `XDG_STATE_HOME` does not move it and cannot be used to
redirect a trust root or a release.

To recover from a failed run, run the command again: activation is transactional
and converges. If activation keeps failing, delete the managed state root and run
the command again — the next run resolves and activates from scratch.

To remove Verchestra completely, delete the managed state root and clear the
downloaded package with `npm cache clean --force`. The two are independent, and
neither touches your own workspace data.
