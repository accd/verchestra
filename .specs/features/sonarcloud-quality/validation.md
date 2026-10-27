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
