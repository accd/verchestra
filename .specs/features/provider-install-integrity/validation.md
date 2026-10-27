# Provider install integrity (#596, item 2): validation

**Date:** 2026-10-27
**Diff:** `ci/596-provider-install-integrity` from `5b131e9`
**Host:** Windows 11 Pro x64, Node 24.14.0, npm 11.9.0, pnpm 10.34.5.
**Verifier:** the implementing agent's local pass. The pull request's Linux
Quality gate runs the `ci.yml` install, since a workflow change selects
`gate:release` and with it `test:qualification`.

## Acceptance evidence

| Requirement | Evidence                                                                                                                                                                                                                                                                                                                                                                                                          | Result                                      |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| PI-01       | `.github/qualified-providers/package-lock.json`: 16 packages (the two CLIs, eight Claude Code and six Codex platform packages), each with a sha512 `integrity` and a registry.npmjs.org `resolved`. The two top-level hashes equal `npm view <package> dist.integrity`. `qualified-providers.test.mjs`.                                                                                                           | PASS                                        |
| PI-02       | A copy of the lockfile with one bit of the `@openai/codex-win32-x64` hash flipped: npm logs "seems to be corrupted" twice, skips the package and exits 0; `verify-provider-install.mjs` then exits 1 with `node_modules/@openai/codex-win32-x64 0.115.0-win32-x64 is not installed`. `verify-provider-install.test.mjs`.                                                                                          | PASS                                        |
| PI-03       | Only `node_modules/@anthropic-ai/claude-code` has `hasInstallScript`; its `install.cjs` links or copies the binary out of the platform package and fetches nothing. The workflows rebuild only that package.                                                                                                                                                                                                      | PASS                                        |
| PI-04       | `qualified-providers.test.mjs` matches each workflow's `--version` checks to the manifest and refuses a versioned package spec in any of them.                                                                                                                                                                                                                                                                    | PASS                                        |
| PI-05       | The `ci.yml` step text, run under Git Bash with a Windows-form `RUNNER_TEMP`: 4 packages added, the check passes for win32-x64, both versions match, and `GITHUB_PATH` receives the native `.bin` path. With that path first and an empty `APPDATA`, both spike drivers resolve to the lockfile install, and `VES_REQUIRE_PINNED_PROVIDERS=1 pnpm test:qualification` passes 361 of 362 (1 skipped: POSIX modes). | PASS on Windows; Linux in CI; macOS not run |
| PI-06       | `gate-selection.test.mjs`: the manifest, the lockfile and the check select `gate:full` and `gate:release`.                                                                                                                                                                                                                                                                                                        | PASS                                        |

## Discrimination sensors

Each mutant was applied to the working tree, run against the tests named, and
reverted.

| Mutant                                                     | Killed by                                                                                    |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `ci.yml` goes back to the global install                   | `workflow-install-scripts`, `qualified-providers`, `pages-workflow`                          |
| `platform-matrix.yml` drops the install check              | `workflow-install-scripts`, `platform-matrix-workflow`                                       |
| `full-validation.yml` rebuilds Codex too                   | `workflow-install-scripts`                                                                   |
| a platform package loses its integrity                     | `qualified-providers`                                                                        |
| a platform package is missing from the lockfile            | `qualified-providers`                                                                        |
| Codex gains an install script                              | `qualified-providers`                                                                        |
| the manifest moves Claude Code without the workflows       | `qualified-providers`                                                                        |
| `admits` ignores a negated entry                           | `verify-provider-install`                                                                    |
| the check accepts any installed version                    | `verify-provider-install`                                                                    |
| the check passes a lockfile with nothing for this platform | `verify-provider-install`                                                                    |
| the check ignores the CPU                                  | `verify-provider-install`, after a same-OS fixture was added (it survived the first fixture) |
| gate selection forgets the provider directory              | `gate-selection`                                                                             |

## Not run

The macOS and Linux arm64 legs of `platform-matrix.yml` and
`t76-candidate-build.yml` are dispatched by hand and did not run on this
change. They carry the step text run here on Windows, which
`workflow-install-scripts.test.mjs` requires in all four workflows.

## Gates

| Gate                           | Result     |
| ------------------------------ | ---------- |
| `pnpm gate:quick`              | PASS       |
| `tests/architecture`           | 144 of 144 |
| `pnpm agent:check`             | PASS       |
| The new and changed test files | 120 of 120 |
