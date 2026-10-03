# Validation T3 — one provider child run for Claude Code and Codex

Task T3 of the second architecture deepening round (ADR2-3): the spawn, byte
budget, line framing, stop and end-of-run rule that the Claude Code and Codex
drivers repeat live in one module of `packages/drivers`, and each driver keeps
only its protocol translation. Source: the architecture review of `main` at
`9eb2881`, card 4. That card was written before #476 and #477 merged, which
already moved every Codex end through the tree termination and fixed the
cancel order; the comparison below is read again from the code on `main` at
`7e10272`.

`C` is `packages/drivers/src/claude-code-driver.ts` and `X` is
`packages/drivers/src/codex-driver.ts`, both at `7e10272`.

## 1. The two drivers' child handling on `main`

Each row is one band of how a driver runs its provider child. The verdict
says whether a difference is **protocol** (it follows from what the provider
speaks, and stays in the driver), **drift** (two copies of one rule that no
longer agree, and it moves to one rule), or **same** (the copies agree, and
the rule moves to the module unchanged).

### Spawn

| Point | Claude Code | Codex | Verdict |
| --- | --- | --- | --- |
| Call | `spawn(command, arguments, { cwd, env, stdio: pipe ×3, detached: OWN_PROCESS_GROUP, windowsHide: true })`, `C:530-536` | the same options, `X:184-190` | same |
| Process group | own group off win32 through `OWN_PROCESS_GROUP` | the same | same |
| Arguments | T03, mediated or subscription invocation, `C:381-475` | `app-server --listen stdio://`, `X:129-131` | protocol |
| Environment | `SAFE_ENV_KEYS` (7 names) and the explicit values, or the mediated profile's own; removes `CLAUDE_CODE_SESSION` and `CLAUDE_SESSION_ID` by their exact spelling, `C:370-377` | `SAFE_ENV_KEYS` plus `CODEX_HOME`, or the process context; removes `CODEX_THREAD_ID` and `CODEX_TURN_ID` in any letter case, `X:114-127` | protocol for what is passed; the letter case of the removal is drift in environment construction (below, D6) |
| Working directory | the caller's directory (T03), the worktree (mediated) or an empty per-run directory (subscription), `C:698-708`, `:749`, `:776` | the process context's, else the caller's, `X:133-135` | protocol (an input to the child run) |
| Run bracket and spawn | `runStarted` before the spawn, `C:526-530` | the spawn before `runStarted`, `X:184-191` | drift, unobservable: the two orders differ only when `spawn` throws synchronously, and then `start` rejects and no session reference reaches a caller (D4) |
| Spawn observer | `onSpawn(pid)` after the stop is wired, only with a process id, `C:550-554` | the same, `X:203-210` | same |
| Session resources | `child` and `stop`; `child` is never read, `C:537` | the same, `X:192` | same; `child` is dead and goes |
| A spawn that fails | no `error` listener on the child | no `error` listener on the child | same, and a shared hazard (H2) |

### Byte budget

| Point | Claude Code | Codex | Verdict |
| --- | --- | --- | --- |
| Limit | `maxOutputBytes ?? 1_048_576`, `C:556` | the same, `X:223` | same |
| What counts | every error-stream chunk, `C:561-567`; every output line plus one byte, `C:577-578` | the same, `X:254-257`, `:263` | same |
| A line past the limit | recorded as `…_OUTPUT_LIMIT` and not parsed, `C:578-582` | the same, `X:264` | same (the recording rule is D1) |
| Validation of the limit | at least 1, else `VES_CLAUDE_OUTPUT_LIMIT_INVALID`, `C:516-520` | at least 0, else `VES_CODEX_LIMIT_INVALID`, `X:452-454` | input validation with its own codes before the run; stays per driver (D7) |

### Line and JSON framing

| Point | Claude Code | Codex | Verdict |
| --- | --- | --- | --- |
| Framing | `readline` over the output, `crlfDelay: Infinity`, `C:575` | the same, `X:261` | same |
| Parse | `JSON.parse`; a line that does not parse is `VES_CLAUDE_STREAM_INVALID`, `C:332-340` | the same with `VES_CODEX_STREAM_INVALID`, `X:265-270` | same |
| A line that parses to something other than an object | `null` reaches `event["type"]` and throws in the line listener, which ends the host process; a number, string, boolean or array is ignored | `null` reaches `message["id"]` and throws the same way | same, and a shared hazard (H1) |
| After a failure | every later line is still translated, so a provider's last words reach the sink before the run's error | the same | same; the cancel order suites pin it (`content.delta` after a broken stream) |
| Input frames | one frame, then the input is closed: `stdin.end`, `C:658` | many frames, the input is never closed: `stdin.write`, `X:233-236` | protocol; the newline that ends a frame is framing (same) |

### Failures and stops

