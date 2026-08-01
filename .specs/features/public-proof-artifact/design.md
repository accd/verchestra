# Public Proof Artifact Design

## The boundary that decides the shape

The artifact is a build-time projection (evolutionary-architecture lens:
strong logical boundary, no new physical one). Canonical source is product
code plus the qualified execution-package fixtures; the site renders only
committed, reviewed bytes and never imports product packages at page-render
time. Generation never runs in CI deploy steps.

| Piece                                | Location                                                            |
| ------------------------------------ | ------------------------------------------------------------------- |
| Generator (entry point, exported fn) | `scripts/generate-proof-artifact.mjs`                               |
| Committed canonical bytes (RFC 8785) | `docs/proof/execution-package.json`                                 |
| Committed inspectable page           | `docs/proof/execution-package.md` (fully generator-written)         |
| Site registration                    | `repository-content.ts` source + `astro.config.ts` Concepts sidebar |
| LLM projection                       | `llm-content-manifest.ts` entry (drives the Markdown alternate)     |
| Drift + provenance tests             | `tests/unit/proof-artifact.test.mjs`                                |
| Built-output pins (PRF-03/06)        | `apps/site/scripts/check-built-site.mjs`                            |

## Determinism decisions

- The only nondeterministic input in the existing path was the keypair; a
  committed TEST-ONLY Ed25519 PKCS#8 key (constant in the generator, keyId
  `public-proof-fixture-2026`) closes it. Ed25519 is deterministic per
  RFC 8032; clock and fixture input were already pinned by
  `tests/helpers/execution-package-fixture.mjs`.
- The generator verifies the sealed package against its own trust root and
  fails closed before writing anything.
- Drift failures name the first divergent character and both byte runs
  (lesson L-001: specific cause, never only inequality).

## Rejected

Rendering live from product imports (couples site build to product graph);
a second content system (forbidden by `apps/site/AGENTS.md`); pretty-printed
canonical file (the canonical bytes stay RFC 8785 single-line; the page
carries the readable projection).
