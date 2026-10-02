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
| One module holds the signer, the anchors, the exclusive writes, the error | `scripts/t76-signing-custody.mjs:20-190` exports twelve names; `tests/build/t76-signing-custody.test.mjs:43` asserts the interface is exactly those twelve                                                                                                                                                              |
| Both scripts import it; the refresh no longer loads the publisher         | `scripts/t76-publish-release.mjs:53-66`, `scripts/t76-refresh-timestamp.mjs:42-55`                                                                                                                                                                                                                                      |
| Names are unchanged and stay importable from the publisher's path         | `scripts/t76-publish-release.mjs:73-86` re-exports; `tests/build/t76-signing-custody.test.mjs:50` asserts each re-export is the shared binding itself and pins the two environment names and the two purposes; `tests/build/t76-release-publication.test.mjs` and `t76-timestamp-refresh.test.mjs` pass with no edit    |
| `VES_T76_PUBLISH_*` codes are unchanged                                   | The code moved verbatim. `tests/build/t76-release-publication.test.mjs` and `tests/build/t76-timestamp-refresh.test.mjs` assert `SIGNING_KEY_MISSING`, `SIGNING_KEY_INVALID`, `KEY_MISMATCH`, `ANCHOR_MISSING`, `ANCHOR_INVALID`, `ANCHOR_RETIRED` and `OUTPUT_EXISTS` unedited; `t76-signing-custody.test.mjs:102` too |
| The default anchors still resolve to the committed trust directory        | `tests/build/t76-signing-custody.test.mjs:58`; `tests/build/t76-release-publication.test.mjs:267` still resolves both committed anchors to the recorded key ids                                                                                                                                                         |
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
