// invariant: in-memory stand-ins for libsecret's `secret-tool` and for the
// Windows PowerShell credential program (#379), following the conventions the
// real-store qualification suite measures (docs/qualification/
// os-secret-backend-linux.md and os-secret-backend-windows.md). They record
// every invocation so a test can prove what crossed the process boundary, and
// never spawn anything.

function pairs(args, from) {
  const attributes = new Map();
  for (let index = from; index + 1 < args.length; index += 2) attributes.set(args[index], args[index + 1]);
  return attributes;
}

const itemKey = (attributes) => `${attributes.get("service")}\u0000${attributes.get("account")}`;

// invariant: `secret-tool lookup` and `clear` exit 1 and print nothing when
// nothing matches; `store` replaces the item with the same attributes; a
// piped lookup prints exactly the value.
export function fakeSecretToolRunner(options = {}) {
  const items = new Map();
  const invocations = [];

  async function runner(invocation) {
    const record = {
      args: [...invocation.args],
      stdin: invocation.stdin === undefined ? undefined : Buffer.from(invocation.stdin).toString("latin1"),
      timeoutMs: invocation.timeoutMs,
      discardStdout: invocation.discardStdout === true
    };
    invocations.push(record);
    if (options.override) {
      const forced = await options.override(record);
      if (forced !== undefined) return forced;
    }
    const [command] = invocation.args;
    if (command === "lookup") {
      const stored = items.get(itemKey(pairs(invocation.args, 1)));
      if (stored === undefined) return { exitCode: 1, stdout: "", stderr: "" };
      return { exitCode: 0, stdout: record.discardStdout ? "" : stored.toString("utf8"), stderr: "" };
    }
    if (command === "store") {
      const label = invocation.args[1];
      if (!label?.startsWith("--label=")) return { exitCode: 2, stdout: "", stderr: "usage: secret-tool store\n" };
      items.set(itemKey(pairs(invocation.args, 2)), Buffer.from(invocation.stdin ?? []));
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (command === "clear") {
      const removed = items.delete(itemKey(pairs(invocation.args, 1)));
      return { exitCode: removed ? 0 : 1, stdout: "", stderr: "" };
    }
    return { exitCode: 2, stdout: "", stderr: "unsupported fake command\n" };
  }

  return Object.freeze({ runner, invocations, items });
}

const CALL = /\[VerchestraCredentialManager\]::(Has|Read|Write|Delete)\('([^']+)'(?:, '([^']+)', \$verchestraPayload)?\)/u;
const PAYLOAD = /^\$verchestraPayload = \[Console\]::In\.ReadLine\(\)\n(#[^\n]*)\n/mu;

// invariant: the fake interprets only the program shape the backend writes —
// the operation and target from the single call line, and the value from the
// `#`-prefixed data line after the ReadLine statement — and answers with the
// same `verchestra-credential:` result lines the real program prints.
export function fakePowerShellRunner(options = {}) {
  const items = new Map();
  const invocations = [];

  async function runner(invocation) {
    const stdin = invocation.stdin === undefined ? "" : Buffer.from(invocation.stdin).toString("latin1");
    const record = { args: [...invocation.args], stdin, timeoutMs: invocation.timeoutMs };
    invocations.push(record);
    if (options.override) {
      const forced = await options.override(record);
      if (forced !== undefined) return forced;
    }
    const call = CALL.exec(stdin);
    if (call === null) return { exitCode: 1, stdout: "", stderr: "unrecognized program\n" };
    const [, operation, target, user] = call;
    const answer = (status) => ({ exitCode: 0, stdout: `verchestra-credential:${status}\r\n`, stderr: "" });
    const stored = items.get(target);
    if (operation === "Has") return answer(stored === undefined ? "absent" : "present");
    if (operation === "Read")
      return answer(stored === undefined ? "absent" : `value:${stored.value.toString("base64")}`);
    if (operation === "Delete") {
      items.delete(target);
      return answer(stored === undefined ? "absent" : "deleted");
    }
    const payload = PAYLOAD.exec(stdin)?.[1];
    if (payload === undefined) return answer("error:payload");
    items.set(target, { user, value: Buffer.from(payload.slice(1), "base64") });
    return answer("stored");
  }

  return Object.freeze({ runner, invocations, items });
}
