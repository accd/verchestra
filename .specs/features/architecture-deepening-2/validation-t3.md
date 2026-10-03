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
