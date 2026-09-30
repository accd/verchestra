# Single-Binary Distribution Validation (#236)

## Current verdict

**PASS on the darwin-arm64 build host for T1–T5, T7, and T8. The five native
legs passed in tests-only mode on the T8 branch (run 36677942597); the
merge-revision and reviewed-input dispatches of T6 are still pending.** Every
requirement below has assertion evidence on the build host. Signing still needs
the owner's identities. This verdict is not a release, promotion, or 1.0 claim.

## Requirement evidence

| Req | Evidence (file:line — assertion) | Result |
| --- | --- | --- |
| SBD-01 | `tests/unit/node-runtime-archive.test.mjs:107`: the tracked pins name exactly five targets at `engines.node`. `:196`: a byte-changed archive is refused. `:204`: a member that does not match its own pin is refused inside a pinned archive. `:232`: an installed runtime and its LICENSE must both match their pins. `tests/build/vestra-binary.test.mjs:272`: a fake archive or executable is refused, and no output is left behind. | PASS |
| SBD-02 | `tests/unit/sea-inject.test.mjs:32`: per format, the blob is recovered byte for byte and the fuse is flipped exactly once. `:61`: an un-injected executable is never reported as carrying a blob. `tests/build/vestra-binary.test.mjs:182`: `manifest.sea.blob` equals `locateSeaBlob` of the emitted executable. `scripts/build-vestra-binary.mjs:275` (`emitExecutable`) refuses an unverifiable artifact. `tests/unit/sea-inject.test.mjs:186`: the injected PE passes every Windows loader rule in the independent reader `tests/helpers/pe-loader-checks.mjs`. `:190`: a PE whose resource bytes lie outside the resource section is reported and never located. `tests/build/vestra-binary.test.mjs:182` runs the same reader over the real `vestra.exe` on the Windows leg. | PASS |
| SBD-03 | `tests/build/vestra-binary.test.mjs:164`: two builds produce identical file trees and digests. `tests/unit/sea-inject.test.mjs:46`: injection is deterministic in each format. | PASS |
| SBD-04 | `tests/build/vestra-binary.test.mjs:182`: target, executable digest, signature state, runtime archive and member digests, pins route, root digest, SEA settings, asset digests, license digests, SBOM runtime hash, and SBOM npm components listed in the notices are all present, and there is no machine-local path. | PASS |
| SBD-05 | `apps/vestra-launcher/closure/single-binary-bootstrap.ts:82` composes `runBootstrap` with `NodeActivationClosure(machineLocalEnvironment)`. `apps/vestra-launcher/src/pinned-inputs.ts:189` holds the shared validation. `tests/unit/vestra-single-binary-bootstrap.test.mjs:93`: the same public codes are returned for tampered or missing inputs and for an unsupported host. `tests/build/vestra-binary.test.mjs:253`: the real closure anchors the embedded root. `tests/build/vestra-binary.test.mjs:302`: the build refuses inputs the launcher refuses. The unchanged npm suites (`tests/build/vestra-launcher-package.test.mjs`, `tests/e2e/vestra-launcher-activation.test.mjs`, `tests/security/vestra-launcher-package-security.test.mjs`) still pass. | PASS |
| SBD-06 | `tests/unit/vestra-single-binary-bootstrap.test.mjs:83`: a lone `--version` never activates. `:111`: `[]`, `--version --output json`, and shell-hostile argument vectors reach the handoff verbatim. | PASS |
| SBD-07 | `tests/build/vestra-binary.test.mjs:238`: `PATH=""` plus a hostile `NODE_OPTIONS --require` still gives `--version` with an empty stderr. `:253`: with `PATH=""` and `HOME` redirected, the run dials the pinned loopback source and exits 70 with a `VES_TUF_*` diagnostic. `scripts/build-vestra-binary.mjs:134`: the bundle loads only built-ins and carries the require guard. | PASS |
| SBD-08 | `tests/build/vestra-binary.test.mjs:325`: unsupported target, both or neither runtime given, missing inputs, and existing output are each refused. `tests/unit/sea-inject.test.mjs:50`, `:55`, `:88`, `:97`, `:132`, `:220`, `:224`: already injected, fuse count, unknown Mach-O command, misplaced signature, no ELF slack, PE overlay, and unknown or fat format are each refused. | PASS |
| SBD-09 | `tests/build/vestra-binary.test.mjs:182` asserts `executable.signature` is `ad-hoc` on darwin and `none` elsewhere. `tests/unit/sea-inject.test.mjs:66` (Mach-O signature dropped before re-signing) and `:138` (PE certificate directory cleared). The owner actions are listed in `design.md` § Code signing. | PASS (owner actions pending) |
| SBD-10 | `tests/agent-readiness/single-binary-workflow.test.mjs:38`: manual, read-only, no identity or secret, and `actions: read` granted once, to the `target` job only. `:55`: exactly the five fleet legs. `:69`: actions SHA-pinned. `:75`: no input interpolated into a shell. `:88`: nothing can publish or sign. `:108`: the pinned archive is verified first. `:118`: zero skips are enforced. `:126`: the reviewed build is compared byte for byte. | PASS (dispatch pending) |
| SBD-11 | `docs/qualification/single-binary-distribution.md`: the "Proven locally" and "Pending" tables. | PASS |
| SBD-13 | `tests/unit/node-runtime-archive.test.mjs:123`: a pin whose archive or member name is absolute, nested, dotted, backslashed, or `..`-escaping is refused. `:258`: pax records are walked by length, so a forged record inside a value is ignored and a malformed header is refused. `:284`: a symlink, hard link, or duplicate under a pinned tar name, and a truncated entry, are refused. `:316`: a tar that expands past its bound and a tar or zip member over the member bound are refused. `:343`: a zip symlink, a deflate stream that overflows its recorded size, a local header that disagrees with its directory entry, and an out-of-range directory are refused. `:376`: a NUL-terminated name ends at its first NUL at any padding length. Extraction is in memory only (`scripts/node-runtime-archive.mjs:291`), so no entry name ever becomes a filesystem path. | PASS |
| SBD-12 | `docs/qualification/single-binary-distribution.md` "Release state" and "Verdict". AD-038 says the channel changes no T76, T77, or 1.0.0 status. `pnpm agent:check` status agreement. | PASS |

