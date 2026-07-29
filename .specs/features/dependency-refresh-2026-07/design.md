# July 2026 Dependency Refresh Design

## Sequencing

Merge order runs from lowest risk to highest blast radius, one pull request at
a time, because protected `main` requires each branch to be up to date and each
merge invalidates the rest.

| Order | Change                        | Gate                              | Why here                                                                 |
| ----- | ----------------------------- | --------------------------------- | -------------------------------------------------------------------------- |
| 1     | prettier 3.9.6 (dev)          | `format:check`, `gate:quick`      | A formatter patch either reformats files or does not; cheapest to settle.  |
| 2     | OpenCode 1.18.7 (coordinated) | `qualify:opencode`, `gate:full`   | Needs requalification, so it carries the most work.                        |
| 3     | jose 6.2.4 (production)       | `gate:security`                   | Production cryptography; lands last, on an otherwise green `main`.         |

## OpenCode as one unit

`spikes/opencode-driver/test/opencode-driver.test.mjs:54` probes the **real**
repo-local binary and asserts its exact version, so the installed version and
the asserted version must move together. Everything else in that suite, and the
whole product contract suite under `tests/contract/`, drives a fake host
through `tests/helpers/opencode-driver-fixture.mjs` and is unaffected by the
installed package.

That distinction decides the size of the change. Only one assertion tracks the
installed version; `minimumVersion` stays at 1.17.18 everywhere.

### Why the floor does not move

`supported()` accepts any version at or above the minimum within the same
major, so 1.18.7 satisfies a 1.17.18 floor. Raising the floor would reject
1.17 hosts that work today — a user-visible narrowing that belongs to a
product decision with its own rationale, not to a Dependabot refresh. Keeping
the fake host at 1.17.18 also keeps proving that the floor is still honored.

### Alternatives rejected

| Alternative                                     | Reason rejected                                                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Merge #30, then let Dependabot rebase #31         | `main` would carry a split 1.18.7 / 1.17.18 pair, and #30 alone fails `qualify:opencode`.                  |
| Bump versions without a requalification report    | The qualification identity in `docs/qualification/opencode-driver.md` would silently stop describing reality. |
| Edit the T05 report in place                      | Destroys the evidence trail; the Pi 0.82.1 precedent supersedes instead.                                   |
| Advance to 1.18.9                                 | Untraceable to the pull requests being closed, and it would need its own qualification decision anyway.    |

## Preventing recurrence

Documentation would not have stopped this: the Pi grouping exists precisely
because a split unit already caused it once. The rule goes into
`.github/dependabot.yml` and is asserted by
`tests/agent-readiness/dependency-policy.test.mjs`, alongside a lockfile
assertion that both OpenCode packages resolve to one version — the same pair of
guarantees the Pi runtime already has.
