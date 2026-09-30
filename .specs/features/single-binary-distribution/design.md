# Single-Binary Distribution Design and ADR (#236)

**Status:** Proposed. Recorded in `.specs/STATE.md` as AD-038 (to be numbered
at merge). The owner ratifies it by reviewing the pull request that carries it.
**Spec:** `.specs/features/single-binary-distribution/spec.md`

## Context

AD-016 made `npx verchestra` the 1.0 entry point and deferred a per-target
single binary to after 1.0. On 2026-09-29 the owner decided to implement the
binary now. That decision does not change the signed 1.0.0 hold
(`docs/qualification/release-decision-1.0.0.md`). It does not promote a
candidate and makes no release-readiness claim. It adds a second distribution
channel. Each channel is its own qualification surface, and
`docs/qualification/single-binary-distribution.md` records what this change
proves and what is still pending.

The channel exists for machines where npm, or any ambient Node, is not
available: locked-down hosts and air-gapped environments. The binary has to
run the same bootstrap `bin/vestra.mjs` runs: host gate, pinned inputs,
hermetic TUF activation, and handoff. It has to do that on the pinned official
Node 24.14.0 runtime, embedded in the binary, with nothing resolved from `PATH`.

## Facts measured against the pinned runtime

All of these were checked against the official
`node-v24.14.0-darwin-arm64` binary. Its archive digest is
`a1a54f46…15dd3`, which matches `SHASUMS256.txt`.

| Question | Finding |
| --- | --- |
| Does 24.14.0 have `--build-sea`? | No. `node --help` lists only `--experimental-sea-config`. `--build-sea` first ships in a later major. |
| Can 24.14.0 generate the blob? | Yes. `node --experimental-sea-config` writes a preparation blob. With `useCodeCache: false` and `useSnapshot: false`, two runs produce the same bytes. |
| What settings does the blob honor? | `main`, `output`, `assets`, `disableExperimentalSEAWarning`, `useSnapshot`, `useCodeCache`, `execArgv`, and `execArgvExtension` (`none`/`env`/`cli`). The strings in the binary confirm each one. |
| What does the runtime look for? | `src/node_sea_bin.cc` and `deps/postject/postject-api.h` at v24.14.0 look up a resource named `NODE_SEA_BLOB`. On Mach-O it is section `__NODE_SEA_BLOB` in segment `NODE_SEA`, found with `getsectdata`. On ELF it is a note in a `PT_NOTE` segment of the loaded main program, found with `dl_iterate_phdr`. On PE it is `RT_RCDATA`, found with `FindResourceA`. The sentinel `NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:0` must be flipped to `:1`. |
| Is `postject` available? | No. It is not in `pnpm-lock.yaml` or in the npm bundled with the runtime. It is an npm package that wraps LIEF compiled to WebAssembly. |
| Main-script format | CommonJS only: 24.14.0 has no `mainFormat`. The injected `require` loads only built-ins. |
| `argv` inside a SEA | `[execPath, argv0, ...userArgs]`. User arguments are `process.argv.slice(2)`, the same as the npm shim. |
| `NODE_OPTIONS` | Ignored when the blob sets `execArgvExtension: "none"`. The injected `--require` of a missing file had no effect. |

## Options considered

1. **Add `postject` as a dev dependency.** This is the documented path. It is
   rejected here because the task forbids a new dependency. It would also bring
   an unaudited LIEF WebAssembly build into the release build path.
2. **Build with a newer Node's `--build-sea`.** This would put a second,
   unqualified toolchain into the release path. The blob format also belongs to
   the Node release that reads it. Rejected.
3. **Use a self-extracting wrapper around the official binary.** This is not a
   single executable Node can start from, and it would write an unverified
   runtime to disk at run time. Rejected.
4. **Generate the blob with Node's built-in tooling and inject it with an
   in-repository injector.** Chosen.

## Decision

- **Blob.** `scripts/build-vestra-binary.mjs` runs the pinned runtime's own
  `--experimental-sea-config` in a staging directory. It uses a fixed config
  (`SEA_SETTINGS`): `useCodeCache: false`, `useSnapshot: false`,
  `disableExperimentalSEAWarning: true`, and `execArgvExtension: "none"`. The
  main script and the assets are named relatively, so no build-machine path
  enters the blob. The build refuses to run on any Node other than the pinned
  version, because the blob format belongs to the runtime that reads it.
- **Launcher bundle.** esbuild bundles
  `apps/vestra-launcher/closure/single-binary-main.ts` into one CommonJS
  script. The option vector mirrors the npm bundle's, apart from the output
  format. A banner (`SEA_REQUIRE_GUARD`) restates that only built-ins can be
  required. The entry composes the npm channel's `runBootstrap`,
  `NodeActivationClosure`, and `machineLocalEnvironment` unchanged.
- **Pinned inputs.** `config/release-source.json` and `config/root.json` are
  embedded as SEA assets and read with `node:sea` `getAsset`.
  `src/pinned-inputs.ts` now separates reading from validation
  (`readPinnedInputs(reader)`), so both channels apply the same checks to the
  same bytes. The build also runs that validation over the embedded bytes and
  refuses any inputs the binary itself would refuse.