## Discrimination sensor

Each mutant was applied to the source in place, the named suite was run, and
the file was restored from a copy. Every mutant was killed.

| Mutant | Suite | Result |
| --- | --- | --- |
| M1 Mach-O `__LINKEDIT` offsets not shifted | `tests/unit/sea-inject.test.mjs` | killed (1 failure) |
| M2 fuse left unflipped | `tests/unit/sea-inject.test.mjs` | killed (3) |
| M3 ELF `PT_PHDR` not relocated | `tests/unit/sea-inject.test.mjs` | killed (1) |
| M4 PE certificate directory kept | `tests/unit/sea-inject.test.mjs` | killed (1) |
| M5 archive digest not checked | `tests/unit/node-runtime-archive.test.mjs` | killed (1) |
| M6 installed LICENSE not checked | `tests/unit/node-runtime-archive.test.mjs` | killed (1) |
| M7 `--version` answered beside other arguments | `tests/unit/vestra-single-binary-bootstrap.test.mjs` | killed (1) |
| M8 macOS binary left unsigned | `tests/build/vestra-binary.test.mjs` | killed (2) |
| M9 launcher input validation skipped at build | `tests/build/vestra-binary.test.mjs` | killed (1) |
| M10 embedded config read from the wrong asset key | `tests/unit/vestra-single-binary-bootstrap.test.mjs` | killed (4) |
| M11 `execArgvExtension: "env"` (NODE_OPTIONS honored) | `tests/build/vestra-binary.test.mjs` | killed (1) |

Result: 11 killed, 0 survived.

## Gates

Build host: darwin-arm64, Node 24.14.0, pnpm 10.34.5. The worktree was based on
`origin/main` `aa6cf42b0c6e26cdbe3a23ce474ca4ea39a47a94`.

Every gate below was run on the tree at `8dd0111` (T1–T5 committed) with a
clean worktree.

| Command | Result |
| --- | --- |
| `node --test tests/unit/sea-inject.test.mjs tests/unit/node-runtime-archive.test.mjs tests/unit/vestra-single-binary-bootstrap.test.mjs tests/build/vestra-binary.test.mjs tests/agent-readiness/single-binary-workflow.test.mjs` | PASS: 52 tests, 0 failed, 0 skipped, 0 todo |
| `pnpm gate:quick` | PASS: unit 2202, agent-readiness 265 |
| `pnpm gate:build` | PASS: unit 2202, contract 541, integration 663, e2e 192, architecture 50, build 110, qualification 254 |
| `pnpm gate:security` | PASS: unit 2202, contract 541, e2e 192, architecture 50, qualification 254, security 1179, fault 300 |
| `pnpm gate:release` | PASS: unit 2202, architecture 50, build 110, qualification 254, security 1179, fault 300, release 28 |
| `pnpm gate:full` | PASS: unit 2202, contract 541, integration 663, e2e 192, fault 300, mutation 8 |
| `pnpm agent:check` | PASS |

Every stage reported 0 failed, 0 skipped, and 0 todo. `gate:full` also ran,
because gate selection treats a new workflow and a `scripts/gate-selection.mjs`
change as conservative-control-surface paths.

A first `gate:security` and `gate:release` run failed on one assertion: the
canonical JSON census did not classify the two new scripts. It was fixed by
classifying them (`docs/canonical-json-census.json`: `build-vestra-binary.mjs`
as migrated-v2 and `node-runtime-archive.mjs` as raw-byte-digest), not by
changing the census test.

