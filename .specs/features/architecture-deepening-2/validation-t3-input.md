# Validation T3 fix — an input that fails after the provider finished

A fix to T3 (ADR2-3, AD-060), on `fix/provider-input-after-result` from `main`
at `2651fa0`. `P` is `packages/drivers/src/provider-child-run.ts` and `I` is
`tests/integration/provider-child-run.test.mjs`, both at this branch's fix
commit.

## 1. The failure

The platform matrix of another branch (run 37127145070, build gate) failed
`I:130` on macOS x64 only: "a provider that exits by itself after its result
ends the run with no error, and nothing ends it" ended as
`{ errors: [VES_FAKE_STDIN_FAILED], outcome: "failed", terminations: 1 }`.

## 2. The cause

Reproduced on macOS arm64: `I:130` alone, six suites in parallel, ten times
each, failed 4 of 60 runs. With the run instrumented in a disposable copy,
every failing run showed the same order:

1. The write of the conversation's frame failed with `EPIPE`, its callback
   arriving one or two milliseconds after the write.
2. The input stream's `error` followed, while the result line had not been
   read (`result=false`) and the exit had not been seen (`exitCode=null`).
3. The run took the error as its first end: `…_STDIN_FAILED`, and the
   terminator asked to end the provider.

The frame is written synchronously right after the spawn; Node's libuv takes
a 13-byte frame at once (measured: `kLastWriteWasAsync=0` on 50 of 50
spawns), and a first write to a provider that is alive never failed (480
spawns under the same load). The `EPIPE` therefore means the provider had
already exited when the write ran: the host descheduled the run between the
spawn and the write long enough for the fake to start, write its result and
exit. Its result and its exit were then waiting in the event loop, behind the
failed write. This is not a write after the result: the only write is the
first one. It is a failed write weighed before what the provider had already
done.

The rule predates the module: on `7e10272` both drivers failed a run on any
error of the input stream (`claude-code-driver.ts:570-574`,
`codex-driver.ts:258-260`), and the provider-ends fix (AD-054) made the
failure end the provider too.

## 3. The fix

`P`: an error of the input stream is weighed once the output and the exit
that were already waiting have been read, after at least one poll phase of
the event loop (`afterPendingEvents`, two immediates in a row; one is not
enough when the run is spawned from a poll-phase callback, as the driver's
start is after its probe). It then fails the run only if no end came first,
the result has not arrived, and the provider still runs (`#inputFailed`).
The first end still decides (AD-060), and D3's exit rule is unchanged.

What does not change: a provider that closes its input and keeps running
without its result (`deaf`) is `…_STDIN_FAILED` and ended once.

## 4. Codex

The Codex driver shared the rule through the module; no Codex completion can
meet the order. Its first write is `initialize`, before which an App Server
answers nothing, and every later write is a request or an answer the App
Server waits for before its turn completes; after `turn/completed` the driver
writes nothing (its interrupt requires a stop that came first and a provider
not being ended). The one Codex-visible change: an App Server that dies
before the first write is always `VES_CODEX_PROTOCOL_FAILED`, the failure its
pending `initialize` meets, where a loaded host could report
`VES_CODEX_STDIN_FAILED`. The Codex reports state nothing this corrects, so
no Codex report is added.

## 5. Evidence

| Clause | Assertion evidence |
| --- | --- |
| A provider that delivers its result and exits before the first write completes, both profiles | `I`, the cases "… delivers its result and exits before the first write completes", started from a poll-phase callback with the conversation blocked until the provider has exited |
| A provider that dies before the first write is reported by its exit | `I`, "… dies before the first write is reported by its exit", both profiles |
| An input that fails after the result changes nothing | `I`, "… an input that fails after the result changes nothing", both profiles (on win32 the fake cannot close its input, and the same outcome is asserted) |
| Through the driver | `spikes/claude-code-driver/test/claude-driver-input-failure.test.mjs` under `pnpm qualify:claude`: the `hasty` fake, blocked by the spawn observer until it has exited, ends `completed` with no termination |
| `deaf` unchanged | `I:298-324`, the lifecycle matrix row, and the provider-ends qualification suite, unmodified |
| A late termination is counted | `I`'s `ended()` now waits 50 ms after the run before it reads how often the terminator was asked |

Discrimination, in a disposable copy restored after each run, suites `I`, the
lifecycle matrix, and the two Claude Code qualification suites named above:

| Mutation | Failing cases |
| --- | --- |
| The module of `main` | 6 of `I` (the new cases) and the new driver case |
| The input failure is weighed at once (no deferral) | 5: the four before-the-first-write cases and the driver case |
| One immediate instead of two | 5: the same; the driver case alone fails about half the runs, the cases started from a poll-phase callback every run |
| The result is not checked | 2: the two after-the-result cases |
| The exit is not checked | 2: the two died-before-the-first-write cases |

Two runs of the table gave the same rows. Load: `I:130` repeated 180 times
under parallel load failed 3 times with the module of `main` and never with
the fix. Transcripts: the 92 scenarios of T3 (49 Claude Code, 43 Codex)
recorded against the drivers of `main` and of this branch are byte-identical,
on macOS and with Windows forced.

## 6. Requalification

`docs/qualification/claude-code-driver-input-failure.md` corrects, without
editing them, the statement of `claude-code-driver-child-run.md` and
`claude-code-driver-provider-ends.md` that the driver ends nothing at a
normal end. No existing report is edited; no Codex report is added (section
4).

## 7. Guardrails

The complexity of `P` stays under the target (no new hotspot); no census
signal; no error code, message or migration changed. `I` grew at its end and
`ended()` kept its line count, so every line of `I` that earlier evidence
cites, `I:130` among them, is where it was.

## 8. Gates (Node 24.14.0, macOS arm64)

Run one after another on the branch's tree:

| Command | Result |
| --- | --- |
| Focused: `I`, the lifecycle matrix, the process-tree, driver contract, lifecycle and runner-driver suites | PASS — 204 |
| `pnpm gate:quick` | PASS — unit 2625, agent-readiness 331, census 13 |
| `pnpm test:architecture` | PASS — 113 |
| `pnpm test:integration` | PASS — 1102 |
| `pnpm test:qualification` | PASS — 338 |
| `pnpm qualify:claude` | PASS — 72 |
| `pnpm qualify:codex` | PASS — 34 |
| `pnpm gate:security` | PASS — unit 2625, contract 797, e2e 275, architecture 113, qualification 338, security 1324, fault 310 |
| `pnpm agent:check` | PASS |

No test was skipped, no provider session was started, and `qualify:keychain`
was not run.
