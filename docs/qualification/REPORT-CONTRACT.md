# Qualification Report Contract

A file named `tNN-validation.md` is not evidence. `agent:check` only counts a
report toward the qualification chain when it binds itself to the revision it
was produced on and records that the work actually passed.

Reports for T01–T68 predate this contract. They are immutable evidence and are
admitted by declaration, not rewritten.

## Required frontmatter

Every report for a task after T68 begins with:

```yaml
---
schema: verchestra-qualification-report/v1
task: T68a
revision: <the 40-character commit id the evidence was produced on>
gates: pnpm gate:quick, pnpm gate:security
gateResults: pass, pass
gateRevision: <must equal revision>
criteriaEvidence: 7 of 7
skipped: 0
todo: 0
discriminationSensor: 5 killed, 0 survived
verifier: <identity of the independent verifier>
verifierRole: independent
humanReview: approved
---
```

The human-readable body follows unchanged: scope with case counts and the
required minimum, the deterministic gates table, the spec-anchored adequacy
matrix, the discrimination sensor table, non-shallow checks, and the verdict.

## What fails closed

| Condition | Why |
| --- | --- |
| Missing or malformed frontmatter | An empty or placeholder file must never advance qualification. |
| `gateRevision` differs from `revision` | Gate evidence copied from an earlier revision is not evidence for this one. |
| A gate name absent from `package.json` scripts | A gate that does not exist cannot have passed. |
| Any `gateResults` entry other than `pass` | Partial gate coverage is not a pass. |
| `criteriaEvidence` where the two counts differ | An unproven acceptance criterion is a gap, never an inferred pass. |
| Any surviving mutant, or a sensor that ran none | A sensor that kills nothing proves nothing. |
| `skipped` or `todo` other than `0` | Skipped work is unproven work. |
| `verifierRole` other than `independent` | The implementation author's own claim is not independent verification. |
| `humanReview` other than `approved` | CI success is neither independence nor human review. |

The last two are deliberate: they mean an automated agent cannot advance the
public qualification state on its own. It can produce every piece of evidence,
but a human decides whether that evidence is accepted.

## Verifying locally

```bash
pnpm agent:check
```

Failures name the task and the missing field, and never include machine-local
paths.
