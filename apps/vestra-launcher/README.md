# vestra

`verchestra` is the public launcher for
[Verchestra](https://github.com/accd/verchestra), a verified AI
software-delivery harness.

> **Status: qualification build.** `verchestra@0.0.0-qualification` is published
> on the public npm registry. It is not a production release and not 1.0. A
> build made from anything other than a reviewed, pinned trust root cannot
> anchor a resolution, reports `VES_VESTRA_ACTIVATION_UNAVAILABLE`, and exits
> non-zero without creating or fetching anything.

## Install and run

```bash
npx verchestra --help
```

The package installs two equivalent binaries, `verchestra` and `vestra`. No
clone, build, credential, or configuration is needed. The activated release
carries its own Node runtime, so Node is not a prerequisite beyond what `npx`
itself needs. A cold first run takes a couple of minutes; later runs take
seconds.

One prerequisite is not bundled: a `git` binary must be on `PATH`, because the
Self-Test profiles provision their fixtures by invoking `git`.

Prove portability on the machine you are on:

```bash
npx verchestra self-test --profile smoke
```

A `self_test.verdict: PASS` with an empty `self_test.failure_codes` means this
machine resolved and verified a signed release, activated it, and ran the
packaged Self-Test profile inside a disposable, isolated trust domain — with no
repository checkout involved.

**Known limitation.** `self-test` currently refuses when the working directory
is an ancestor of the operating system's temporary directory. On Windows the
default home directory is such an ancestor, so a shell opened at its default
location fails with `VES_CLI_COMMAND_FAILED`. Run it from a project directory
until the fix ships. Tracked as
[issue #370](https://github.com/accd/verchestra/issues/370).

## What it does

The launcher runs under your ambient Node **only as a bootstrap**. It:

1. checks that your platform and architecture are qualified by the release;
2. reads the pinned trust root and release source that ship inside this package;
3. resolves and stages that exact release through TUF;
4. activates it transactionally; and
5. hands control to the activated release's own launcher, which runs on the
   release's own embedded Node runtime.

Ambient Node never runs product code. Your arguments cross the process
boundary as an argument vector; no shell is involved.

## What travels in this package

Seven files: one bundled JavaScript module, the bin shim, the pinned public
configuration and trust root, this document, the license, and the package
manifest. The manifest declares **no dependencies at all**, so `npx verchestra`
downloads this package and nothing else.

The bundle is built from repository sources before publication, so the
resolution, verification, and activation code travels inside it rather than
being resolved at install or run time. It imports Node built-ins only, and its
CommonJS shim refuses any identifier that is not a Node built-in — a published
tarball cannot resolve a package from disk even if something tried. There is no
install script, no workspace dependency, no TypeScript source, no source map,
and no runtime download of an unpinned component.

## The pinned release source

`config/release-source.json` is schema version 2: one pinned release identity
(`sourceId`, `releaseId`, `semanticVersion`, `rootDigest`) plus a `targets`
map keyed by `<platform>-<arch>`. Each entry pins that host's fixed,
credential-free HTTPS `metadataBaseUrl` and `targetBaseUrl`, so the one
published tarball resolves every qualified platform. At run time the bootstrap
selects the entry for the host it actually runs on; a qualified host the map
does not name fails closed with `VES_VESTRA_HOST_UNSUPPORTED` (exit 64) rather
than borrowing another platform's locations. Version 1 of this file was never
published, so version 2 is the only accepted schema — the version bump is the
migration.

## Recovery and cleanup

The launcher's machine-local state root holds staged releases, the activated
install, the trust anchor, and the `active.json` pointer:

| Platform | Managed state root                               |
| -------- | ------------------------------------------------ |
| Windows  | `%LOCALAPPDATA%\Verchestra\state`                |
| macOS    | `~/Library/Application Support/Verchestra/state` |
| Linux    | `~/.local/state/verchestra`                      |

That location is derived from the home directory and the platform alone; no
environment variable selects it, so redirecting `LOCALAPPDATA` or
`XDG_STATE_HOME` neither moves it nor redirects a trust root or a release.

To recover from a failed run, run the command again — activation is
transactional and converges. If activation keeps failing, delete the managed
state root and run the command again; the next run resolves and activates from
scratch.

Three separate things can be removed independently:

- **npm's cache** — `npm cache clean --force`, or delete the `npx` cache entry.
  This removes only the downloaded launcher.
- **Managed install state** — the state root above. Removing it makes the next
  run resolve and activate again from scratch.
- **Your own workspace data** — never touched by removing either of the above.

## Building it from the repository

```bash
corepack pnpm build:vestra-launcher -- --release-inputs <dir> --out <dir>
```

`--release-inputs` must contain the reviewed, pinned `root.json` and
`release-source.json` for the release being published. The build refuses to
emit without them; a fixture trust root is never release authority.

Publishing is a human step. Nothing in this repository runs `npm publish`.

## License

Apache-2.0. See `LICENSE`.
