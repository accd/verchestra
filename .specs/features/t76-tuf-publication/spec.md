# T76 TUF Publication Specification

Issue: #17

## Requirements

- **TP-01** — A verified candidate and exact component bytes produce one
  signed TUF root, top-level targets role, terminating component delegation,
  snapshot, timestamp, manifest target, and every component target.
- **TP-02** — TUF metadata binds target length, SHA-256 bytes, release identity,
  component identity, and the candidate's exact release digest; the existing
  TUF client resolves the same bundle in online, mirror, offline, and air-gapped
  source modes.
- **TP-03** — Signers are injected callbacks with a declared threshold; missing
  or unattainable signers, invalid expiry, incomplete/duplicate bytes, and
  byte-digest mismatches fail closed before publication.
- **TP-04** — Mutated published target bytes fail TUF verification and cannot
  produce an activation-allowed staged release.
- **TP-05** — The publication script consumes an operator-supplied HTTPS base
  URL: validated fail-closed (`VES_T76_PUBLISH_BASE_URL_INVALID` for a
  non-HTTPS scheme, userinfo, query, fragment, missing trailing slash, `${`
  marker, or over-long value) before any output directory exists, and every
  per-target `metadataBaseUrl`/`targetBaseUrl` pair mirrors the emitted
  `publication/<targetKey>/{metadata,targets}/` tree byte for byte, so the
  entire upload contract is copying `publication/` to the prefix the base URL
  serves while preserving each asset's declared `remoteKey`.
- **TP-06** — One `release-inputs/` directory serves the whole fleet: the
  shared trust root plus a schemaVersion-2 pinned source whose `targets` map
  names all five supported target keys. The emitted bytes must round-trip
  through the launcher's real `loadPinnedInputs` and build the publishable
  package unchanged, and every published per-target repository must resolve
  and stage through the real TUF client from any host platform.
- **TP-07** — Rollback authority is a sealed prior `t76-target-index.json`
  supplied as `--rollback-index`, never a digest pair typed into a dispatch
  form. The prior index must be canonical and self-digested, seal a revision
  distinct from the one being published, and cover every fleet target
  (`VES_T76_PUBLISH_ROLLBACK_INCOMPLETE` otherwise); a candidate rejection —
  including a prior digest equal to the current release digest — surfaces as
  `VES_T76_PUBLISH_CANDIDATE_INVALID`.
- **TP-08** — The release signing key is read only from
  `VESTRA_RELEASE_SIGNING_KEY_PKCS8_BASE64`, in exactly one workflow step,
  only through `env:`; no key byte, base64 fragment, or OpenSSL cause chain
  ever reaches stdout, stderr, an emitted file, or an error message.
- **TP-09** — The publication workflow is manual, read-only, SHA-pinned, and
  env-mediated. It owns no storage endpoint identity and no upload tool: no
  repository-derived location, no storage CLI, no storage credential, and no
  publish of any kind. Uploading the tree and `npm publish` stay human steps.
- **TP-10** — The candidate's `bin/vestra.mjs` and `bin/verchestra.mjs` are
  deterministic self-contained bundles of the tracked closure entries
  `apps/vestra-cli/closure/{vestra,verchestra}-entry.ts`, never the
  development shims sealed verbatim. From the staged release layout alone -
  no repository sources, no `node_modules/` - each sealed launcher must run
  the real CLI and answer `--activation-health` per the protocol
  `packages/platform-node/src/activation-launcher-adapters.ts` requires: one
  JSON object on a clean stream, exactly `schemaVersion`, `report`,
  `componentId`, `semanticVersion`, `checks` (`migration`, `native`, `driver`,
  each an honest observation), and `behavior` (identical across both
  launchers), exit 0. The builder refuses to bundle from a working tree that
  differs from the sealed revision (`VES_T76_BUILD_TREE_DIRTY`), and the
  compiled-in semantic version comes from the build's own
  `--semantic-version` input, not a repository `package.json`.
