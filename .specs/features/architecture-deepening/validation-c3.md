# Validation — candidate C3 (ADP-3, driver session ledger and version probe)

Requirement ADP-3: session bookkeeping and version probing are implemented once
for the four drivers, with each driver's error codes and qualified invocation
unchanged.

Two task rows, each on its own branch: T3a (C3-1, the session ledger) on
`refactor/driver-session-ledger`, and T3b (C3-2, the version probe) stacked on
it. This file covers T3a; T3b adds its own section. Base revision `0158e48`.

Sources are named by symbol. Assertions are cited by test file and line: `L` is
`tests/contract/driver-session-ledger.test.mjs` and `M` is
`tests/contract/driver-lifecycle-matrix.test.mjs`. Nothing here was observed
against a real provider session. The provider executables are the repository's
labeled fakes, and Pi runs against its faux provider.

## C3-1 (T3a) — the session ledger

Owning module: `packages/drivers/src/driver-session-ledger.ts`. Consumers:
`claude-code-driver.ts`, `codex-driver.ts`, `opencode-driver.ts` and
`pi-driver.ts` in the same package. `index.ts` is untouched, so
`DeterministicMockDriver` keeps its own bookkeeping and the text
`export interface Driver {` stays where `M:39-45` reads it.

Each driver loses its session map, its closed set, `#emit`, `#terminal` and
`#known` (Pi also `#active`). What stays in each driver is its own: the spawn,
the stream handling, the terminator expression, and every driver-prefixed code.

### Requirement evidence

| Clause | Definition (symbol) | Assertion evidence |
| --- | --- | --- |
| Events are numbered once | `emit` on the session | Frozen, fields kept, numbered from zero: `L:37-48`; an event cannot choose its number: `L:50-54`; two sessions of one ledger are numbered independently: `L:222-237` |
| The sink is called before the sequence increments | `emit` | A sink that throws leaves the number unspent: `L:56-73`; the same for the terminal event: `L:75-96` |
| One terminal event | `terminate` (not reachable from a driver) | On close, with the outcome and no reason: `L:98-106`, `L:108-115`; on cancel, with the reason: `L:127-138`; once only: `L:117-125`, `L:140-152`, `L:154-164` |
| Close | `DriverSessionLedger#close` | Result and final sequence: `L:98-106`; repeated close answers `alreadyClosed`: `L:117-125`; cancel after close is accepted and does nothing: `L:166-178` |
| Session codes and messages unchanged | `#known`, `active` | `VES_DRIVER_SESSION_UNKNOWN` with the driver's noun, from close, cancel and active: `L:193-202`; `VES_DRIVER_SESSION_CLOSED` for a cancelled session and unknown for a closed one: `L:204-211` |
| One ledger per driver instance | `DriverSessionLedger` | A reference opened by another ledger is unknown and does not end the owner's session: `L:213-220` |
| Emission is not gated on the terminal event | `emit` | `L:180-191` |
| Stop hook (Claude Code, Codex, Pi) | `stop` option | Runs and finishes before the terminal event: `L:245-266`; nothing to wait for means the terminal event is emitted in the caller's own turn: `L:268-273`; a failed stop leaves the session open and cancellable: `L:275-289` |
| Close hook for Pi's `unsubscribe` and `reset` | `release` option | After the terminal event, on cancel and again on the first close: `L:291-307`; on a plain close: `L:309-314`; a hook that throws leaves the session known: `L:316-332` |
| Each driver is wired to the ledger | the four drivers | One row per driver in `M`: numbering and close result `M:275-293`; idempotent close `M:295-301`; reference local to one instance, with the driver's own message `M:303-310`; idempotent cancel with its reason `M:312-327`; cancel after close `M:329-335`. The axis is bound to the probe axis's driver set at `M:267-272` |
| Each driver stops its provider on cancel | `stop` wiring in Claude Code, Codex and Pi | `M:338-377`: a running session is cancelled through `cancel()`; the provider is stopped once (`M:368`) and before the terminal event, which carries the cancelled outcome and the reason (`M:372-373`). No test reached `cancel()` on a running session before |

