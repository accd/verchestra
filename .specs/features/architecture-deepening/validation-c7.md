# Architecture deepening: validation for ADP-7 (publication ledger)

Two changes, one per pull request. T7a moves the custody helpers the two T76
signing scripts share into one module. T7b makes the ledger module admit and
derive the entry for a release.

No real key was read, provisioned or used. Every signature in the tests below is
made with a throwaway key generated in the test process. No workflow was
dispatched and nothing was uploaded or published.

## T7a: shared custody helpers

| Claim                                                                     | Evidence (file and assertion)                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One module holds the signer, the anchors, the exclusive writes, the error | `scripts/t76-signing-custody.mjs:20-185` exports twelve names; `tests/build/t76-signing-custody.test.mjs:43` asserts the interface is exactly those twelve                                                                                                                                                              |
| Both scripts import it; the refresh no longer loads the publisher         | `scripts/t76-publish-release.mjs:54-67`, `scripts/t76-refresh-timestamp.mjs:42-55`                                                                                                                                                                                                                                      |
| Names are unchanged and stay importable from the publisher's path         | `scripts/t76-publish-release.mjs:80-93` re-exports; `tests/build/t76-signing-custody.test.mjs:50` asserts each re-export is the shared binding itself and pins the two environment names and the two purposes; `tests/build/t76-release-publication.test.mjs` and `t76-timestamp-refresh.test.mjs` pass with no edit    |
| `VES_T76_PUBLISH_*` codes are unchanged                                   | The code moved verbatim. `tests/build/t76-release-publication.test.mjs` and `tests/build/t76-timestamp-refresh.test.mjs` assert `SIGNING_KEY_MISSING`, `SIGNING_KEY_INVALID`, `KEY_MISMATCH`, `ANCHOR_MISSING`, `ANCHOR_INVALID`, `ANCHOR_RETIRED` and `OUTPUT_EXISTS` unedited; `t76-signing-custody.test.mjs:102` too |
| The default anchors still resolve to the committed trust directory        | `tests/build/t76-signing-custody.test.mjs:58`; `tests/build/t76-release-publication.test.mjs:273` still resolves both committed anchors to the recorded key ids                                                                                                                                                         |
| Signer and anchor agree on a key id, per role                             | `tests/build/t76-signing-custody.test.mjs:70`                                                                                                                                                                                                                                                                           |
| The census inventories the new file                                       | `docs/canonical-json-census.json:1243-1253` (`raw-byte-digest`, three digest signals); `scripts/t76-publish-release.mjs` drops from four digest signals to two; `pnpm test:census` passes                                                                                                                               |
| Gate selection routes the new file like the publisher                     | `tests/agent-readiness/gate-selection.test.mjs:381-385`                                                                                                                                                                                                                                                                 |

No test was deleted or weakened. `complexity-baseline.json` is unchanged: no
function of the three scripts is a recorded hotspot, and `pnpm complexity:check`
passes.

Line citations of the moved code were updated in
`.specs/features/release-custody/validation.md`,
`.specs/features/tuf-timestamp-refresh/validation.md`,
`.specs/features/tuf-metadata-version-safety/validation.md` and
`.specs/features/census-gate-enforcement/validation.md`.

### Gates for T7a

| Command                                                                                                                                        | Result | Tests |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----- |
| `node --test tests/build/t76-signing-custody.test.mjs tests/build/t76-release-publication.test.mjs tests/build/t76-timestamp-refresh.test.mjs` | PASS   | 54    |
| `pnpm gate:quick` (format, lint, complexity, typecheck, unit 2330, agent-readiness 315, census 13)                                             | PASS   | 2658  |
| `pnpm test:architecture`                                                                                                                       | PASS   | 61    |

## T7b: the ledger module admits and derives the release entry

### Stop criterion: byte-for-byte reproduction of entries 3 and 4

**Result: reproduced. The committed ledger is unchanged.**

`tests/agent-readiness/tuf-publication-ledger.test.mjs:372` derives each entry
with `admitRelease` from the recorded inputs, over the ledger prefix that
preceded it, and asserts for entry 3 (`0.0.0-qualification.3`, run
`36785647398`) and entry 4 (`0.0.0-qualification.4`, run `36930995598`):

- the pretty-printed form a human appends equals the committed entry's
  (`JSON.stringify(entry, null, 2)`: same keys, same order, same values);
- the canonical digest equals the committed entry's, and `previousEntryDigest`
  equals both the committed value and the digest of the entry before it;
