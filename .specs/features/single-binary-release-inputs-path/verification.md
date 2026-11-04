# single-binary-release-inputs-path verification

**Verdict**: PASS
**Proofs**: `proofs.md` at 8967f9ec
**Verifier**: independent sub-agent (author != verifier)

How this report was produced: the Verifier worked under a plan-mode restriction that only let it edit its
own plan file, so it returned this report in chat and did not run mutants. The author transcribed its
judgements below, and ran the six mutants listed here for real. The judgements are the Verifier's.

## Checks

| Check | Test | Holds |
| --- | --- | --- |
| C1 | `tests/agent-readiness/single-binary-workflow.test.mjs` `the reviewed inputs directory is the one the metadata artifact exposes` | yes - it needs the exact argument `reviewed/release-inputs` and the download path to equal `reviewed`; the path count must be four and the root is pinned |
| C2 | `tests/agent-readiness/single-binary-workflow.test.mjs` `the derivation reproduces the directory the published package was built from` | yes - an independent anchor: it checks the directory `npm-publish.yml` reads, not the workflow under review |
| C3 | `tests/agent-readiness/single-binary-workflow.test.mjs` `reviewed binaries are built twice, compared byte for byte, and run with PATH emptied` | yes - the exact argument match excludes any extra segment, and the old segment is forbidden everywhere |

## Findings

| Finding | Evidence | Fix | Closed |
| --- | --- | --- | --- |
| The least-common-ancestor claim rests on a log line that is not in the repository | the repository shows only four upload paths and `npm-publish.yml` reading `publication/release-inputs`, which also fits stripping the first segment | cite the real upload log | 8967f9ec - the log of job 123880634649 in run 40999595578 reads the least common ancestor is the t76-release-publication directory and the root of the artifact, for 29 files; it is cited in checks.md and beside the model |
| The test models the action with its own rule (an extension means a file, cut at the first wildcard) | the model is the test's own | say what it reproduces | 8967f9ec - the comment beside `metadataArtifactRoot` cites the observed upload |
| The npm regex ended in a word boundary and also accepted a longer name | it matched `publication/release-inputs-x` | end it so no name character follows | 8967f9ec - it ends in a negative lookahead; mutant M6 below fails it |
| Forbidding the old segment anywhere in the workflow had no check naming it | the exact argument match already excludes it | name it in a check | 8967f9ec - C3 now reads that the segment appears nowhere in the workflow |

## Mutants run by the author, each restored

| Mutant | Killed by |
| --- | --- |
| the old path restored in the build argument | C1 and C3 |
| the download path changed | C1 |
| the argument longer by one segment | C1 and C3 |
| the publish upload drops a path | C1 and C2 |
| the publish upload adds a path outside the root | C1 and C2 |
| npm reads a longer name | C2 |