### Behaviour unchanged: the same cases on the hand-written implementations

The session axis of `M` was committed before any driver adopted the ledger, and
it passed against the four hand-written implementations. With the drivers of
`0158e48` in a disposable copy and the tests of this branch, the matrix and the
four driver contract suites pass: 124 passed, 0 failed.

A second comparison ran 18 scenarios through both implementations and compared
the normalized transcripts (session identifiers and the faux provider
identifier replaced by a constant): close and repeated close, cancel and
repeated cancel, a reference used on another instance, `send` before and after
cancel and close, for each driver, and a cancel of a running Claude Code and Pi
session. 88 events and 64 call results; the two transcripts are byte-identical.

### Deleted case → replacement

Nine cases were deleted from the four lifecycle suites. Each asserted ledger
behaviour through one driver. The replacement is the same assertion in the
matrix, on the same driver and fixture, and the behaviour itself in `L`.

| Deleted case (file and line at `0158e48`) | Assertion | Replacement |
| --- | --- | --- |
| `tests/integration/claude-code-driver-lifecycle.test.mjs:42` "Claude close is idempotent and emits one terminal event" | Two closes, one `session.closed` | `M:295-301`, row `claude-code` (also pins the repeated result); `L:117-125` |
| `tests/integration/claude-code-driver-lifecycle.test.mjs:52` "Claude session reference is local to one adapter instance" | Another instance's close is `VES_DRIVER_SESSION_UNKNOWN` | `M:303-310`, row `claude-code` (also pins the message, cancel, and that the owner's session is untouched); `L:213-220` |
| `tests/integration/codex-driver-lifecycle.test.mjs:54` "Codex close is idempotent and emits one terminal event" | as above | `M:295-301`, row `codex`; `L:117-125` |
| `tests/integration/codex-driver-lifecycle.test.mjs:64` "Codex session reference is local to one adapter instance" | as above | `M:303-310`, row `codex`; `L:213-220` |
| `tests/integration/opencode-driver-lifecycle.test.mjs:57` "OpenCode close is idempotent and emits one terminal event" | as above | `M:295-301`, row `opencode`; `L:117-125` |
| `tests/integration/opencode-driver-lifecycle.test.mjs:67` "OpenCode session reference is local to one adapter instance" | as above | `M:303-310`, row `opencode`; `L:213-220` |
| `tests/integration/pi-driver-lifecycle.test.mjs:98` "Pi Driver close is idempotent and emits one terminal event" | as above | `M:295-301`, row `pi`; `L:117-125` |
| `tests/integration/pi-driver-lifecycle.test.mjs:108` "Pi Driver cancellation is idempotent after execution" | Two cancels, one `session.closed`, outcome `cancelled` | `M:312-327`, row `pi` (the whole terminal event, and the close that follows); `L:140-152`, `L:154-164` |
| `tests/integration/pi-driver-lifecycle.test.mjs:119` "Pi Driver rejects a session reference from another adapter instance" | Another instance's close is `VES_DRIVER_SESSION_UNKNOWN` | `M:303-310`, row `pi`; `L:213-220` |

The replacements run under `test:contract`, which `gate:full`, `gate:build` and
`gate:security` include; the deleted cases ran under `test:integration`, which
`gate:security` does not include. No other test was deleted or modified. The
remaining cases of the four lifecycle suites (version refusal before spawn,
abort, handshake, portability, fresh transcript, follow-up) are unchanged.

### Discrimination (disposable copy)

A copy of `packages`, `tests` and `spikes` at the tip of this branch, in an
ignored scratch directory, was mutated one change at a time and restored from
the tracked sources after each run. The tracked sources were never mutated.
Suites run: `L`, `M`, the driver contract suites, the four lifecycle suites,
`tests/integration/driver-execution-adapter.test.mjs`,
`tests/security/opencode-driver-security.test.mjs` and the two mediated Claude
Code spike suites. Unmutated copy: 241 passed, 0 failed.

