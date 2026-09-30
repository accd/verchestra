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

function searchReply(unlocked, locked) {
  const paths = (count, from) =>
    Array.from(
      { length: count },
      (_, index) => `      object path "/org/freedesktop/secrets/collection/login/${from + index}"\n`
    ).join("");
  return (
    "method return time=1.0 sender=:1.1 -> destination=:1.2 serial=7 reply_serial=2\n" +
    `   array [\n${paths(unlocked, 1)}   ]\n` +
    `   array [\n${paths(locked, 100)}   ]\n`
  );
}

// invariant: `secret-tool lookup` and `clear` exit 1 and print nothing when
// nothing matches; `store` replaces the item with the same attributes; a piped
// lookup prints exactly the value; `dbus-send` SearchItems answers with the
// unlocked and the locked item paths. An item in `locked` is found by the
// search but, as measured on gnome-keyring without a prompter, missed by a
// lookup and refused by a store.
export function fakeSecretToolRunner(options = {}) {
  const items = new Map();
  const locked = new Set();
  const invocations = [];

  async function runner(invocation) {
    const record = {
      tool: invocation.tool ?? "secret-tool",
      args: [...invocation.args],
      stdin: invocation.stdin === undefined ? undefined : Buffer.from(invocation.stdin).toString("latin1"),
      timeoutMs: invocation.timeoutMs
    };
    invocations.push(record);
    if (options.override) {
      const forced = await options.override(record);
      if (forced !== undefined) return forced;
    }
    if (record.tool === "dbus-send") {
      const query = /^dict:string:string:service,([^,]+),account,([^,]+)$/u.exec(invocation.args.at(-1) ?? "");
      if (query === null) return { exitCode: 1, stdout: "", stderr: "Error org.freedesktop.DBus.Error.InvalidArgs\n" };
      const key = `${query[1]}\u0000${query[2]}`;
      const present = items.has(key);
      return {
        exitCode: 0,
        stdout: searchReply(present && !locked.has(key) ? 1 : 0, locked.has(key) ? 1 : 0),
        stderr: ""
      };
    }
    const [command] = invocation.args;
    if (command === "lookup") {
      const key = itemKey(pairs(invocation.args, 1));
      const stored = items.get(key);
      if (stored === undefined || locked.has(key)) return { exitCode: 1, stdout: "", stderr: "" };
      return { exitCode: 0, stdout: stored.toString("utf8"), stderr: "" };
    }
    if (command === "store") {
      const label = invocation.args[1];
      if (!label?.startsWith("--label=")) return { exitCode: 2, stdout: "", stderr: "usage: secret-tool store\n" };
      const key = itemKey(pairs(invocation.args, 2));
      if (locked.has(key)) return { exitCode: 1, stdout: "", stderr: "secret-tool: Cannot prompt: no prompter\n" };
      items.set(key, Buffer.from(invocation.stdin ?? []));
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (command === "clear") {
      const removed = items.delete(itemKey(pairs(invocation.args, 1)));
      return { exitCode: removed ? 0 : 1, stdout: "", stderr: "" };
    }
    return { exitCode: 2, stdout: "", stderr: "unsupported fake command\n" };
  }

  return Object.freeze({ runner, invocations, items, locked });
}

const CALL =
  /\[VerchestraCredentialManager\]::(Has|Read|Write|Delete)\('([^']+)'(?:, '([^']+)', \$verchestraPayload)?\)/u;
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
