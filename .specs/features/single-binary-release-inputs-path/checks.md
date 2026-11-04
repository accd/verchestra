# Single-binary reviewed-inputs path checks

Build: `corepack pnpm exec eslint tests/agent-readiness/single-binary-workflow.test.mjs`; `corepack pnpm exec prettier --check tests/agent-readiness/single-binary-workflow.test.mjs`
Run wf: `node --test --test-reporter=spec tests/agent-readiness/single-binary-workflow.test.mjs`

## Intent

The first dispatch of `single-binary-build.yml` with reviewed inputs (run 41922118231, T6 of
`single-binary-distribution`) failed on all five legs in "Build twice from the reviewed inputs":
`VES_VESTRA_BUILD_INPUTS_MISSING`, `reviewed/t76-release-publication/release-inputs/release-source.json`
does not exist. The `t76-release-metadata` artifact is uploaded from four paths under
`t76-release-publication/`, and `actions/upload-artifact` makes their least common ancestor the
artifact root, so the files download as `<path>/release-inputs/...`. `npm-publish.yml` downloads the
same artifact to `publication` and reads `publication/release-inputs`, which is how the `.9` package
was built. The single-binary workflow added a segment that does not exist, and a test pinned that
segment, so nothing had shown the mistake before the first real dispatch.

When this ships, the workflow reads `reviewed/release-inputs`, and a test derives the artifact root
from the publish workflow's own upload paths and checks both consumers against it, so a path that the
upload does not produce fails in a unit test and not on a runner. It does not run the build: that is
a new dispatch of the workflow, which this change makes possible.

3 checks in 1 slice · 0 one-way doors · 0 open

## Checks

### S1 - the workflow reads where the artifact puts the inputs

**C1** - The directory the single-binary workflow builds from is the one the metadata artifact exposes: the download path joined with the release-inputs path relative to the least common ancestor of the publish workflow's upload paths
Proof: run wf | ✔ the reviewed inputs directory is the one the metadata artifact exposes

**C2** - The same derivation reproduces the directory `npm-publish.yml` reads, the consumer that built the published `.9` package
Proof: run wf | ✔ the derivation reproduces the directory the published package was built from

**C3** - The build step names `reviewed/release-inputs`, and the segment `t76-release-publication` appears nowhere in the workflow
Proof: run wf | ✔ reviewed binaries are built twice, compared byte for byte, and run with PATH emptied

## Coverage

| Set (size)                             | Member -> proof                                                                                             | Unproven |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------- |
| consumers of the metadata artifact (2) | `single-binary-build.yml` C1 C3 · `npm-publish.yml` C2                                                      | -        |
| upload paths of the artifact (4)       | `publication-manifest.json` C1 · `ledger-entry.json` C1 · `publication/*/metadata` C1 · `release-inputs` C1 | -        |

## Swept

- validation: C1, C2
- failure modes: C1 (a path the upload does not produce fails the unit test)
- idempotency: n/a - a path in a workflow
- authorization: existing - the workflow stays read-only with `contents: read` and `actions: read`, asserted by `the workflow is manual, read-only, and requests no identity`
- concurrency: n/a - one manual run, no shared state
- data lifecycle: n/a - nothing stored
- dependency failure: n/a - the download step is unchanged
- state transitions: n/a - no entity moves through states
- observability: n/a - the failing step already prints the missing path

## Assumptions

| Assumption                                                                                   | Default                            | Rationale                                                                                                                                                                                                                                                                        | Confirmed? |
| -------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `actions/upload-artifact` makes the least common ancestor of several paths the artifact root | root is `t76-release-publication/` | the real upload says so: the log of job 123880634649 in run 40999595578 reads "The least common ancestor is .../t76-release-publication. This will be the root directory of the artifact" for the 29 files of `t76-release-metadata`, and `npm-publish.yml` works on that layout | y          |
| The change to `.github/workflows/` preserves enforcement                                     | preserves                          | it corrects one path; no gate, check, permission or scan is removed or narrowed                                                                                                                                                                                                  | y          |

## Out of scope

- Running the reviewed-input build again: a new dispatch after this merges.
- Signing: owner.

## Handoff

- **Settled mid-build:** none; the user's standing instruction is to proceed without stopping (2026-11-04)
- **Dispatched:** Verifier, round 1, at the HEAD of the commit that carries this line; not yet returned
- **Boundary:** C1-C3 closed at the fix commit
- **Abandoned:** none
- **Walked:** n/a - no screen