## T7 gates (SonarCloud remediation and archive hardening)

Run on the same darwin-arm64 build host, on the T7 tree before commit. The
focused run includes `tests/build/vestra-binary.test.mjs`, which built the
binary twice from the real pinned `darwin-arm64` archive and found the two
trees byte-identical.

| Command | Result |
| --- | --- |
| `node --test tests/unit/sea-inject.test.mjs tests/unit/node-runtime-archive.test.mjs tests/unit/vestra-single-binary-bootstrap.test.mjs tests/build/vestra-binary.test.mjs tests/agent-readiness/single-binary-workflow.test.mjs` | PASS: 57 tests, 0 failed, 0 skipped |
| `pnpm gate:quick` | PASS: unit 2207, agent-readiness 265 |
| `pnpm gate:build` | PASS: unit 2207, contract 541, integration 663, e2e 192, architecture 50, build 110, qualification 254 |
| `pnpm gate:security` | PASS: unit 2207, contract 541, e2e 192, architecture 50, qualification 254, security 1179, fault 300 |
| `pnpm gate:release` | PASS: unit 2207, architecture 50, build 110, qualification 254, security 1179, fault 300, release 28 |
| `pnpm agent:check` | PASS |

The five new archive tests each fail against the pre-T7 reader, and pass
against the hardened one.

## T8 gates (loadable Windows executable)

Run 36675382810 of `single-binary-build.yml` on `main` failed only its Windows
x64 leg: both PATH-emptied cases got `spawn EFTYPE` (ERROR_BAD_EXE_FORMAT), so
Windows refused to create the process. The runtime was never reached.

**Root cause.** The PE injector rebuilt the resource directory in a new `.sea`
section, but it left the bytes of every existing resource (icons, version, and
`RT_MANIFEST`) in the original `.rsrc`. Windows refuses to start an image whose
resource data lies outside the section that holds the resource directory. The
headers were not at fault. Section contiguity, `SizeOfImage`, `SizeOfHeaders`,
alignment, the cleared certificate table, and the checksum were all
consistent.

**Bisection on the windows-latest runner.** Runs 36677275358 and 36677527874
spawned variants of the pinned `node.exe`. These all started:

- the pristine executable;
- the executable with its certificate table stripped, with and without a
  recomputed checksum;
- an appended section of either size;
- the resource tree and its data moved together into a new section, with the
  directory size covering all of it or only the tree.

These were all refused with `EFTYPE`:

- the injector's output, with the fuse flipped or not;
- the same output with the directory size widened to the whole section;
- the original tree copied verbatim into a new section with its data left in
  `.rsrc`.

**Fix.** The new section now carries the whole tree, then a copy of every
resource's bytes, then the blob, and the resource directory spans all of it.
This is how `rc` and LIEF lay out resources (postject rebuilds `.rsrc` through
LIEF). `locateSeaBlob` refuses a PE whose resources escape that span, so the
build cannot emit such an executable. Mach-O and ELF output is byte-identical
to before. Injecting one blob into the real darwin-arm64 runtime and into the
synthetic Mach-O and ELF fixtures gives the same digest with the old and the
new injector.

| Command | Result |
| --- | --- |
| `node --test tests/unit/sea-inject.test.mjs` against the pre-T8 injector | FAIL: 3 of 26. The two new PE cases fail, and so does the resource-tree case on its new span and copied-bytes assertions. |
| `node --test tests/unit/sea-inject.test.mjs tests/unit/node-runtime-archive.test.mjs tests/unit/vestra-single-binary-bootstrap.test.mjs tests/build/vestra-binary.test.mjs tests/agent-readiness/single-binary-workflow.test.mjs` | PASS: 59 tests, 0 failed, 0 skipped |
| `pnpm gate:quick` | PASS: unit 2273, agent-readiness 298, census 13 |
| `pnpm gate:build` | PASS: unit 2273, contract 616, integration 713, e2e 215, architecture 61, build 130, qualification 254 |
| `pnpm gate:release` | PASS: unit 2273, architecture 61, build 130, qualification 254, security 1265, fault 310, release 28 |
| `pnpm agent:check` | PASS |
| `single-binary-build.yml` run 36677942597 at `9fa81186a15a867677ab03f2e0c1438c6f24ad2f`, tests only | PASS on all five legs: Windows x64, macOS x64, macOS arm64, Linux glibc x64, and Linux glibc arm64. Each ran 50 tests with 0 failed and 0 skipped. |

## Pending evidence (T6)

- The five native legs of `.github/workflows/single-binary-build.yml`, run at
  the merge revision.
- A reviewed-input build reconciled across all five targets.
- Owner signing: Developer ID with notarization, and Authenticode.