- **TP-11** — Every file a delegated CLI command reaches at run time is
  resolved for the layout the command is actually running in. A sealed bundle
  is one file at `<releaseRoot>/bin/*.mjs`, so a repository-shaped specifier
  written against `apps/vestra-cli/src/` lands outside the release; the
  candidate builder must emit or seal each such file, and resolution must name
  both layouts and choose the one that exists. Three references are covered:
  the contract schema registry (`<releaseRoot>/components/schemas/`), the
  Self-Test durable-crash child (bundled as its own sealed `bin/` artifact with
  the identical option vector as the launchers), and the Self-Test fake driver
  executable (already sealed as a tracked source component). `doctor` and
  `self-test` must therefore report from a staged release exactly what they
  report from a repository checkout for the same invoking project.

## Acceptance criteria

1. WHEN the publication script runs against a sealed five-target closure, a
   valid prior rollback index, and a valid base URL THEN the repository SHALL
   emit one signed TUF repository per target, exactly one `release-inputs/`
   directory, and one upload manifest naming every asset's digest and remote
   key.
2. WHEN any base URL, closure, rollback, digest, or key input is invalid THEN
   the run SHALL stop with the matching `VES_T76_PUBLISH_*` code before a
   publication byte is written, and an invalid base URL or rollback index
   SHALL leave no output directory behind.
3. WHEN the emitted `release-inputs/` directory is fed to the launcher's
   `loadPinnedInputs` and to `build:vestra-launcher` THEN both SHALL accept it
   unchanged, for every supported target key at once.
4. WHEN a built candidate's launchers and hermetic runtime are staged into a
   release layout with no repository sources and no dependency store THEN the
   real `NodeActivationHealthGate` SHALL return activation health evidence
   for both canonical launchers, and the same sealed binaries SHALL execute
   ordinary CLI argument vectors, reporting the compiled-in sealed semantic
   version.
5. WHEN `doctor --deep` is executed from a staged release layout THEN the
   verdict, exit code, and the full ordered check catalog SHALL equal what the
   repository checkout reports for the same invoking project.
6. WHEN `self-test --profile smoke` and `self-test --profile full` are executed
   from a staged release layout THEN both SHALL report PASS with their declared
   check counts, the full profile driving its sealed durable-crash child and
   the sealed fake driver through the release's own runtime.

## Edge cases

A rollback index that seals the published revision, seals a target twice, is
re-serialized, omits a fleet target, or repeats the current release digest; a
base URL that only normalizes to a trailing slash; a closure target whose
artifact contradicts the reconciled index; an output directory that already
exists; a sealed bundle whose release root happens to sit below a directory
that also contains a `schemas/` sibling.

## Recorded limitation (TP-11)

`doctor` cannot report PASS from any layout, and this change deliberately does
not try to make it. `doctor.native-asset`
(`apps/vestra-cli/src/doctor-composition.ts`) keys off
`resolveReleaseIdentity().releaseDigest`, which `apps/vestra-cli/src/release-manifest.ts`
returns as `null` in BOTH the sealed and source branches by protocol: that
digest covers a manifest that itself contains the launcher's own content
digest, so any compiled-in value would be circular (the same reasoning
`packages/platform-node/src/activation-launcher-adapters.ts` records for the
activation-health protocol). BLOCKED with exit 4 is therefore the honest
ceiling for a bare machine, in a sealed release exactly as in a checkout, until
a release can name its own digest without circularity. The FAIL/exit 1 this
slice removes was never that limitation - it was an unresolvable schema
registry reported as an unhealthy machine.

## Safety and authority

Private key custody stays in the protected environment; the script never
publishes or uploads; the workflow grants no write scope and mints no OIDC
identity; every dispatch input is untrusted and pattern-validated behind
`env:` mediation.

## Success criteria

Every requirement has file-and-assertion evidence in
`tests/build/tuf-publication.test.mjs`,
`tests/security/tuf-publication-security.test.mjs`,
`tests/build/t76-release-publication.test.mjs`,
`tests/build/sealed-launcher-closure.test.mjs`,
`tests/build/reproducible-target-build.test.mjs`, and
`tests/agent-readiness/t76-publish-workflow.test.mjs`, with gates green and
independent human review before any publication is performed.

## Boundary

This slice does not provision keys, upload to a live endpoint, activate a
release, execute a live rollback, or close #17. Real trusted key custody at
the operator's storage boundary, a live endpoint verification run, and
independent T76 qualification remain required.
