# T63 Read-Only Confluence Knowledge Connector Validation

## Scope

- Task: T63 — Implement read-only Confluence knowledge Connector
- Requirements: VES-INT-003, VES-DSC-004…005, and VES-CTX-003/006
- Commit target: `feat(connectors): add readonly confluence source`
- Focused evidence: 42 contract and security cases
- Required minimum: 25 cases
- Spec deviations: none

T63 adds `architecture-confluence` as a closed implementation of the shared application `ContextSourcePort`. It can search pages, read explicitly named pages, list attachments, and read allowlisted bounded textual attachments. Its public capability set is frozen and read-only, and its class prototype exposes only `resolve`; there is no plan, apply, create, update, delete, reconcile, grant, or write operation.

Every remote page and attachment becomes `untrusted-data` under a locally configured classification. The adapter binds source revision to canonical page/attachment identities, remote revisions, and controller-computed content digests. The downstream Context Snapshot controller independently computes fragment digests, freshness, missing/unavailable/stale findings, contradiction evidence, and trust envelopes. Instruction-like text remains content and receives no authority.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/contract/confluence-readonly-contract.test.mjs tests/security/confluence-readonly-security.test.mjs` | PASS — 42 passed, 0 failed/skipped |
| `node --test ...Effect/Jira/Confluence focused suites...` | PASS — 117 passed before the final two Confluence adequacy additions; no Effect/Jira regression |
| `pnpm test:architecture` | PASS — 10 passed; zero dependency-boundary violations |
| `pnpm gate:security` | PASS — format, lint, typecheck/build, unit/property, contract, integration, E2E, architecture, qualification, security, and fault stages |

## Spec-anchored adequacy matrix

| Requirement / done-when criterion | Exact assertion evidence | Spec-defined outcome | Result |
| --- | --- | --- | --- |
| VES-INT-003 no mutation Tool | `tests/contract/confluence-readonly-contract.test.mjs:11-21` | Only search/page/attachment reads exist; no mutable capability or method is exposed | PASS |
| Search and page retrieval | `tests/contract/confluence-readonly-contract.test.mjs:24-49` | Bounded search pagination and canonical explicit-page retrieval produce one normalized knowledge observation | PASS |
| Attachment retrieval | `tests/contract/confluence-readonly-contract.test.mjs:51-61`; `tests/security/confluence-readonly-security.test.mjs:132-165` | Only allowlisted, identity-exact, bounded textual attachments become fragments | PASS |
| VES-DSC-004 provenance/revision/digest | `tests/contract/confluence-readonly-contract.test.mjs:63-94`; `tests/security/confluence-readonly-security.test.mjs:64-78` | Source identity, retrieval time, remote revision, configured classification, and content bytes bind deterministic source/fragment digests | PASS |
| VES-DSC-005 explicit stale/missing/unavailable evidence | `tests/contract/confluence-readonly-contract.test.mjs:106`; `tests/security/confluence-readonly-security.test.mjs:80-98`; `tests/security/confluence-readonly-security.test.mjs:202-224` | Empty search is missing, old retrieval is stale, absent explicit page fails, and auth failure is sanitized; none become unstated facts | PASS |
| VES-CTX-003 instruction isolation | `tests/contract/confluence-readonly-contract.test.mjs:96-104`; `tests/security/confluence-readonly-security.test.mjs:39-62` | Instruction-like content remains structurally untrusted data and cannot override source, classification, trust, revision, or capability | PASS |
| Closed Workspace/source/scope authority | `tests/contract/confluence-readonly-contract.test.mjs:109-134`; `tests/security/confluence-readonly-security.test.mjs:100-118` | Foreign Workspace/source/kind, unknown/write-shaped selector fields, credentials, and remote authority fields fail before trust promotion | PASS |
| Bounded external API behavior | `tests/security/confluence-readonly-security.test.mjs:120-200` | Text/media/byte/rate/page/cursor bounds fail closed with safe exact codes | PASS |
| VES-CTX-006 downstream egress boundary | `tests/security/confluence-readonly-security.test.mjs:64-98` | Connector returns classified untrusted fragments only; serialization/egress remains owned by the existing Context Compiler and Data Egress Firewall | PASS |

## Architecture correction discovered by the gate

The first security-gate run rejected two sibling-adapter imports: Confluence imported Context contracts from `agent-runtime`, and the earlier Jira implementation imported Effect contracts from `effects`. The correction moved shared Effect and Context Source contracts into `application`, re-exported them through existing packages for compatibility, and made `effects`, `agent-runtime`, and `connectors` depend only inward. The architecture gate then passed with zero violations, and all combined Effect/Jira/Confluence focused tests passed.

This is not an exception or allowlist expansion. The boundary rule remained unchanged and forced the ports into their proper owner.

## Independent discrimination sensor

The TLC Verifier copied the staged T63 and boundary-correction diff into a detached disposable Git worktree, installed the locked dependency graph offline, committed an isolated verifier baseline, ran 42 focused plus 10 architecture cases, injected one production behavior fault at a time, restored the baseline after every run, reran the complete baseline, and removed the scratch tree. The active implementation worktree was never mutated.

| Mutation | Behavior fault | Result |
| --- | --- | --- |
| M1 | Add a public `update` operation to the read-only source | KILLED |
| M2 | Promote Confluence page content to `verified-evidence` | KILLED |
| M3 | Remove page content bytes from the canonical source revision | KILLED |
| M4 | Ignore an exhausted Confluence rate budget | KILLED |
| M5 | Accept a repeated search pagination cursor | KILLED |

Sensor depth is P0/full manual behavior mutation: 5/5 killed, 0 survived. Standalone independent validation was used because agent delegation is prohibited in this environment.

## Non-shallow checks

- The connector prototype structurally contains no mutation surface; this is stronger than merely denying writes at runtime.
- Selector input is a closed mode-specific schema. Unknown, credential, and write-shaped fields fail before transport invocation.
- Workspace, source kind, source identity, configured space, and selector identity are independently validated.
- Search terms, page IDs, media allowlists, pages, and fragments are canonicalized and duplicate identities fail closed.
- Remote ordering cannot change observation revision or fragment order.
- Changing remote revision or page bytes changes the canonical source revision.
- Retrieval time is controller supplied; remote content cannot forge freshness.
- Classification is local configuration and cannot be downgraded by a remote page.
- Page and attachment contents are always untrusted, including instruction-like strings.
- Context ingestion recomputes content digests and emits an explicit stale finding without trust promotion.
- Page body, title, attachment media, declared bytes, actual bytes, identity, and pagination are bounded and revalidated.
- Authentication errors expose no provider message, token, host, credential, or raw payload.
- No Effect Broker is used because the connector has no effect; no Approval or capability grant can be minted by this adapter.
- Shared Context and Effect contracts now reside in `application`, eliminating sibling-adapter coupling without weakening the architecture policy.

## Verdict

PASS for T63. `architecture-confluence` is a bounded read-only Context Source whose external content remains classified, provenance-bound, digest-bound, stale-aware, and structurally untrusted. It exposes no page mutation capability and cannot turn Confluence content, credentials, or provider metadata into instruction or execution authority.
