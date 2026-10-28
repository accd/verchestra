# Support

Use the right GitHub channel so the delivery backlog stays actionable.

| Need | Channel |
| --- | --- |
| Question, idea, setup help, or architecture conversation | [GitHub Discussions](https://github.com/accd/verchestra/discussions) |
| Beta feedback that is not a reproducible bug: what you tried, what confused you, what you would change | [Beta feedback thread](https://github.com/accd/verchestra/discussions/670) |
| Something in the published package did not work for you (beta testers) | [Beta tester bug report](https://github.com/accd/verchestra/issues/new?template=tester_bug_report.yml) |
| Reproducible defect found while contributing | [Bug report](https://github.com/accd/verchestra/issues/new?template=bug_report.yml) |
| Scoped capability proposal | [Feature request](https://github.com/accd/verchestra/issues/new?template=feature_request.yml) |
| Security vulnerability | [Private security report](https://github.com/accd/verchestra/security/advisories/new) |

Please remove secrets, production data, customer identifiers, and private schema details before posting.

## What to attach

A report a maintainer can act on carries the build and the exact refusal.
Every Verchestra command prints a public JSON envelope with `--output json`;
it names a stable code and the safe details of a refusal, never a credential
or a machine-local path.

- `npx verchestra --version --output json` (`vestra --version --output json`
  after an install): the version and the revision of the build you ran.
- The command that failed, run again with `--output json`.
- For a task: `vestra task status --output json --run-id <runId>`.
- For a setup question: `vestra doctor --output json`. `doctor` is a
  read-only health report, not a setup check, so its verdict is context for
  the maintainer, not the bug itself.
