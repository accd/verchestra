# Contributing to Verchestra

Thank you for contributing. Verchestra values small, reviewable changes with evidence.

## Before you start

1. Search existing [issues](https://github.com/accd/verchestra/issues) and [discussions](https://github.com/accd/verchestra/discussions).
2. Open a Discussion for broad design questions. Open an Issue for a reproducible bug or a scoped proposal.
3. Do not include credentials, production data, private database schemas, or machine-local files in an issue, commit, test, or pull request.

## Local setup

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm gate:quick
```

Use Node `24.14.0` and pnpm `10.34.5`.

## Pull requests

- Start from current `main` and keep one logical concern per pull request.
- Link the relevant issue and explain the user-visible change.
- Add or update tests for behavior, not implementation details.
- Run the smallest relevant test layer while developing, then run `pnpm gate:quick` before requesting review.
- Update documentation when behavior, setup, safety boundaries, or supported surfaces change.
- Keep generated state, local profiles, secrets, credentials, and private artifacts out of Git.

Contributions are accepted under the repository's [GPL-3.0-only license](LICENSE). No separate contributor agreement or sign-off is required.

## Review expectations

Reviewers check correctness, test evidence, compatibility, security boundaries, documentation, and whether the change preserves idempotent behavior where applicable. Maintainers may request additional qualification for driver, database, policy, distribution, or security changes.

## Conduct

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
