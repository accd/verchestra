# Site Status Truth Specification

## Problem statement

The public site and its hand-written guides describe a qualification state
the repository no longer has. The landing page says the 1.0 decision is
"pending" and "has not been made"; the qualification overview lists T69 as
"next" and T70–T77 as "planned"; the documentation index points at "T01–T68a"
reports. The repository has carried the signed 1.0.0 decision, a reject
recorded as a hold, since 2026-08-28
(`docs/qualification/release-decision-1.0.0.md`), and
`corepack pnpm agent:context` derives "T77 complete; the declared chain is
fully verified". Two more claims drifted: the primary call to action sends
visitors to a source checkout while the README's first path is the published
npm package, and the probes section calls SAP ASE / Sybase a first-class
adapter, which AD-017 retired (SQLite is the only live-qualified engine).

## Goals

- Every status statement on the site derives from, or agrees with, the typed
  status in `apps/site/src/data/product.ts` and the signed decision file.
- The landing page's primary action leads to the published package.
- The engine wording follows AD-017 on the landing page, in the discovery
  workflow guide, and in the README value bullet.
- The scoped `AGENTS.md` files stop pinning a hand-maintained task pair.
- Drift of this kind becomes a failing test, not a reader's discovery.

## Requirements

| Id     | Requirement                                                                                                                                                                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SST-01 | `productStatus` carries `decision: "hold"`, and a unit test fails if `release-decision-1.0.0.md` does not record `decision: reject` for `version: 1.0.0`.                                                                                                                            |
| SST-02 | The landing pill reads `1.0 decision: signed hold`; the qualification section says the decision has been made; the built homepage contains neither "1.0 decision pending" nor "has not been made".                                                                                   |
| SST-03 | The primary call to action reads "Install the beta build" and links `docs/install-and-run/`.                                                                                                                                                                                         |
| SST-04 | `maturityDefinitions.available` and the README legend describe the published npm package, not a source checkout.                                                                                                                                                                     |
| SST-05 | The probes copy and the discovery guide state the AD-017 model; the panel labels are `live-qualified` and `contract-verified`.                                                                                                                                                       |
| SST-06 | `index.mdx`, `qualification/index.md`, `qualification/security-and-isolation-evidence.md`, `qualification/supply-chain-qualification.md`, `architecture/distribution.md`, `install-and-run.md`, and `current-qualification-status.md` carry no future-tense claim about completed tasks. |
| SST-07 | A documentation-contract test pins the status-bearing guides to the derived `highestVerifiedTask`.                                                                                                                                                                                   |
| SST-08 | `apps/site/AGENTS.md` and `docs/AGENTS.md` describe status as derived, not as a fixed task pair.                                                                                                                                                                                     |
| SST-09 | Every existing gate stays green, with equivalent assertions where a pinned string changed (`site.spec.ts`, `check-built-site.mjs`, `product-contract.test.mjs`).                                                                                                                     |

## Out of scope

- The landing-page redesign (diagrams, install block, section storyboard) and
  the Starlight chrome unification: separate changes.
- `docs/qualification/t77-validation.md` and every other validation report:
  immutable evidence.
- The `llms.txt` template.