- the committed file contains the derived entry's bytes exactly once, at the
  indentation of an `entries` member;
- entry 4 also reproduces over a prefix whose entry 3 is the derived one, so
  the two derived entries equal `entries[0..3]` of the committed ledger.

The inputs are checked against the tracked record at `:351`: the release id,
the root digest, the base URL with its prefix, the metadata version and the
signing run are each read from
`.specs/features/live-activation-matrix/validation.md`. The root version of
`.4` is the one `.3` records, because the record states the root is unchanged.

The test discriminates. `:405` changes each input in turn (release id, semantic
version, base URL, root digest, root version, metadata version, run id, absent
run id, evidence order) and a shorter prefix; every one derives a different
entry. Two mutations of the implementation were also run by hand and reverted:
swapping `rootDigest` and `rootDigestPrefix` in the derived entry, and recording
the whole base URL with an empty prefix. Both failed `:372`.

### Requirement evidence

| Claim                                                                        | Evidence (file and assertion)                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The ledger module admits a release as `assertMonotonicMetadataVersion` did   | `scripts/tuf-publication-ledger.mjs:295` `admitRelease` calls it first; `tests/agent-readiness/tuf-publication-ledger.test.mjs:428` (a recorded release is refused again, the next version is admitted and chains); `tests/build/t76-release-publication.test.mjs:781`, `:789`, `:797`, `:808`, `:827`, `:837`, `:847` pass unedited through the publisher, each refusal asserting no output directory |
| It returns the derived, chained entry through `nextLedgerEntry`              | `scripts/tuf-publication-ledger.mjs:298-315`; `tuf-publication-ledger.test.mjs:473` (the chain, the kind, the prefix and the roles are derived whatever the caller passes; the evidence list is copied)                                                                                                                                                                                                |
| Origin and `urlPrefix` are split as the committed entries record them        | `scripts/tuf-publication-ledger.mjs:269` `servedLocation`; `tuf-publication-ledger.test.mjs:372` (`v3/`, `v4/`), `:446` (bucket root gives an empty prefix, a nested prefix, a non-default port)                                                                                                                                                                                                       |
| An empty ledger admits a first release                                       | `tuf-publication-ledger.test.mjs:446`; `tests/build/t76-release-publication.test.mjs:1053` through the publisher; the existing `sharedLineage` fixture (`:746`) still publishes over an empty ledger                                                                                                                                                                                                   |
| A release the ledger cannot record is refused                                | `tuf-publication-ledger.test.mjs:494` (credential, query, fragment, rewritten host or path, non-https, no trailing slash, encoded prefix, null release id or root version, bad run id, bad evidence); `t76-release-publication.test.mjs:1080` (refused before any output)                                                                                                                              |
| The publisher takes `--run-id` and cites fixed evidence                      | `scripts/t76-publish-release.mjs:98` `RELEASE_EVIDENCE`, `:261` and `:843` run id; `t76-release-publication.test.mjs:1066` (malformed run id refused before output), `:906` (the command line records `--run-id 77`, and no key material reaches the entry), `:1091` (every evidence path is tracked and equals what entries 3 and 4 cite)                                                             |
| `ledger-entry.json` is written beside the manifest, with no earlier output   | `scripts/t76-publish-release.mjs:754` admission before `assertOutputAbsent` (`:755`) and `mkdir` (`:761`); `:775-779` exclusive write after every target is signed under the recorded root; `t76-release-publication.test.mjs:995` (exact directory listing, entry content, pretty form, key order, appended entry validates, same version then refused, next entry chains)                            |
| Step 7 says to append the file verbatim                                      | `scripts/t76-publish-release.mjs:111`; `t76-release-publication.test.mjs:995` asserts the step text; `:324` still asserts the manifest carries the steps                                                                                                                                                                                                                                               |
| The refresh accepts a ledger built from the publisher's own entry            | `tests/build/t76-timestamp-refresh.test.mjs:543`                                                                                                                                                                                                                                                                                                                                                       |
| The workflow passes the run id through the environment and uploads the entry | `.github/workflows/t76-publish-release.yml:254` (`--run-id "$GITHUB_RUN_ID"`), `:271` (the summary step reads the entry), `:311` (uploaded in the metadata artifact); `tests/agent-readiness/t76-publish-workflow.test.mjs:246` and `:269`                                                                                                                                                             |
| The job's `environment:` binding and its secrets are untouched               | `.github/workflows/t76-publish-release.yml:110`, `:240-241` unchanged; `tests/agent-readiness/signing-environments.test.mjs` and `t76-publish-workflow.test.mjs:66`, `:79`, `:146` pass unedited                                                                                                                                                                                                       |
| The custody rehearsal still returns its documented codes                     | `docs/release-custody.md` 8.1, cases D1 to D6, run by hand with throwaway keys in a scratch directory inside the worktree: `SIGNING_KEY_MISSING`, `KEY_MISMATCH`, `KEY_MISMATCH`, `ANCHOR_INVALID`, `INPUT_MISSING`, `ANCHOR_RETIRED`, and no publication directory. D5 gives the same code with `--run-id 77` added                                                                                   |