| Mutation in the copy of the ledger | Failing cases |
| --- | --- |
| **The sequence is incremented before the sink is called** | 2, both in `L`: "the sink sees an event before its sequence number is spent", "a terminal event the sink refuses is not counted as emitted" |
| **Close skips the release hook** | 3 in `L`: the two release-hook cases and "a release hook that throws on close leaves the session known" |
| Cancel skips the release hook | 1 in `L` |
| Release runs before the terminal event on close | 1 in `L` |
| The terminal event is not guarded | 11: the idempotent-cancel row of all four drivers and the running-cancel row of three in `M`, 4 in `L` |
| One ledger shared by every instance | 23: the local-reference row of all four drivers in `M`, 19 in `L` |
| The stop hook is not awaited | 3: the Pi running-cancel row in `M`, 2 in `L` |
| The stop hook is always awaited | 1 in `L`: "a cancel with nothing to wait for emits the terminal event in the caller's own turn" |
| The stop hook runs after the terminal event | 5: the running-cancel row of three drivers in `M`, 2 in `L` |
| Events after the terminal event are dropped | 1 in `L` |
| A closed reference is forgotten | 11: the idempotent-close and cancel-after-close rows of all four drivers in `M`, 3 in `L` |
| Close keeps the session in the map | 1 in `L` |
| The session is forgotten before release | 1 in `L` |
| Cancel does not record the cancelled outcome | 11 across `M` and `L` |
| Cancel drops the reason | 9 across `M` and `L` |
| An unknown session is reported under another code | 8: the local-reference row of all four drivers in `M`, 4 in `L` |
| The noun is not used in the message | 8: the same cases |
| Emitted events are not frozen | 5: the numbering row of all four drivers in `M`, 1 in `L` |

| Mutation in the copy of a driver | Failing cases |
| --- | --- |
| Claude Code gives the ledger no stop hook | 1: "claude-code cancel stops the running provider before it emits the terminal event" |
| Codex gives the ledger no stop hook | 1: the same case for `codex` |
| Pi gives the ledger no stop hook | 1: the same case for `pi` |
| Codex spells another driver's noun | 1: "codex session reference is local to one driver instance" |
| OpenCode numbers one event itself | 3: two `opencode` rows in `M` and "OpenCode Driver emits common ordered Qwen lifecycle and reasoning usage" |
| Claude Code keeps the child after the run | 1: "claude-code cancellation after execution is idempotent and closes once with its reason" |
| **Pi gives the ledger no release hook** | **none** |

The last row is a gap this change does not close. Once a Pi session has ended,
nothing reachable through the `Driver` interface observes the agent, so no
driver-level test can tell whether it was unsubscribed and reset. The same
deletion in the hand-written `PiDriver` at `0158e48` fails no test either. What
this change adds is the proof at the ledger's interface that the hook runs
(`L:291-332`).

### Guardrails

- Complexity baseline: no entry changed, no key added or moved
  (`pnpm complexity:update` rewrites `complexity-baseline.json` to the same
  bytes). The hotspots of the drivers keep their keys and values, among them
  `claude-code-driver.ts :: Async method 'start'` 24 and
  `codex-driver.ts :: Async method 'start'` 27.
- Census: no file gained or lost `JSON.stringify` or `createHash`; the census
  entries of `packages/drivers/src/index.ts` and `opencode-driver.ts` keep their
  counts, and the new module has neither.
- Citations fixed, one per adopting commit:
  `.specs/features/live-task-pilot/validation.md` (Claude Code and Codex
  minimums, the same-major comparison),
  `.specs/features/platform-qualification-matrix/matrix.md` (the four pin
  locations; the Codex one was already stale),
  `.specs/features/pi-runtime-0-87-1/validation.md` and
  `.specs/features/dependency-refresh-2026-07/validation.md` (already stale).
  The finding row M-4 of `matrix.md` cites the lines the defect had before it
  was fixed and is left as it is. The session axis and its helper are appended
  to `M`, so the existing citations of `M:132-142` and `M:136` do not move.