| Point | Claude Code | Codex | Verdict |
| --- | --- | --- | --- |
| A stream failure | sets `streamFailure` to its code each time, so the **last** failure is reported, `C:564`, `:579`, `:585`, `:592`, `:615`, `:638` | `fail` keeps the **first** failure, `X:243-248` | drift (D1) |
| A stream failure after a stop | replaces the stop's report: the run reports the failure and the session ends `failed`, `C:664-679` | the stop stands: the run reports `VES_CODEX_ABORTED`, because the stop marked the run first, `X:199-201`, `:401-403` | drift (D1) |
| A stop after a stream failure | the failure stands, `C:672-679` | the failure stands, `X:199-201` | same |
| How a failure ends the provider | `endChild`: the single tree termination, not awaited and contained, for every failing line, `C:549` | `endChild` once, from the first failure, `X:214-219`, `:247` | same termination; asked once or per line (a failed termination is retried by the next failing line in Claude Code only), folded into D1 |
| An input failure | ignored once a stop or a failure was recorded (a failure also sets `aborted`), else `VES_CLAUDE_STDIN_FAILED`, `C:570-574` | ignored after a stop, else `fail("VES_CODEX_STDIN_FAILED")`, `X:258-260` | same under the first-end rule |
| A protocol failure | none: the conversation is one write | a conversation that rejects records `VES_CODEX_PROTOCOL_FAILED` unless a stop or failure came first, and does not itself end the provider, `X:393-395` | protocol (only Codex converses); the recording rule is D1's |
| A stop (cancel) | marks the run and awaits the single termination, `C:545-548`, `:552` | marks the run unless a failure came first, and returns the single termination, `X:199-208` | same under the first-end rule |
| The start signal | the same stop at once, `C:560` | marks the run, sends `turn/interrupt` once the turn is known, and stops after `cancelGraceMs` if the provider still runs, `X:362-371`, `:249-253` | protocol: only the App Server has an interrupt; the grace period is a parameter of the stop |
| A stop that no caller awaits | the start signal's stop is an `async` listener; a termination that rejects there is unhandled, `C:560` | the grace timer calls `void state.resources.stop?.()`; the same, `X:367` | same, and inconsistent with AD-054 item 2 (D5) |
| A start signal aborted while the probe or the resolution is awaited | the listener is added to a signal that has already aborted and never runs, `C:497`, `:560` | the same, `X:169`, `:371` | same, shared hazard (H3); the session runner cancels the session once it is announced |

### End of the run

| Point | Claude Code | Codex | Verdict |
| --- | --- | --- | --- |
| What the run waits for | the child's `close`, `C:659-661` | its turn's result, the first failure, or `close`; then it ends a provider that still runs, then waits for `close`, `X:231`, `:350`, `:353-361`, `:392`, `:396-397` | protocol: print mode exits by itself after its result; the App Server keeps serving until it is ended (AD-054 items 1 and 4) |
| A stop first | `VES_CLAUDE_ABORTED`, `cancelled`, "Claude Code was aborted", retryable, `C:664-671` | `VES_CODEX_ABORTED`, "Codex was aborted", `X:401-403` | same |
| A failure first | its code, `failed`, "Claude Code stream failed", not retryable, `C:672-679` | its code, "Codex protocol failed", `X:404-406` | same rule; the message names what failed (protocol, per driver) |
| No result | `VES_CLAUDE_STREAM_INCOMPLETE` whatever the exit, `C:680-687` | `VES_CODEX_PROCESS_FAILED` for a non-zero code or a signal, `VES_CODEX_STREAM_INCOMPLETE` for a zero exit, `X:407-414` | drift (D2) |
| A result without the session's announcement | `VES_CLAUDE_PROCESS_FAILED` whatever the exit (`!initialized`), `C:680-687` | not checked at the end: the announcement is the thread the conversation started, whose absence is a protocol failure, `X:383-385` | protocol for what counts as a result; the code is D2's |
| Exit after a result | anything but zero is `VES_CLAUDE_PROCESS_FAILED`, `C:680-687` | ignored, `X:407` | protocol: kept as one parameter of the end rule (D3) |
| After the report | resources removed, the run's bracket ended, the isolation directory removed, `C:689-694` | the bracket ended, resources removed, `X:417-420` | same (the isolation directory is Claude Code's) |

### Windows

| Point | Claude Code | Codex | Verdict |
| --- | --- | --- | --- |
| Process group | none (`OWN_PROCESS_GROUP` is false) | the same | same |
| Fallback terminator | signals the one process, inside a `try` (`driver-process-tree.ts`) | the same | same |
| Second kill of an exited process | one termination per child (`singleTermination`) | the same | same |
| A provider that does not read its input | a write that never fails; nothing ends the session but a stop (AD-054) | the same; Codex writes small frames and never closes its input | same |
| Mediated profiles | refused at construction, `C:216-221` | — | protocol (not the child run) |
| Environment | — | the process context fills Windows defaults and folds names to upper case (`codex-process-context.ts`) | protocol (not the child run) |
| Exit after a termination | a terminated process exits with code 1 and no signal | the same | same; no report reads that exit (a stop or failure comes first, and Codex ignores the exit after a result) |

### The drift list

