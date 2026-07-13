# T18 Validation — Workspace and Git Ownership Scanner

**Gate:** `corepack pnpm gate:security` plus `corepack pnpm test:integration`  
**Result:** 1,154 unit, 61 security, 51 integration, 10 architecture, 248 qualification, and 22 fault-injection cases passed with zero failures. Format, lint, strict TypeScript, build, and frozen offline dependency resolution passed.  
**SPEC_DEVIATION:** none.

## Check A — Sufficient coverage

| Criterion | Assertion evidence | Spec outcome | Covered |
| --- | --- | --- | --- |
| Exact control root | Standalone and subdirectory-negative cases | Scan is accepted only at the resolved Git top level | Yes |
| Standalone repository | Real Git fixture | One control boundary, one root Project, one owner | Yes |
| Monorepo | Node and Go markers in one repository | Multiple Projects inherit the same Git owner | Yes |
| Nested repository | Independent real Git fixture | Nested `.git/` creates a separate owner boundary | Yes |
| Ignored project repository | Real `.gitignore` plus nested repository | Git itself reports ignored state while the project remains visible and separately owned | Yes |
| Submodule | Real `git submodule add` fixture | Gitfile is resolved and classified as `submodule` | Yes |
| Linked worktree | Real `git worktree add` fixture | Gitfile is resolved and classified as `worktree` | Yes |
| Sparse checkout | Real cone-mode sparse fixture | Repository inventory reports sparse mode and only present Projects | Yes |
| Broken placeholder | Gitfile targeting a missing directory | Boundary is retained as broken; its Project receives no writable owner | Yes |
| Project discovery | Eight marker families plus priority cases | Node, Python, Go, Rust, Maven, Gradle, .NET, and Terraform markers are deterministic | Yes |
| Remote privacy | HTTPS/SSH/SCP corpus and credential-bearing real remote | Credentials, query, fragment, and raw URL are absent; only SHA-256 fingerprint remains | Yes |
| Link boundary | External real junction/symlink | Link is recorded as outside and never traversed | Yes |
| Git ignore authority | Ignored nested repository fixture | Uses `git check-ignore`; no custom ignore parser | Yes |
| Determinism | Repeated scan and insertion-order cases | Identical topology yields byte-equivalent inventory and fingerprint | Yes |
| Bounded traversal | Directory/entry/depth limits | Oversized tree fails with a stable code and zero writes | Yes |
| Zero writes | Full byte snapshot before/after | Source files and all Git metadata bytes remain unchanged | Yes |
| Portable output | Repeated and remote cases | No absolute control path or raw remote URL appears in inventory | Yes |
| Public failures | Exact catalog case | All eight scanner errors validate against `public-error@1` | Yes |

## Check B — Non-shallow

The focused suite contains 31 unit, 9 integration, and 5 security cases: 45 total against the required minimum of 30. Integration tests invoke Git 2.54 through read-only commands with optional locks disabled and build actual commits, nested repositories, ignore rules, submodules, linked worktrees, and sparse checkouts. Security tests hash every file under the fixture, including `.git`, before and after scanning.

## Check C — Ownership and privacy model

- The inventory stores only control-relative POSIX Logical Paths.
- A Project inherits the nearest active Git boundary. A broken Gitfile boundary deliberately yields `gitOwnerId: null` rather than falling through to the parent repository.
- Nested repositories, submodules, and worktrees remain explicit boundary records; ignored status never erases source visibility or authorizes a write.
- Links are inventory leaves and are never recursion edges.
- Remote URLs are parsed, stripped of user information, query, fragment, and `.git`, then hashed. The normalized URL itself is not returned.
- Scanner commands set `GIT_OPTIONAL_LOCKS=0` and disable fsmonitor refresh; the byte-snapshot test independently proves the no-write contract.

## Check D — Requirement mapping

| Requirement | Evidence |
| --- | --- |
| VES-WSP-001 | Standalone exact-root inventory works without monorepo configuration |
| VES-WSP-002 | Monorepo Projects are inventoried before any write path exists |
| VES-WSP-007 | Nested Git, ignored paths, submodules, worktrees, symlink/junction boundaries, and malformed Gitfiles are explicit and fail closed |
| VES-DSC-001 | Project markers, Git ownership, sparse state, remote identity fingerprint, and portable topology evidence are deterministic |

## Adequacy verdict

PASS — the scanner produces a bounded, deterministic, credential-free, zero-write ownership inventory across every T18 topology, with 45 focused cases and complete repository security/integration gates.