- No file under `docs/qualification/` changed. The digest-bound reports of
  `credential-store.ts` are untouched.
- Migration count (12) and runtime error catalog count (19) unchanged. No
  public error code or message was added, removed or changed.

### Gates (Node 24.14.0, macOS arm64)

Each row was measured on a detached checkout of exactly that commit.

| Commit | `pnpm gate:quick` | `pnpm test:architecture` | Driver suites (`node --test tests/contract/*driver*.test.mjs tests/integration/*driver*.test.mjs tests/security/opencode-driver-security.test.mjs`) |
| --- | --- | --- | --- |
| `0158e48` (base) | PASS — unit 2395, agent-readiness 323, census 13 | PASS — 69 | PASS — 197 |
| `b94c4aa` the ledger and its contract suite | PASS — 2395, 323, 13 | PASS — 69 | PASS — 222 |
| `9154631` the matrix's session axis, on the hand-written drivers | PASS — 2395, 323, 13 | PASS — 69 | PASS — 246 |
| `98cefe4` Claude Code adopts the ledger | PASS — 2395, 323, 13 | PASS — 69 | PASS — 246 |
| `ef57b3e` Codex adopts the ledger | PASS — 2395, 323, 13 | PASS — 69 | PASS — 246 |
| `877f42c` OpenCode adopts the ledger | PASS — 2395, 323, 13 | PASS — 69 | PASS — 246 |
| `14a7f28` Pi adopts the ledger | PASS — 2395, 323, 13 | PASS — 69 | PASS — 246 |
| `2a49b36` the nine per-driver cases retired | PASS — 2395, 323, 13 | PASS — 69 | PASS — 237 |

At the last code commit of the branch:

| Command (at `2a49b36`) | Result |
| --- | --- |
| `pnpm gate:build` | PASS — unit 2395, contract 722, integration 853, e2e 236, architecture 69, build 146, qualification 296 |
| `pnpm gate:security` | PASS — unit 2395, contract 722, e2e 236, architecture 69, qualification 296, security 1339, fault 310 |
| `pnpm test:qualification` | PASS — 296 |
| `pnpm test:contract` | PASS — 722 |
| `pnpm test:integration` | PASS — 853 |
| `pnpm test:fault` | PASS — 310 |
| `pnpm qualify:claude` | PASS — 53 |
| `pnpm qualify:codex` | PASS — 20 |
| `pnpm qualify:opencode` | PASS — 18 |
| `pnpm qualify:pi` | PASS — 12 |
| `pnpm agent:check` | PASS |

The commit that adds this file and the decision entry changes nothing outside
`.specs`; `pnpm gate:quick` (unit 2395, agent-readiness 323, census 13) and
`pnpm agent:check` pass on it.

No test was skipped in any stage. The `qualify:*` scripts and
`test:qualification` start no provider session and need no login: they run the
labeled fakes, and probe an installed CLI only with `--version`, `--help` and
`codex login status` in a disposable directory. `qualify:keychain` was not run.

### Open points for the reviewer

- **Parametrisation.** The ledger takes the driver's noun and no error-code
  prefix, because every session code is already shared. The decision and its
  alternatives are in `.specs/STATE.md` (the ADP-3 session ledger entry).
- **A session cancelled while it runs.** On `0158e48` and on this branch alike,
  `cancel()` on a running Claude Code or Pi session emits `session.closed` with
  `cancelled`, then the run reports an error event after it, and `close` reports
  `failed`. The ledger preserves it (`L:180-191`). Whether a cancelled run
  should report anything after its terminal event belongs to the session runner
  (ADP-4).
- **Platform matrix.** Every result above is from macOS arm64. The change has no
  platform-specific code, but the drivers are on the list that requires a
  `platform-matrix.yml` run on the branch before merge.