- **Injection.** `scripts/sea-inject.mjs` implements the three lookups listed
  above and nothing else:
  - **Mach-O:** removes the official code signature, inserts a read-only
    `NODE_SEA` segment immediately before `__LINKEDIT`, and moves every
    `__LINKEDIT` file offset by the 16 KiB-aligned span. Any load command it
    does not know fails closed. Dyld tolerates the unchanged chained-fixups
    `seg_count` for a segment inserted before `__LINKEDIT`, as it does for
    `ctf_insert`.
  - **ELF:** moves the program header table into the zero slack at the end of
    the first load segment and grows that segment to cover it. It then appends
    a 64 KiB-aligned read-only `PT_LOAD` holding the note, plus a `PT_NOTE`
    describing it. Older kernels find the table through `e_phoff` relative to
    the first load address, and newer ones through `PT_PHDR`. Both work.
  - **PE:** removes the Authenticode certificate table, which must end the
    file. It rebuilds the resource directory in a new `.sea` section, keeping
    every existing data entry's address, and adds `RT_RCDATA/NODE_SEA_BLOB`
    (language neutral). It then updates `SizeOfImage` and the resource
    directory and recomputes the image checksum.
  - **All formats:** the injector flips exactly one fuse and refuses a runtime
    that has already been injected. It returns new bytes and leaves its input
    unchanged. `locateSeaBlob` recovers the blob the way the runtime's own
    lookup does. The build runs it on every artifact, after signing, and
    refuses to emit an executable whose blob it cannot recover byte for byte.
- **Runtime provenance.** `apps/vestra-launcher/single-binary/node-runtime.json`
  pins, for each of the five targets:
  - the archive's SHA-256, copied from `SHASUMS256.txt`;
  - the SHA-256 of the executable member;
  - the SHA-256 of the `LICENSE` member.

  The builder never downloads. It takes either the archive from a cache
  directory, verified by the archive digest and then each member's digest, or
  an installed official runtime, verified by the member digests recorded from
  that same archive. Both routes embed identical bytes. The locally built
  binaries were byte-identical across the two routes.
- **`--version`.** When `--version` is the whole argument vector, the binary
  answers it locally, after the same host and pinned-input validation every run
  performs. The output is
  `vestra <semanticVersion> (single binary; <platform>-<arch>; node v24.14.0)`,
  so an air-gapped operator can identify a binary before it has reached a
  release source. Every other argument vector, including `--version` next to
  other arguments, goes to the activated release exactly as given. This is the
  only behavior difference between the two channels. It is recorded as an open
  decision in the spec.

## Code signing

- **macOS.** Injection invalidates the Node Foundation's Developer ID
  signature, and arm64 macOS refuses to run an unsigned Mach-O. The build
  applies an **ad-hoc** signature: `codesign --sign - --identifier vestra`.
  That signature uses no identity, no keychain, and no timestamp, so it is
  reproducible. The two local builds were byte-identical.

  An ad-hoc signature is enough to run the binary locally. It will not pass
  Gatekeeper for a downloaded file. Distributing the binary needs these owner
  actions:
  1. A Developer ID Application signature with the hardened runtime.
  2. The entitlements the official binary carries:
     - `com.apple.security.cs.allow-jit`
     - `com.apple.security.cs.allow-unsigned-executable-memory`
     - `com.apple.security.cs.disable-executable-page-protection`
     - `com.apple.security.cs.allow-dyld-environment-variables`
     - `com.apple.security.cs.disable-library-validation`

     V8 needs JIT under the hardened runtime. The official binary also carries
     `get-task-allow`, which a distributed build should drop.
  3. Notarization with `notarytool`, then stapling.

  Each step changes the bytes. The manifest records the ad-hoc build, and any
  re-signed artifact needs its own digest record.
- **Windows.** Injection invalidates the Authenticode signature, so the builder
  removes the certificate table. The emitted `vestra.exe` is unsigned.
  Authenticode signing with the owner's certificate, and a timestamp, is an
  owner action. It appends a new certificate table and changes the file digest.
- **Linux.** ELF has no embedded signature. Provenance comes from the manifest
  and from any detached signature or attestation the owner adds.

## Consequences

- There is no new dependency, and the lockfile does not change.
- The injector is new, security-relevant code written directly against binary
  formats. It is covered on synthetic executables for every branch
  (`tests/unit/sea-inject.test.mjs`) and on the real host binary
  (`tests/build/vestra-binary.test.mjs`). Four targets only run for real in
  `.github/workflows/single-binary-build.yml`.
- The npm channel keeps its behavior. The default package root moved from
  `src/bootstrap.ts` to `closure/bootstrap-entry.ts`, because a CommonJS bundle
  has no `import.meta`. The npm bundle still derives the same root from its own
  location.
- The single-binary channel is qualified separately. Its evidence does not
  count toward, or change, T76 or the 1.0.0 decision.
