# vestra

`verchestra` is the public launcher for
[Verchestra](https://github.com/accd/verchestra), a verified AI
software-delivery harness.

> **Status: not published.** Verchestra is `0.0.0-qualification`. This package
> is built and verified in the repository, but no release has been published to
> npm. A build made from anything other than a reviewed, pinned trust root
> cannot anchor a resolution, reports `VES_VESTRA_ACTIVATION_UNAVAILABLE`, and
> exits non-zero without creating or fetching anything.

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

## Cleanup

Three separate things can be removed independently:

- **npm's cache** — `npm cache clean --force`, or delete the `npx` cache entry.
  This removes only the downloaded launcher.
- **Managed install state** — the launcher's OS-local state root holds staged
  and activated releases plus the `active.json` pointer. Removing it makes the
  next run resolve and activate again from scratch.
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
