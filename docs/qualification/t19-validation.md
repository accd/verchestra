# T19 Validation — Placement Policy, Artifact Resolver, and Write Planner

**Gate:** `corepack pnpm gate:quick`  
**Result:** 1,208 unit/property cases passed with zero failures. Format, lint, and strict TypeScript passed.  
**SPEC_DEVIATION:** none.

## Check A — Sufficient coverage

| Criterion | Assertion evidence | Spec outcome | Covered |
| --- | --- | --- | --- |
| One placement engine | Effective-placement matrix | Colocated, centralized, mixed, and external-control use one total decision function | Yes |
| Workspace artifacts | Workspace manifest case | Always resolves to control owner under `.verchestra/` | Yes |
| Colocated Projects | Nine artifact-class cases | Resolves under the Project source root and its exact Git owner | Yes |
| Centralized Projects | Nine artifact-class cases | Resolves only under control `.verchestra/projects/<slug>/` | Yes |
| Mixed placement | Inherit and explicit override cases | Workspace default plus per-Project override is deterministic | Yes |
| External control | Placement-mode case | Project artifacts remain centralized regardless of source location | Yes |
| Nested Git safety | Nested/submodule/worktree plus authorization cases | Inherited placement defaults centralized; explicit colocated requires owner and authorization | Yes |
| Ignored and broken sources | Effective-placement cases | Inherited artifacts centralize; broken owner never receives a target | Yes |
| Same-root monorepo owner | Colocated path cases | Project prefix is included while Git owner remains the control repository | Yes |
| Nested-repository owner | Authorized nested spec case | Target is repository-relative and belongs only to the child owner | Yes |
| Logical path safety | Six invalid-name cases | Traversal, absolute, backslash, empty, dot, and reserved paths fail before planning | Yes |
| Runtime vocabulary safety | Six forged-boundary cases | Invalid placement, relation, booleans, scope, or artifact class fail closed | Yes |
| Deterministic plan | Direct and six-permutation properties | Desired-order changes produce the same writes and plan ID | Yes |
| Content addressing | Digest-change property | Content changes deterministically change the plan identity | Yes |
| Idempotent desired set | Duplicate case | Identical logical writes collapse to one operation | Yes |
| Collision denial | Different-content same-target case | Incompatible targets fail before any effect | Yes |
| Git-owner partition | Two-owner case | Plan declares the exact sorted owner set and never merges target namespaces | Yes |
| Centralized zero-write invariant | All project classes in one plan | Every target stays below the control project-artifact root | Yes |
| Public failures | Exact catalog case | All seven placement errors validate against `public-error@1` | Yes |

## Check B — Non-shallow

The focused suite contains 54 unit/property cases against the required minimum of 40. The matrix covers every artifact class in both placement families, all Workspace modes, parent/child Git ownership, unsafe runtime inputs, six input permutations, duplicate convergence, incompatible collisions, and plan identity sensitivity.

## Check C — Pure decision boundary

The resolver performs no filesystem or Git access and accepts no absolute paths. Inputs contain stable Project IDs, control-relative source hints, Git owner digests, and policy facts. Outputs contain only owner-relative Logical Paths. The later apply service must revalidate the T18 inventory and use T17 protected handles; T19 deliberately grants no write capability.

`WritePlan` contains digests and safe generation/lifecycle metadata, not file bytes, secrets, machine paths, or credentials. Writes and owner IDs are sorted and frozen before the plan digest is calculated.

## Check D — Requirement mapping

| Requirement | Evidence |
| --- | --- |
| VES-WSP-003 | Workspace artifacts always resolve to the canonical control root |
| VES-WSP-004 | Project artifacts resolve through colocated or centralized policy |
| VES-WSP-006 | Centralized plans contain zero Project-source metadata paths |
| VES-WSP-007 | Nested owners, ignored sources, unsafe logical paths, and unauthorized colocated writes fail closed |
| VES-BST-001 | Planned artifacts contain portable logical references and exclude machine/credential state |

## Adequacy verdict

PASS — one pure engine resolves all placement modes, binds every target to one Git owner, prevents centralized source metadata, and emits deterministic content-addressed WritePlans across 54 focused cases.
