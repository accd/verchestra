# SonarCloud Quality Validation

Issues that stay open by design. Each needs a human to mark it **Accepted** in
SonarCloud with the reason below; the repository records the decision so the
residual count is explained, not hidden.

## Accepted issues

### S3735 — `void` on a binding omitted by a rest sibling (8)

The repository's ESLint `@typescript-eslint/no-unused-vars` runs without
`ignoreRestSiblings` or an underscore pattern, so a property dropped with
`const { a, ...rest } = value` must be referenced once. `void a;` is that
reference: it has no effect and no other spelling satisfies the gate without
relaxing the lint configuration. The other 12 S3735 issues (unused parameters,
no-op statements, an arrow body) were fixed in the S3735 change.

| Key                    | Location                                                        |
| ---------------------- | --------------------------------------------------------------- |
| `AaEFDtyEg7hdaRA91OEy` | `apps/vestra-cli/src/task/task-coordination-surface.ts:99`      |
| `AaD86U9L0viU7A400bZF` | `apps/vestra-cli/src/task/task-run-record.ts:527`               |
| `AaD86U9L0viU7A400bZG` | `apps/vestra-cli/src/task/task-run-record.ts:528`               |
| `AZ_yemeIb8ENv9FoMvWd` | `packages/agent-runtime/src/models/passport-registry.ts:310`    |
| `AZ_yemeIb8ENv9FoMvWe` | `packages/agent-runtime/src/models/passport-registry.ts:311`    |
| `AZ_yemeIb8ENv9FoMvWf` | `packages/agent-runtime/src/models/passport-registry.ts:312`    |
| `AaEE1_wk83L1ikkP71Bk` | `packages/application/src/execution/coordination-ledger.ts:192` |
| `AaEE1_wk83L1ikkP71Bl` | `packages/application/src/execution/coordination-ledger.ts:193` |

Alternative for the owner: enable `ignoreRestSiblings: true` on
`no-unused-vars` in a reviewed change, then drop these eight `void` lines.

### Long-tail sweep: three issues whose fix would change behaviour (3)

| Key                    | Rule  | Location                                               | Reason                                                                                                                                                                                                                          |
| ---------------------- | ----- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AaD86U9L0viU7A400bZH` | S7784 | `apps/vestra-cli/src/task/task-run-record.ts:683`      | The JSON round trip is the point: it drops `undefined` members so the record and its digest match its JSON form (the `invariant:` above it). `structuredClone` keeps them and would change the digest.                          |
| `AaDw358CW0OXA57WdXPF` | S7785 | `apps/vestra-launcher/closure/single-binary-main.ts:6` | `scripts/build-vestra-binary.mjs` bundles this entry as CommonJS (`format: "cjs"`) for the single executable, and CommonJS has no top-level await.                                                                              |
| `AaEBb9RM_FksIXlR8Rgp` | S4144 | `packages/application/src/authority/authority.ts:331`  | `ApprovalVerifier` and `ApprovalRecorder` take distinct capability-narrowed ports (verify and load against seal and save). One cannot delegate to the other without a shared base that would merge the two capability surfaces. |

## Rules turned off in the project quality profile

The owner chose, on 2026-10-29, to turn these two rules off in a custom quality
profile (extending Sonar way) assigned to `accd_verchestra`, rather than
accept each issue. A sample of about 40 of the 396 sites, spread across every
package, found no true positive. Turning the rules off also stops new port
doubles and ordered loops from raising fresh issues; the cost is that a future
true positive is no longer flagged.

### S7503 — async function without `await` (212)

The sites are implementations of Promise-returning ports (stores, repositories,
signers, verifiers, adapters) and their test doubles. `async` is what turns a
synchronous `throw` inside them into a rejected promise, which every caller
relies on. Dropping it would make those throws synchronous; wrapping each body
in `Promise.resolve` would keep the behaviour but add noise for no reader.

### S9382 — `await` in a loop (124 TypeScript, 60 JavaScript)

The loops run steps whose order is the contract: directory chains created
parent first with a symlink check at each level, staged changes applied and
recovered in sequence, evidence and effects read and reconciled in record
order, release scripts that publish one artifact after another, and walks
whose first failure must be the one reported. Running them concurrently would
change which error wins and could leave partial state.