- **D1 — the first end of a run decides its report.** Codex keeps the first of
  a stop and a stream failure. Claude Code reports the last stream failure,
  and a failure that follows a stop replaces the stop's report, so a cancel
  whose provider leaves a partial line in the pipe is reported as a broken
  stream. AD-053 item 4 states the rule Codex follows ("a failure a provider
  reports after the stop does not turn the stop into a failure"). One rule:
  the first end decides; every later failure still asks for the one
  termination.
- **D2 — a run that ended before its result.** Codex reports
  `…_PROCESS_FAILED` when the provider ended with a non-zero code or a
  signal, and `…_STREAM_INCOMPLETE` when it exited zero. Claude Code reports
  `…_STREAM_INCOMPLETE` whatever the exit, and `…_PROCESS_FAILED` for a result
  that came before the session was announced. Both qualified spikes read the
  exit first (`spikes/claude-code-driver/src/claude-code-driver.mjs:230-235`,
  `spikes/codex-driver/src/codex-driver.mjs:312-313`). One rule: the Codex
  one, and a result counts only once the session was announced, which is
  each protocol's own reading.
- **D3 — the exit after a result.** Claude Code fails a non-zero exit after its
  result; Codex ignores it. This is not drift. A print-mode provider ends by
  itself and its exit status is part of its result; the App Server is ended
  by the driver (AD-054 kills it), so the status that follows says how the
  driver ended it, and on Windows a terminated process exits with code 1.
  Kept as one parameter of the end rule, which also decides whether the
  driver ends the provider once its run has ended.
- **D4 — the run bracket and the spawn.** One order: the bracket opens before
  the spawn, as the session ledger's contract asks ("before that run's
  provider can be stopped"). Not observable.
- **D5 — a stop no caller awaits.** Both the start signal's stop and the Codex
  grace timer leave a termination that rejects unhandled, while every other
  unawaited end is contained (AD-054 item 2). One form: contained. The task
  composition's terminator never rejects, so no composition changes.
- **D6 — the letter case of the removed session variables.** Claude Code
  removes its two names as spelled, Codex in any letter case. This is
  environment construction, not the child run, and each list is the
  provider's own. Recorded and left as it is: the explicit values come from
  the composition alone, which supplies only the credential.
- **D7 — the floor of the output limit.** Claude Code refuses 0, Codex admits
  it. Input validation with each driver's own refusal code, before the run.
  Recorded and left as it is.

### Shared hazards (the two copies agree, and both are wrong)

- **H1 — a line that is JSON `null` ends the host process.** Observed on
  `7e10272`: a fake provider that writes `null` makes both drivers throw
  `TypeError` inside the line listener ("Cannot read properties of null
  (reading 'type')" for Claude Code, "(reading 'id')" for Codex), which is an
  uncaught exception.
- **H2 — a spawn that fails ends the host process.** Neither driver listens for
  the child's `error` event. Observed with Node 24.14.0: a spawn of a missing
  executable with no listener is an uncaught `ENOENT`; with a listener the
  child closes with code `-2`. The probe runs first, so this needs the
  executable to go between the probe and the spawn, or `EACCES` or `EAGAIN`.
- **H3 — a start signal aborted during the probe or the resolution is not
  noticed by the run** (the table above). The session runner cancels the
  session once the provider announces it, so no composition loses the stop.
  Recorded and left as it is: noticing it in the run would stop a provider
  before its session is announced, which changes the cancel order sequences
  of AD-053.

## 2. Commits

| Commit | What |
| --- | --- |
| `32802ce` | Section 1 of this file, before any source changed |
| `9f3b04e` | H1, in both drivers: a line that parses to something other than an object is the driver's `…_STREAM_INVALID` |
| `6d42e0a` | The module, both drivers on it, D1, D2, D4 and D5, and the tests |
| `2ecf087` | H2, in the module: a spawn that fails ends the run as a failed process |
| `968c322` | Two comments corrected; no code changed |
| this commit | This evidence and the decision entry in `.specs/STATE.md` |

## 3. The module

`packages/drivers/src/provider-child-run.ts` (`P` below, at `2ecf087`) runs one
provider child to its end; `runProviderChild` (`P:335`) is its interface.

| Knowledge | Before (on `7e10272`) | Now |
| --- | --- | --- |
| Spawn in a process group of its own | each driver, `C:530-536`, `X:184-190` | `P:153-159` |
| A spawn that fails | nowhere: an unheard `error` event | `P:164` |
| Output limit and its default | each driver, `C:556-582`, `X:223`, `:254-264` | `P:14`, `P:228-241` |
| One JSON object per line | each driver, `C:332-340`, `X:265-270` | `P:118-128`, `P:228-233` |
| One frame per line | each driver's write | the channel, `P:210-226` |
| Input failure | each driver, `C:570-574`, `X:258-260` | `P:244-246` |
| The first end decides | Codex only (`X:199-201`, `:243-248`) | `P:248-266` |
| The stop: one termination per child, marks the run | each driver, `C:540-554`, `X:195-219` | `P:197-208` |
| The start signal, grace period and interrupt | each driver, `C:560`, `X:362-371` | `P:275-290` |
| Ending a provider after its run | Codex, `X:396` | `P:181-193`, by the profile |
| The end-of-run rule | each driver, `C:664-688`, `X:400-415` | `P:292-328` |
| The run bracket and the withdrawn stop | each driver, `C:526`, `:689-693`, `X:191`, `:417-420` | `P:335-343` |

What each driver keeps (at `2ecf087`): the Claude Code profile and the codes it
reports (`claude-code-driver.ts:149-160`), the stream-json translation
`claudeProtocol` (`:355-426`): the hook check of the bridge-only surface, the
`init` check, deltas, tool requests, the result and its usage, and the one
frame of its conversation. The Codex profile (`codex-driver.ts:85-95`) and
`codexProtocol` (`:110-242`): JSON-RPC requests and their answers, the
handshake, model check, thread and turn, dynamic tools, approvals, the
interrupt, and the rejection of pending requests when the provider is gone.
Environment, working directory, arguments, validation, the probe and the
mediated launch are unchanged. `claude-code-driver.ts` went from 800 to 739
lines, `codex-driver.ts` from 456 to 396; the module has 343.

There is no base class. The module is a function that takes a profile, a
launch, the session, the start signal, the injected terminator and a
protocol factory; a protocol reaches its child only through the channel
`P:50-61`.

## 4. The end-of-run rule, decided

| Rule | Decision | Reason |
| --- | --- | --- |
| D1, the first end | One rule, Codex's: the first stop or failure decides | AD-053 item 4; a partial last line after a cancel turned a Claude Code stop into a failure |
| D2, no result | One rule, Codex's and both spikes': `…_PROCESS_FAILED` for a non-zero exit or a signal, `…_STREAM_INCOMPLETE` for a clean exit | No protocol reads a crash as an incomplete stream; Claude Code's exit is part of its result (AD-054 item 4) before the result as after it |
| What counts as the result | Per driver: `turn/completed`; a Claude Code `result` once `init` announced the session | Protocol |
| D3, the exit after a result | **Kept as one parameter**, `afterResult`: `exits-by-itself` (Claude Code) reads it, `ended-by-the-driver` (Codex) does not, and ends the provider once its run has settled | The App Server is killed at the end of every turn (AD-054); its exit then says how the driver ended it, `SIGKILL` on POSIX and code 1 on Windows. Reading it turns every completed Codex session into a failure: the discrimination row "the exit after a result is read for every provider" fails eight cases, four of them ordinary completed Codex sessions of the lifecycle matrix |
| D5, an end no caller awaits | Contained, the start signal's stop included | AD-054 item 2 |

## 5. Transcript identity

Technique, as in the first round (`validation-c3.md`): a recorder outside the
repository (an ignored scratch directory) runs each scenario through the
Claude Code and Codex drivers of a given source tree, one scenario per Node
process, and writes one normalized JSON line per scenario: every event in
order with every field and its key order, the result of `close`, a rejection
of `start` with its code and message, an uncaught exception, how often the
injected terminator and the spawn observer were called, what a stop
resolved to, every Codex message sent (`onMessageSent`), and the session
runner's result where a case goes through it. Session identifiers and
temporary roots are replaced by constants. The same recorder ran against the
sources of `7e10272` (`main`), of `9f3b04e` and of the tip, with the fakes and
fixtures of the tip (the fakes only gained modes).

92 scenarios per run, 49 for Claude Code and 43 for Codex:

- **Normal end:** success, a tool request, redaction, a CRLF stream, the T03,
  mediated and subscription invocations (arguments, working directory,
  environment and process group read back by a scripted fake), a Codex
  process context, the session runner to completion, send and close; Codex
  also a declared tool, a declined approval, a turn that completes and keeps
  running, and one that completes and exits 1.
- **Stream failure:** a line that is not JSON, an invalid tool request,
  invalid usage, a model mismatch at `init`, a broken stream that stays alive
  (with and without an injected terminator), a partial last line, the
  mediated surface failures (an extra tool, a bridge that is down, a hook
  event, a second MCP server), and an undeclared Codex tool.
- **Protocol failure:** a model absent from the catalog, and an App Server
  that exits before `initialize`. **Execution failure:** an `is_error` result
  and a failed turn.
- **Output limit:** on the output stream, on the error stream, a stream that
  keeps failing, a limit of 0 (Codex).
- **Input failure:** a provider that closes its input before its 2 MiB prompt
  is read.
- **Cancel:** a cancel, the start signal alone, the session runner's stop
  (signal, then cancel), the fallback terminator, a terminator that fails a
  second request, a cancel after a broken stream, the mediated profile, and a
  Codex grace period of 400 ms.
- **Refusals before the spawn:** a pre-aborted start, identity, limit, toolset
  and version refusals.
- **Process ends without a result:** a clean exit, a non-zero exit, a kill;
  a result before `init`; two failures; a failure after a stop; a line that
  is `null`; lines that are a number, a string, an array and a boolean; a
  spawn that fails.
- **Windows, forced on POSIX:** all 92 again with `process.platform` set to
  `win32` before the drivers load: no process group (the scripted fake reads
  its group back as the caller's), the fallback terminator signals the one
  process, the mediated profiles are refused at construction, and the Codex
  process context fills its Windows defaults and folds names to upper case.

One field is a race on `main` as on the branch and is compared without it: a
cancel that lands before `turn/start` is answered makes the Codex run send
`turn/interrupt` when the answer arrives, so in four cancel scenarios that
message is present in some runs and absent in others. Three runs on `main`
were otherwise byte-identical.

| From → to | POSIX | Windows forced |
| --- | --- | --- |
| `main` → `main` (three runs) | 92 of 92 identical | 92 of 92 identical |
| `main` → `9f3b04e` (H1) | 88 identical, 336 events; 4 differ: `null-line` and `primitive-lines` of both drivers | the same 4 |
| `9f3b04e` → `6d42e0a` (the module, D1, D2) | 87 identical, 333 events; 5 differ, all Claude Code: the D1 and D2 rows below | the same 5 |
| `6d42e0a` → `2ecf087` (H2) | 90 identical, 354 events; 2 differ: `spawn-fails` of both drivers | the same 2 |
| `main` → `2ecf087` | 81 identical, 315 events; 11 differ, listed below | the same 11, 287 events identical |

**Codex: 40 of its 43 scenarios are byte-identical between `main` and the
tip, on POSIX and with Windows forced; every normal end, stream failure,
protocol failure, output limit and cancel is among them.** **Claude Code: 41 of
49.** Every difference:

| Scenario | `main` | Tip | Why |
| --- | --- | --- | --- |
| Claude Code, exits 3 before its result | `VES_CLAUDE_STREAM_INCOMPLETE` | `VES_CLAUDE_PROCESS_FAILED` | D2 |
| Claude Code, killed before its result | `VES_CLAUDE_STREAM_INCOMPLETE` | `VES_CLAUDE_PROCESS_FAILED` | D2 |
| Claude Code, a result before `init`, exits 0 | `VES_CLAUDE_PROCESS_FAILED` | `VES_CLAUDE_STREAM_INCOMPLETE` | D2 (the same result, exit 2: `PROCESS_FAILED` on both) |
| Claude Code, a broken line, then a line past the limit | `VES_CLAUDE_OUTPUT_LIMIT` | `VES_CLAUDE_STREAM_INVALID` | D1 |
| Claude Code, a broken line after a cancel | `VES_CLAUDE_STREAM_INVALID`, closes `failed` | `VES_CLAUDE_ABORTED`, closes `cancelled` | D1; Codex already did this on `main` |
| Claude Code, a line `null` | the host process ends: `TypeError: Cannot read properties of null (reading 'type')` | `VES_CLAUDE_STREAM_INVALID`, one termination | H1 |
| Claude Code, lines `5`, `"text"`, `[1]`, `true`, then a result | error code `text`, "Claude Code stream failed" | `VES_CLAUDE_STREAM_INVALID` | H1: the string was taken for the code |
| Claude Code, the executable gone at the spawn | the host process ends: uncaught `spawn … ENOENT` | `VES_CLAUDE_PROCESS_FAILED`, no spawn observed | H2 |
| Codex, a line `null` | the host process ends: `(reading 'id')` | `VES_CODEX_STREAM_INVALID`, one termination | H1 |
| Codex, lines `5`, `"text"`, `[1]`, `true`, then a completed turn | ignored, closes `completed` | `VES_CODEX_STREAM_INVALID`, closes `failed` | H1 |
| Codex, the executable gone at the spawn | the host process ends | `VES_CODEX_PROTOCOL_FAILED`: the close rejects the pending `initialize` | H2 |

No message changed and no code was added anywhere: every code in the tip
column was already the driver's.

## 6. Requalification

None of the pinned qualification sequences changed: the T03 and T04 suites,
the mediated and subscription suites, and the process-tree, cancel order and
provider-ends suites pass unmodified, their fakes having gained modes only.

The runs that did change were pinned by no suite, and both drivers are
requalified for them in a commit of their own (the review decided a
behaviour change in edge runs of a qualified driver gets a report):
`docs/qualification/claude-code-driver-child-run.md` (D1, D2, H1, H2) and
`docs/qualification/codex-driver-child-run.md` (H1, which turns a completed
Codex session with a non-object line into a failure, and H2). Each is bound
like the first round's reports, by a suite under its driver's `qualify:*`
script that pins the changed sequences whole through the close:
`spikes/claude-code-driver/test/claude-driver-child-run.test.mjs` (6 cases)
and `spikes/codex-driver/test/codex-driver-child-run.test.mjs` (2), over the
shared contract `tests/helpers/driver-child-run-fixture.mjs`. Against the
drivers of `main` all eight fail, each with the "before" sequence its report
gives. The fakes gain `broken-then-flood`, `late-garble`, `code-line` (Claude
Code) and `primitive-lines` (Codex). No existing report is edited.

## 7. Tests

`I` is `tests/integration/provider-child-run.test.mjs`, `M` is
`tests/contract/driver-lifecycle-matrix.test.mjs` and `A` is
`tests/architecture/provider-process-tree-termination.test.mjs`, at
`2ecf087`.

### Requirement evidence

| Clause | Definition | Assertion evidence |
| --- | --- | --- |
| Spawn in a process group of its own | `P:153-159` | `I:609-628` (POSIX: the provider leads its group, not the caller's; win32: no group); `A:44-49` |
| One termination per child, whoever asks | `P:197-208` | Signal and cancel in one turn ask once: `I:511-529`; a failed cancel leaves the session open and a later one tries again: `I:531-554`; a stream that keeps failing asks once: `I:328-339` |
| Byte budget | `P:14`, `P:235-241` | A line past the limit is not received and ends the provider once: `I:239-252`; output and error stream share the limit: `I:254-265`; the default is 1 MiB with the line ending: `I:267-277` |
| Line and JSON framing | `P:118-128`, `P:228-233` | Not JSON: `I:193-199`; `null`, a string, a number, a boolean, an array: `I:201-216`; order, CRLF, lines after a failure: `I:219-229`; a last line without an ending: `I:231-235`; frames one per line and the last closes the input: `I:281-293` |
| Input failure | `P:244-246` | `I:298-324` (POSIX: `…_STDIN_FAILED`, ended once; win32: nothing ends the run, a stop does) |
| The first end decides | `P:248-266` | `I:328-339`, `I:341-358`, `I:360-376`, `I:407-420` |
| One end-of-run rule | `P:292-328` | Exits by itself after its result: `I:130-140`, and its exit counts: `I:142-148`; ended by the driver, exit not read: `I:150-160`, `I:164-169`; no result, both profiles, clean exit, non-zero exit, kill: `I:171-187`; protocol failure: `I:378-397`, not terminated once exited: `I:422-429` |
| Stops | `P:197-208`, `P:275-290` | Cancel reports before the terminal event: `I:433-452`; signal without grace: `I:463-474`; grace and interrupt: `I:476-492`; stopped within the grace: `I:494-509` |
| An end no caller awaits is contained | `P:140-142`, `P:268-290` | `I:558-604`, three rows: the signal's stop, after a grace, a stream failure |
| A spawn that fails | `P:164` | `I:663-678`, both profiles |
| The stop is withdrawn after the run | `P:342` | `I:646-658` |
| Each driver wired, with its codes literally | the two profiles | `M:518-636` rows, `M:666-679` cases: per driver a non-object line, a broken stream, the output limit, the input (Claude Code) and what follows a result; Claude Code also a crash and a result before `init`, Codex a crash |
| Neither driver spawns or ends its provider itself | both drivers | `A:34-41`, `A:119-127`; the module ends it only through the termination: `A:130-134` |
| Each driver's stop is still the ledger's | unchanged | `M:338-377`, `M:441-482`, the cancel order and process-tree qualification suites, unmodified |

### Deleted case → replacement

| Deleted case (`tests/integration/driver-process-tree.test.mjs` at `7e10272`) | Assertion | Replacement |
| --- | --- | --- |
| `:64-75` "a Claude Code stream that keeps failing starts one termination of its child" | Output limit 1, the `chatter` fake: one termination, `VES_CLAUDE_OUTPUT_LIMIT`, closes `failed` | `I:328-339` (several failing lines, one termination, the first code) and `M`, row `claude-code` "exceeds its output limit" (`flood`: forty lines past the limit, one termination, `VES_CLAUDE_OUTPUT_LIMIT`, `failed`) |
| `:169-193`, row "a Codex stream that fails" | `garbled`: `VES_CODEX_STREAM_INVALID`, `failed`, one termination | `I:193-199`; `M`, row `codex` "writes a line that is not JSON" |
| `:169-193`, row "a Codex provider that exceeds its output limit" | `large`, limit 2048: `VES_CODEX_OUTPUT_LIMIT`, `failed`, one termination | `I:239-252`; `M`, row `codex` "exceeds its output limit" |
| `:169-193`, row "a Codex run that ends with its provider still running" | `linger`: no error, `completed`, one termination | `I:150-160`; `M`, row `codex` "completes its turn and keeps running" |
| `:169-193`, row "a Claude Code provider that closes its input" (win32: "a stop of a Claude Code provider that does not read its input") | `deaf`, 2 MiB prompt: `VES_CLAUDE_STDIN_FAILED`, `failed`, one termination; win32: `VES_CLAUDE_ABORTED`, `cancelled`, one | `I:298-324` (both platforms); `M`, row `claude-code` "closes its input before it has read its prompt", with the same win32 alternative |

The helpers only those cases used (`endedByItself`, `inputRow`,
`stoppedUnread`) went with them. The replacements run under
`test:integration` and `test:contract`, as the deleted cases ran under
`test:integration`.

### Modified

- `A`: the assertions that a driver spawns its provider with
  `detached: OWN_PROCESS_GROUP` and asks `unawaitedTermination` moved to the
  module (`A:44-49`, `A:130-134`), where that code now is. Each driver is
  instead asserted to call `runProviderChild`, hand it the injected
  terminator, and contain no `spawn` and no termination helper of its own
  (`A:34-41`, `A:119-127`). Every other assertion is unchanged.
- `M`: the child run axis is appended; nothing above it moved.
- `tests/integration/driver-process-tree.test.mjs`: the cases above deleted
  and its header comment updated; the five remaining cases are unmodified.
  The cases after the first deletion moved up by 15 lines, so earlier
  evidence that cites `P:77-91`, `P:103-141` and `P:228-243` of that file
  cites it at its own revision.

### Added

`I` (43 cases) with its labeled fake `tests/helpers/fake-provider-child.mjs`;
the child run axis of `M` (15 cases, three of them added with H1); `A` two
cases; the fakes' modes `not-an-object`, `crash`, `exit-after-result`
(both) and `unannounced` (Claude Code).

## 8. Discrimination (disposable copy)

A copy of `packages`, `tests`, `spikes` and `apps` as they were committed in
`6d42e0a` (before the `unannounced` row of `M` and the cases of H2 were
added), in an ignored scratch directory, was mutated one change at a time and restored after each
run; the tracked sources were never mutated. Suites: `I`, `M`, `A`.
Unmutated: 133 passed, 0 failed.

| Mutation of the module | Failing cases |
| --- | --- |
| The last failure wins | 2: `I:328-339`, `I:341-358` |
| A failure after a stop replaces the stop | 1: `I:341-358` |
| **The exit is not read before a result (Claude Code on `main`)** | 6: the non-zero and kill rows of `I:171-187`, both profiles; the crash rows of `M` for both drivers |
| **The exit after a result is read for every provider** | 8: `I:150-160`, `I:164-169`, the `linger` and `exit-after-result` rows of `M`, and four ordinary completed Codex sessions of `M`'s session axis |
| The exit after a result is never read | 2: `I:142-148`; `M`, Claude Code "exits with a failure after its result" |
| Every parsed line is received | 7: the five rows of `I:201-216`, the two `not-an-object` rows of `M` |
| Only `null` is refused | 4: the string, number, boolean and array rows of `I:201-216` |
| A provider the driver ends is not ended after its run | 3: `I:150-160`, `I:378-397`, `M` `linger` |
| The start signal asks no interrupt | 2: `I:476-492`, `I:494-509` |
| The grace period is ignored | 2: the same |
| The start signal's stop is not contained | 1: `I:558-604`, first row |
| The grace timer's stop is not contained | 1: second row |
| A stream failure's end is not contained | 1: third row |
| A stop does not mark the run | 8: four cancel cases of `M` (two per driver), `I:341-358`, `I:407-420`, `I:433-452`, `I:531-554` |
| An input failure is ignored | 2: `I:298-324`; `M` Claude Code input row |
| The error stream is not counted | 1: `I:254-265` |
| The line ending is not counted | 1: `I:267-277` |
| The limit admits one byte less | 1: `I:267-277` |
| A line past the limit is still received | 1: `I:239-252` |
| The default limit is not 1 MiB | 1: `I:267-277` |
| The provider shares the caller's process group | 2: `I:609-628`, `A:44-49` |
| A failed conversation replaces a stop | 2: `I:407-420`; `M` Codex cancel |
| A failed conversation ends the provider itself | 1: `I:422-429` |
| A frame is written without its line ending | 17 cases: `I:281-293`, `I:494-509` and every Codex case of `M`, which waited for their time limits; the run was cut short once caught |
| The stop is not withdrawn after the run | 3: `I:646-658` and two Claude Code cases of `M` |
| A failure asks for the termination once per failing line | **0: equivalent.** `singleTermination` collapses every later request into the first, which `tests/integration/driver-process-tree.test.mjs` asserts |

25 of 26 mutations failed at least one case; the survivor changes nothing
observable. Every process a mutated run left behind was killed by its id.

Against the sources of `main` with the tip's tests, the child run axis of
`M` fails exactly its four rows that encode a change (the two non-object
rows, Claude Code's crash and its result before `init`) and passes the ten
that encode wiring. `A` fails when a driver imports `spawn` again, or
`unawaitedTermination`.

## 9. Windows

What runs on win32, by branch:

- **`OWN_PROCESS_GROUP`** is false, so the module spawns without `detached`,
  as both drivers did. Forced on POSIX, every transcript matches its POSIX
  counterpart in the same way (section 5), and the scripted fake reads its
  group back as the caller's.
- **The fallback terminator** signals the one process inside a `try`
  (`driver-process-tree.ts`, unchanged). The injected terminator of
  `vestra task` runs `taskkill /T /F`.
- **A second kill of an exited process** (the first round's defect) is still
  answered by `singleTermination`, which the module now calls in one place
  for both drivers; every request goes through it (`P:197-208`).
- **A write to a provider that stopped reading** (the first round's second
  defect) does not fail on win32. The module changes nothing about it: an
  input failure is acted on when the runtime reports one. `I:298-324` asserts
  on win32 what holds there, as the deleted case did.
- **The exit of a terminated process** is code 1 with no signal on win32. No
  report reads it: a stop or failure decides first, and Codex does not read
  its exit after a result (D3). A Claude Code provider is not terminated at a
  normal end.
- **A spawn that fails** reports `ENOENT` with a negative close code on
  win32 as on POSIX; `I:663-678` uses a missing absolute path, which fails
  the same way on both.
- **Self-kill in `I`**: `process.kill(process.pid, "SIGKILL")` ends the fake
  with code 1 on win32 and a signal on POSIX; both are `…_PROCESS_FAILED`.
- **Not run here:** nothing ran on a Windows machine. Confidence is high for
  the Codex paths and the stop (one call site replaces two, under the same
  conditions, and the forced transcripts agree) and for the new hazard
  handling (no platform branch). It is moderate for `I:298-324` and the
  process-group case on win32, whose win32 arms mirror cases that passed the
  platform matrix in the first round but are new code. The platform matrix is
  required on the branch before merge.

## 10. Guardrails

- **Complexity** (only down): `claude-code-driver.ts :: Arrow function` 28 →
  22 (the stream-json `receive`), `claude-code-driver.ts :: Async method
  'start'` 24 → 14, `codex-driver.ts :: Arrow function` 33 → 31 (the App
  Server `receive`), `codex-driver.ts :: Async method 'start'` 26 → removed
  (below 10). The keys did not move. No function of the module is above 10.
- **Census:** the module carries no signal (no serialization, digest,
  canonicalizer or locale ordering) and is not excluded, so the census scans
  it and would catch one added later. The two driver files keep their
  exclusion by path for their frame serialization, which stayed with them.
  `pnpm census:refresh` changes nothing; `pnpm test:census` passes (13).
- **Citations moved:** the two version floors cited in
  `.specs/features/platform-qualification-matrix/matrix.md` (now
  `claude-code-driver.ts:453` and `codex-driver.ts:258`) and in
  `.specs/features/live-task-pilot/validation.md` (`claude-code-driver.ts:73`,
  `codex-driver.ts:258`), in the commits that moved them.
- Digest-bound reports, the migration count (12) and the runtime error
  catalog (19) are untouched. No dependency was added.

## 11. Gates (Node 24.14.0, macOS arm64)

Each row was run on the working tree of exactly that commit, one command at
a time.

| Commit | `pnpm gate:quick` | `pnpm test:architecture` | Focused suites |
| --- | --- | --- | --- |
| `32802ce` the comparison | PASS — unit 2610, agent-readiness 323, census 13 | PASS — 109 | — |
| `9f3b04e` H1 | PASS — 2610, 323, 13 | PASS — 109 | The two driver contract suites and `M`: PASS — 108; `qualify:claude` 65, `qualify:codex` 32 |
| `6d42e0a` the module | PASS — 2610, 323, 13 | PASS — 111 | The driver contract, ledger, runner, matrix, process-tree, child run, lifecycle, runner-driver, process-context and execution-adapter suites: PASS — 296; `qualify:claude` 65, `qualify:codex` 32 |
| `2ecf087` H2 | PASS — 2610, 323, 13 | PASS — 111 | `M`, `I`, the process-tree and driver contract suites: PASS — 171 |
| `968c322` comments | PASS — 2610, 323, 13 | PASS — 111 | `I`, `M` and the Claude Code contract suite: PASS — 144 |

At `2ecf087` (`968c322` changes two comments only):

| Command | Result |
| --- | --- |
| `pnpm gate:build` | PASS — unit 2610, contract 797, integration 1094, e2e 275, architecture 111, build 146, qualification 329 |
| `pnpm gate:security` | PASS — unit 2610, contract 797, e2e 275, architecture 111, qualification 329, security 1324, fault 310 |
| `pnpm test:contract` | PASS — 797 |
| `pnpm test:integration` | PASS — 1094 |
| `pnpm test:fault` | PASS — 310 |
| `pnpm test:qualification` | PASS — 329 |
| `pnpm qualify:claude` | PASS — 65 |
| `pnpm qualify:codex` | PASS — 32 |
| `pnpm census:refresh`, `pnpm test:census` | no change; PASS — 13 |
| `pnpm agent:check` | PASS (also on this commit) |

No test was skipped. No provider session was started and no model was
invoked; every provider was a labeled fake. `qualify:keychain` was not run.

## 12. Open points for the reviewer

- **Requalification.** Decided in review: both drivers are requalified for
  the runs that changed (section 6).
- **H3** (a start signal that aborts during the probe or the resolution is not
  noticed by the run) is recorded and not changed; the session runner covers
  it for every composition.
- **D6 and D7** (the letter case of the removed session variables, the floor
  of the output limit) are recorded and not changed.
- **`VES_CLAUDE_PROTOCOL_FAILED`** is part of the scheme the profile
  generates and is unreachable: the Claude Code conversation is one write,
  which cannot reject. The profile's comment says so.
- **A Codex provider that cannot be spawned** reports
  `VES_CODEX_PROTOCOL_FAILED`, because the close rejects its pending
  `initialize`, as for an App Server that exits before it answers. Claude
  Code reports `VES_CLAUDE_PROCESS_FAILED`.
- **The usage check** is still written in both translations; ADR2-6 (T6) owns
  it.
- **The platform matrix** is required on the branch (section 9).