### Workflow shape tests changed deliberately

`tests/agent-readiness/t76-publish-workflow.test.mjs` changed in two places.
Enforcement is strengthened; no assertion was removed or loosened.

- `:246` keeps every earlier assertion (three fail-closed uploads, no warn or
  ignore) and adds the exact path list of the metadata artifact, which now
  includes `ledger-entry.json`.
- `:269` is new. It requires `--run-id "$GITHUB_RUN_ID"` exactly once, no
  `github.run_id` in any run block, the summary step reading the entry after
  signing and before the first upload, and no run block that writes the
  committed ledger or runs `git push`, `git commit` or `git add`.

The action pin count (nine), the `if-no-files-found: error` count (three) and
the rule that no `${{ }}` appears inside a run block are unchanged and still
asserted at `:188`, `:246` and `:130`.

### Behaviour changes a reviewer should know

1. The publisher reads and validates the target index before the ledger
   admission, because the entry names the release. When both the index and the
   version are wrong, the index error is now reported first. Nothing is signed
   or written earlier than before.
2. A base URL whose prefix the ledger's entry rules refuse (for example a
   percent-encoded path) now fails with `VES_T76_PUBLISH_LEDGER_INVALID`. The
   workflow's `base_url` pattern already admits only recordable URLs.
3. `publication-manifest.json` carries the new step 7 text.

### Tests deleted

None. No case was replaced, so there is no "deleted case → replacement" entry.

### Guardrails

- `complexity-baseline.json`: unchanged. No hotspot key moved. `admitRelease`,
  `servedLocation` and `admitToLedger` are below the target of 10.
- Census: `scripts/t76-publish-release.mjs` gains one serialization signal (the
  pretty-printed entry), now `canonicalizer 13, digest 2, serialization 1`.
  `scripts/tuf-publication-ledger.mjs` is unchanged. `pnpm test:census` passes.
- Migration count and runtime error catalog count: not touched.
- Credential-store qualification digests: not touched.
- Line citations of the reshaped files were updated in
  `.specs/features/tuf-metadata-version-safety/validation.md`,
  `.specs/features/tuf-timestamp-refresh/validation.md` and
  `.specs/features/release-custody/validation.md`.

### Gates for T7b

| Command                                                                                                                                        | Result | Tests |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----- |
| `node --test tests/agent-readiness/tuf-publication-ledger.test.mjs`                                                                            | PASS   | 19    |
| `node --test tests/build/t76-signing-custody.test.mjs tests/build/t76-release-publication.test.mjs tests/build/t76-timestamp-refresh.test.mjs` | PASS   | 60    |
| `pnpm gate:quick` (format, lint, complexity, typecheck, unit 2330, agent-readiness 323, census 13)                                             | PASS   | 2666  |
| `pnpm test:architecture`                                                                                                                       | PASS   | 61    |
| `pnpm gate:release` (static checks, build, unit 2330, architecture 61, build 146, qualification 272, security 1333, fault 310, release 28)     | PASS   | 4480  |
| `pnpm gate:security` (static checks, build, unit 2330, contract 666, e2e 229, architecture 61, qualification 272, security 1333, fault 310)    | PASS   | 5201  |
| `pnpm gate:full` (static checks, unit 2330, contract 666, integration 770, e2e 229, fault 310, mutation 8)                                     | PASS   | 4313  |
| `pnpm test:build`                                                                                                                              | PASS   | 146   |
| `pnpm test:agent-readiness`                                                                                                                    | PASS   | 323   |
| `pnpm agent:check`                                                                                                                             | PASS   | n/a   |

`gate:full` is not in the task's list. It was run because gate selection sends a
change under `.github/workflows/` to `gate:full` and `gate:release`. No test was
skipped in any run.
