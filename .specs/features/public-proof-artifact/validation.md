# Public Proof Artifact Validation

Verdict: **PASS** — independent Verifier (author ≠ verifier), branch
`feat/155-execution-package-artifact`, diff range `d243d9c..ff23d7f` plus the
post-verification test strengthening commit.

## Per-requirement evidence

| Req    | Verdict | Evidence                                                                                                                                        |
| ------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| PRF-01 | PASS    | Generator is tracked code; both committed files byte-identical to fresh generation (drift tests); entry point named on the page and test-pinned |
| PRF-02 | PASS    | Unit scan over both published files (paths, private-key markers, token shapes) plus the built-site scanner over all 125 rendered pages          |
| PRF-03 | PASS    | "Fixture-generated, not a live run" is the first content element after the H1; missing live stages named; pinned in unit and built-site tests   |
| PRF-04 | PASS    | `corepack pnpm proof:generate` reproduced byte-identical output (clean `git diff` after regeneration); all determinism inputs pinned            |
| PRF-05 | PASS    | Drift failures name the first divergent character and both byte runs; the deploy job requires the quality gate, which runs the drift test       |
| PRF-06 | PASS    | Standard static Starlight page with Markdown alternate; theme coverage via the shared site system (see limitations)                             |

## Discrimination sensors (two independent runs)

1. **Author sensor** — committed JSON `schemaVersion` byte tampered (applied,
   proven): drift test failed with `drifted from the generator at character
4167 … committed "2,…" vs regenerated "1,…"`; restored; 5/5 clean.
2. **Verifier sensor** (different surface) — provenance phrase deleted from
   the committed Markdown (git diff 1+/1-): 2/5 tests failed — the drift test
   naming character 30 line 3 with both byte runs, and the provenance pin
   `/Fixture-generated, not a live run/`; restored via git; 5/5 clean;
   worktree verified clean.

## Test counts

Unit proof suite 5/5; site unit 50/50; astro check 0 errors; build 125
pages; `check:built` pass including the three proof-page pins; `gate:quick`
and `agent:check` PASS.

## Known limitations (accepted, non-blocking)

- PRF-06 theme/accessibility coverage is inherited from the shared Starlight
  e2e matrix rather than pinned to this route specifically.
- The drift check guards the publish path through gate composition (deploy
  requires the quality gate); a bare local `site:build` does not itself run
  the drift test.
- The committed Ed25519 key is deliberately TEST-ONLY fixture material,
  labeled in code, page, and design.md; it signs fixture data and carries no
  trust. Explicitly surfaced for human sign-off at review.

## Human review

Required before merge, per repository governance.
