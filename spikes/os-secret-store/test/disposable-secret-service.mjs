// hazard: this throwaway Secret Service serves the real-store qualification
// suite (`pnpm qualify:keychain`, #379) and never a gate suite. A test that
// reached the invoking user's own session bus would read or write their real
// login keyring, so every rule below exists to make that impossible:
// - a private dbus-daemon runs from a generated configuration with no service
//   directories, so nothing on it is ever D-Bus activated, and it listens on a
//   socket inside a fresh temporary directory;
// - a gnome-keyring daemon runs in the foreground on that bus with a temporary
//   HOME and XDG directories, and creates and unlocks a new login keyring from
//   a random password it reads on stdin;
// - while the session is active, this process's DBUS_SESSION_BUS_ADDRESS,
//   XDG_RUNTIME_DIR, and HOME name the disposable session, and the bound
//   runner below refuses to spawn `secret-tool` unless the environment the
//   product would hand the child still names it;
// - every spawn has a hard timeout, and both daemons and the directory are
//   removed in the caller's `finally`.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  SECRET_TOOL_EXECUTABLE,
  nodeSecretToolRunner,
  secretToolChildEnvironment
} from "../../../packages/platform-node/src/index.ts";

export const SESSION_TIMEOUT_MS = 20_000;
const SESSION_KEYS = ["DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR", "HOME"];

function busConfiguration(socket) {
  return `<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <listen>unix:path=${socket}</listen>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>
`;
}

function firstLine(child, label) {
  return new Promise((resolveLine, rejectLine) => {
    let text = "";
    const timer = setTimeout(() => rejectLine(new Error(`${label} did not report in time`)), SESSION_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      text += chunk.toString("utf8");
      const newline = text.indexOf("\n");
      if (newline === -1) return;
      clearTimeout(timer);
      resolveLine(text.slice(0, newline).trim());
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      rejectLine(new Error(`${label} exited early (${code})`));
    });
  });
}

// invariant: the only direct `secret-tool` call outside the product backend.
// It runs with exactly the product's child environment, so it can only reach
// the bus that environment names — asserted to be the disposable one.
export function secretTool(session, args, input) {
  const environment = secretToolChildEnvironment();
  if (environment.DBUS_SESSION_BUS_ADDRESS !== session.address)
    throw new Error("secret-tool would not reach the disposable session bus");
  return spawnSync(SECRET_TOOL_EXECUTABLE, args, {
    env: environment,
    input,
    encoding: "utf8",
    timeout: SESSION_TIMEOUT_MS,
    killSignal: "SIGKILL"
  });
}

async function waitForSecretService(session) {
  const deadline = Date.now() + SESSION_TIMEOUT_MS;
  for (;;) {
    const probe = secretTool(session, ["lookup", "service", "verchestra/readiness", "account", "probe"]);
    if (probe.status === 1 && probe.stderr.trim() === "") return;
    if (Date.now() > deadline) throw new Error(`the disposable Secret Service never answered: ${probe.stderr.trim()}`);
    await delay(200);
  }
}

export async function createDisposableSecretService() {
  const root = await mkdtemp(join(tmpdir(), "verchestra-secret-service-"));
  const home = join(root, "home");
  const runtime = join(root, "run");
  await mkdir(join(home, ".local", "share"), { recursive: true });
  await mkdir(runtime, { recursive: true });
  await chmod(runtime, 0o700);
  const socket = join(runtime, "bus");
  const configuration = join(root, "session.conf");
  await writeFile(configuration, busConfiguration(socket));
  const environment = {
    PATH: "/usr/bin:/bin",
    HOME: home,
    XDG_RUNTIME_DIR: runtime,
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_CACHE_HOME: join(home, ".cache"),
    LC_ALL: "C"
  };
  const children = [];
  const previous = Object.fromEntries(SESSION_KEYS.map((key) => [key, process.env[key]]));
  const session = { root, home, runtime, address: "", keyringStderr: "" };

  async function dispose() {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    for (const child of children.reverse()) if (child.exitCode === null) child.kill("SIGTERM");
    await delay(100);
    for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
    await rm(root, { recursive: true, force: true });
  }

  try {
    const bus = spawn("dbus-daemon", [`--config-file=${configuration}`, "--nofork", "--nopidfile", "--print-address=1"], {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"]
    });
    children.push(bus);
    session.address = await firstLine(bus, "dbus-daemon");
    if (!session.address.startsWith(`unix:path=${socket}`))
      throw new Error("the disposable bus is not listening on its own socket");
    const keyring = spawn("gnome-keyring-daemon", ["--foreground", "--unlock", "--components=secrets"], {
      env: { ...environment, DBUS_SESSION_BUS_ADDRESS: session.address },
      stdio: ["pipe", "pipe", "pipe"]
    });
    children.push(keyring);
    keyring.stdout.on("data", () => undefined);
    keyring.stderr.on("data", (chunk) => {
      session.keyringStderr += chunk.toString("utf8");
    });
    keyring.stdin.end(randomBytes(24).toString("hex"));
    process.env.DBUS_SESSION_BUS_ADDRESS = session.address;
    process.env.XDG_RUNTIME_DIR = runtime;
    process.env.HOME = home;
    await waitForSecretService(session);
  } catch (error) {
    await dispose();
    throw error;
  }

  return Object.freeze({
    root,
    home,
    runtime,
    address: session.address,
    keyringLog: () => session.keyringStderr,
    // invariant: the sorted `service\0account` pairs the disposable keyring
    // holds under `namespace`, read from the Secret Service itself, so a test
    // can prove exactly which items its commands left behind.
    items(namespace) {
      const result = secretTool(session, ["search", "--all", "service", namespace]);
      if (result.status !== 0 && result.stderr.trim() !== "")
        throw new Error(`secret-tool search failed (exit ${result.status})`);
      const text = `${result.stdout}\n${result.stderr}`;
      const accounts = [...text.matchAll(/^attribute\.account = (\S+)$/gmu)].map((match) => match[1]);
      return accounts
        .map((account) => `${namespace}\u0000${account}`)
        .sort((left, right) => Number(left > right) - Number(left < right));
    },
    dispose
  });
}

// invariant: a runner that refuses, before spawning, any `secret-tool` call
// whose child environment would not name the disposable session bus. It
// records argv only, never stdin, so the log can hold no credential.
export function sessionBoundRunner(session) {
  const commands = [];
  async function runner(invocation) {
    if (secretToolChildEnvironment().DBUS_SESSION_BUS_ADDRESS !== session.address)
      throw new Error(`secret-tool ${invocation.args[0]} would not reach the disposable session bus`);
    commands.push(invocation.args[0]);
    return nodeSecretToolRunner(invocation);
  }
  return Object.freeze({ runner, commands });
}
