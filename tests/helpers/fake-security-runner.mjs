// invariant: an in-memory stand-in for /usr/bin/security that follows the
// exit-code and output conventions measured on macOS for #379 (0 found, 44 not
// found, `-g` prints `password: "..."` or `password: 0x<HEX>  "..."` on stderr,
// `-i` reads one command per stdin line). It records every invocation so a
// test can prove what crossed the process boundary.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const NOT_FOUND = "security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.\n";

function printable(bytes) {
  return bytes.every((byte) => byte >= 0x20 && byte <= 0x7e && byte !== 0x22 && byte !== 0x5c);
}

export function fakeSecurityRunner(options = {}) {
  const items = new Map();
  const invocations = [];
  const key = (keychain, service, account) => `${keychain ?? "default"}\u0000${service}\u0000${account}`;

  function lookup(args) {
    const service = args[args.indexOf("-s") + 1];
    const account = args[args.indexOf("-a") + 1];
    const flagged = new Set(["-s", "-a"]);
    const positional = args
      .slice(1)
      .filter((entry, index, all) => !entry.startsWith("-") && !flagged.has(all[index - 1]));
    return { service, account, keychain: positional[0] };
  }

  async function runner(invocation) {
    const record = {
      args: [...invocation.args],
      stdin: invocation.stdin === undefined ? undefined : Buffer.from(invocation.stdin).toString("latin1"),
      timeoutMs: invocation.timeoutMs
    };
    invocations.push(record);
    if (options.override) {
      const forced = await options.override(record);
      if (forced !== undefined) return forced;
    }
    const [command] = invocation.args;
    if (command === "-i") {
      const line = record.stdin ?? "";
      const tokens = line.replace(/\n$/u, "").split(" ");
      if (tokens[0] !== "add-generic-password") return { exitCode: 1, stdout: "", stderr: "unknown command\n" };
      const at = (flag) => tokens[tokens.indexOf(flag) + 1];
      const keychain = tokens[tokens.indexOf("-X") + 2];
      const itemKey = key(keychain, at("-s"), at("-a"));
      // invariant: without -U, adding an existing item fails as security(1) does.
      if (!tokens.includes("-U") && items.has(itemKey))
        return { exitCode: 45, stdout: "", stderr: "The specified item already exists in the keychain.\n" };
      items.set(itemKey, Buffer.from(at("-X"), "hex"));
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    const { service, account, keychain } = lookup(invocation.args);
    const stored = items.get(key(keychain, service, account));
    if (command === "find-generic-password") {
      if (stored === undefined) return { exitCode: 44, stdout: "", stderr: NOT_FOUND };
      const attributes = `keychain: "${keychain ?? "default"}"\nattributes:\n    "acct"<blob>="${account}"\n`;
      if (!invocation.args.includes("-g")) return { exitCode: 0, stdout: attributes, stderr: "" };
      const bytes = [...stored];
      const password = printable(bytes)
        ? `password: "${stored.toString("latin1")}"\n`
        : `password: 0x${stored.toString("hex").toUpperCase()}  "escaped"\n`;
      return { exitCode: 0, stdout: attributes, stderr: password };
    }
    if (command === "delete-generic-password") {
      if (stored === undefined) return { exitCode: 44, stdout: "", stderr: NOT_FOUND };
      items.delete(key(keychain, service, account));
      return { exitCode: 0, stdout: "password has been deleted.\n", stderr: "" };
    }
    return { exitCode: 1, stdout: "", stderr: "unsupported fake command\n" };
  }

  return Object.freeze({ runner, invocations, items });
}

// invariant: a file that passes the backend's keychain check (regular file,
// owned by the caller, `kych` magic) without being a real keychain, for
// platform-independent tests that never spawn `security`.
export async function fakeKeychainFile(directory, name = "fake.keychain-db") {
  const path = join(directory, name);
  await writeFile(path, Buffer.concat([Buffer.from("kych"), Buffer.alloc(60)]));
  return path;
}
