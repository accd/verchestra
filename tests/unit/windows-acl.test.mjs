// invariant: the owner-only proof of a Windows per-run directory (SSI-73) is
// decided here on every platform with a fake tool runner: which SID, how the
// DACL is replaced, how the saved DACL is read, and which DACLs count as
// owner-only, including the SDDL aliases a SID can read back as. The real
// tools run in tests/security/windows-pipe-bridge-security.test.mjs on the
// Windows runner.
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, sep, win32 } from "node:path";
import { afterEach, test } from "node:test";

import {
  WHOAMI_ARGUMENTS,
  currentUserSid,
  isOwnerOnlyDacl,
  ownerOnlyDacl,
  ownerOnlyRestore,
  proveOwnerOnlyDirectory,
  readDirectoryDacl,
  savedDacl,
  windowsAclToolExecutable
} from "../../packages/platform-node/src/windows-acl.ts";

const SID = "S-1-5-21-1000-2000-3000-1001";
const OWNER_ONLY = `D:PAI(A;OICI;FA;;;${SID})`;
// why: what the hosted Windows runner of platform matrix 37161526836 printed.
const RUNNER_ROW = '"runnervmfi6oq\\runneradmin","S-1-5-21-1643835476-1616584234-1346609752-500"';
const RUNNER_SID = "S-1-5-21-1643835476-1616584234-1346609752-500";
const RUNNER_AFTER_GRANT = "D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;LA)";
const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// invariant: a per-run directory inside a disposable root, so whatever the
// proof writes beside it stays inside the root.
async function runDirectory() {
  const root = await mkdtemp(join(tmpdir(), "verchestra-acl-"));
  roots.push(root);
  const directory = join(root, "vpipe-1");
  await mkdir(directory);
  return directory;
}

const utf16 = (text, bom = false) =>
  Buffer.concat([bom ? Buffer.from([0xff, 0xfe]) : Buffer.alloc(0), Buffer.from(text, "utf16le")]);

// invariant: a DETERMINISTIC FAKE of whoami and icacls; `/save` writes the
// DACL file in UTF-16LE, as icacls does.
function fakeRunner({ whoami = `"HOST\\owner","${SID}"\r\n`, dacl = OWNER_ONLY, fail = [] } = {}) {
  const calls = [];
  const runner = async (tool, args) => {
    calls.push([tool, ...args]);
    const step = tool === "whoami" ? "whoami" : (args[1] ?? "");
    if (fail.includes(step)) throw new Error(`${step} failed`);
    if (tool === "whoami") return whoami;
    if (args[1] === "/save" && dacl !== null) await writeFile(args[2], utf16(`vacl\r\n${dacl}\r\n`));
    return "processed file\r\n";
  };
  return { runner, calls };
}

// invariant: a DETERMINISTIC FAKE of the hosted runner's whoami and icacls,
// replaying its outputs. A grant leaves SYSTEM and Administrators beside the
// owner, as measured; `/restore` sets the DACL its file names, refusing a file
// that is not BOM-less UTF-16LE in two lines; `/save` writes the stored DACL
// with the owner's SID read back as LA, as SDDL renders that RID-500 SID.
function runnerHost() {
  const dacls = new Map();
  const restored = [];
  const render = (dacl) => dacl.replaceAll(RUNNER_SID, "LA");
  const runner = async (tool, args) => {
    if (tool === "whoami") return `${RUNNER_ROW}\r\n`;
    const [target, verb] = args;
    if (verb === "/inheritance:r") dacls.set(target, RUNNER_AFTER_GRANT);
    else if (verb === "/restore") {
      const bytes = await readFile(args[2]);
      assert.notDeepEqual(
        [...bytes.subarray(0, 2)],
        [0xff, 0xfe],
        "icacls reads a byte-order mark as part of the name"
      );
      const [name, dacl, rest] = bytes.toString("utf16le").split("\r\n");
      assert.equal(rest, "", "one entry, each line ended by CRLF");
      restored.push({ file: args[2], name, dacl });
      dacls.set(join(target, name), render(dacl));
    } else if (verb === "/save")
      await writeFile(args[2], utf16(`${basename(target)}\r\n${dacls.get(target) ?? "D:AI(A;OICIID;FA;;;SY)"}\r\n`));
    return "processed file: x\r\nSuccessfully processed 1 files; Failed processing 0 files\r\n";
  };
  return { runner, restored };
}

test("the ACL tools are the System32 programs, never a PATH lookup", () => {
  for (const tool of ["whoami", "icacls"]) {
    const executable = windowsAclToolExecutable(tool);
    assert.ok(win32.isAbsolute(executable), executable);
    assert.ok(executable.endsWith(`\\System32\\${tool}.exe`), executable);
  }
  assert.deepEqual(WHOAMI_ARGUMENTS, ["/user", "/fo", "csv", "/nh"]);
});

test("the current user's SID is read from whoami's one CSV row", () => {
  assert.equal(currentUserSid(`"HOST\\owner","${SID}"\r\n`), SID);
  assert.equal(currentUserSid(`"DOMAIN\\Müller, Hans","${SID}"`), SID, "a localized name with a comma");
  assert.equal(currentUserSid(`${RUNNER_ROW}\r\n`), RUNNER_SID, "the hosted runner's row");
  for (const output of ["", `"HOST\\owner","${SID}"\r\n"HOST\\other","${SID}"`, `"HOST\\owner","S-1-"`, "garbage"])
    assert.equal(currentUserSid(output), undefined, JSON.stringify(output));
});

test("the DACL is replaced whole from a BOM-less UTF-16LE file beside the directory", () => {
  const parent = join(sep, "runs");
  const directory = join(parent, "vpipe-1");
  const restore = ownerOnlyRestore(directory, SID);
  assert.equal(dirname(restore.file), parent, "the file is beside the directory, not inside it");
  assert.equal(basename(restore.file), "vpipe-1.owner-only-restore.acl");
  assert.deepEqual(restore.args, [parent, "/restore", restore.file]);
  assert.deepEqual(restore.contents, Buffer.from(`vpipe-1\r\n${OWNER_ONLY}\r\n`, "utf16le"));
  assert.notDeepEqual([...restore.contents.subarray(0, 2)], [0xff, 0xfe]);
  assert.equal(ownerOnlyDacl(SID), OWNER_ONLY);
  for (const trustee of ["Everyone", "*S-1-1-0", `${SID})(A;OICI;FA;;;WD`, "S-1-5-21-1 /grant Everyone:F"])
    assert.throws(() => ownerOnlyRestore(directory, trustee), TypeError, trustee);
});

test("the saved DACL is read from icacls' Unicode file with or without a byte-order mark", () => {
  assert.equal(savedDacl(utf16(`vacl\r\n${OWNER_ONLY}\r\n`)), OWNER_ONLY);
  assert.equal(savedDacl(utf16(`vacl\r\n${OWNER_ONLY}\r\n`, true)), OWNER_ONLY);
  assert.equal(savedDacl(Buffer.from(`vacl\n${OWNER_ONLY}\n`)), OWNER_ONLY);
  assert.equal(savedDacl(utf16("vacl\r\n")), undefined);
});

test("only a protected DACL with one inheritable full-control entry for the SID is owner-only", () => {
  for (const dacl of [OWNER_ONLY, `D:P(A;OICI;FA;;;${SID})`, `D:PAI(A;CIOI;FA;;;${SID})`])
    assert.equal(isOwnerOnlyDacl(dacl, SID), true, dacl);
  for (const dacl of [
    `D:AI(A;OICI;FA;;;${SID})`,
    `D:PAI(A;OICI;FA;;;${SID})(A;OICI;FA;;;SY)`,
    `D:PAI(A;OICI;FA;;;${SID})(A;OICI;FA;;;BA)`,
    `D:PAI(D;OICI;FA;;;${SID})`,
    `D:PAI(A;OICIID;FA;;;${SID})`,
    `D:PAI(A;OICINP;FA;;;${SID})`,
    `D:PAI(A;OICI;FR;;;${SID})`,
    `D:PAI(OA;OICI;FA;;;${SID})`,
    "D:PAI(A;OICI;FA;;;WD)",
    "D:PAI(A;OICI;FA;;;S-1-5-21-1000-2000-3000-1002)",
    "D:P",
    "D:NO_ACCESS_CONTROL",
    `O:${SID}D:PAI(A;OICI;FA;;;${SID})`
  ])
    assert.equal(isOwnerOnlyDacl(dacl, SID), false, dacl);
});

for (const [alias, sid] of [
  ["LA", RUNNER_SID],
  ["LA", "S-1-5-21-1-2-3-500"],
  ["LG", "S-1-5-21-1000-2000-3000-501"],
  ["SY", "S-1-5-18"],
  ["LS", "S-1-5-19"],
  ["NS", "S-1-5-20"]
])
  test(`the owner ${sid} reads back as the alias ${alias} and is owner-only`, () => {
    assert.equal(isOwnerOnlyDacl(`D:PAI(A;OICI;FA;;;${alias})`, sid), true);
    assert.equal(isOwnerOnlyDacl(`D:PAI(A;OICI;FA;;;${sid})`, sid), true, "the SID itself still names the owner");
    assert.equal(isOwnerOnlyDacl(`D:AI(A;OICI;FA;;;${alias})`, sid), false, "an alias does not lift protection");
    assert.equal(isOwnerOnlyDacl(`D:PAI(A;OICI;FA;;;${alias})(A;OICI;FA;;;BA)`, sid), false, "nor a second entry");
  });

for (const [alias, sid] of [
  ["LA", SID],
  ["LA", "S-1-5-21-1000-2000-3000-501"],
  ["LA", "S-1-5-21-1000-2000-3000-4000-500"],
  ["LA", "S-1-5-32-500"],
  ["LA", "S-1-5-21-1000-2000-3000-5000"],
  ["LG", "S-1-5-21-1000-2000-3000-500"],
  ["LG", SID],
  ["SY", RUNNER_SID],
  ["SY", "S-1-5-19"],
  ["LS", "S-1-5-18"],
  ["NS", "S-1-5-19"],
  ["BA", RUNNER_SID],
  ["BA", "S-1-5-32-544"],
  ["DA", RUNNER_SID],
  ["DU", SID],
  ["AU", SID],
  ["BU", SID],
  ["WD", SID],
  ["CO", SID],
  ["OW", SID],
  ["la", RUNNER_SID]
])
  test(`the alias ${alias} does not name the owner ${sid}`, () => {
    assert.equal(isOwnerOnlyDacl(`D:PAI(A;OICI;FA;;;${alias})`, sid), false);
  });

test("the hosted runner's grant leaves SYSTEM and Administrators beside the owner, so that path is refused", async () => {
  const directory = await runDirectory();
  const { runner } = runnerHost();
  const sid = currentUserSid(await runner("whoami", WHOAMI_ARGUMENTS));
  await runner("icacls", [directory, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`]);
  const dacl = await readDirectoryDacl(directory, runner);
  assert.equal(dacl, RUNNER_AFTER_GRANT);
  assert.equal(dacl.match(/\(A;/gu).length, 3, "three entries survive the grant");
  assert.equal(isOwnerOnlyDacl(dacl, sid), false, "the edited DACL is refused at verify");
});

test("on the hosted runner's outputs the whole-DACL restore is proven owner-only with the single LA entry", async () => {
  const directory = await runDirectory();
  const { runner, restored } = runnerHost();
  assert.deepEqual(await proveOwnerOnlyDirectory(directory, runner), {
    proven: true,
    sid: RUNNER_SID,
    dacl: "D:PAI(A;OICI;FA;;;LA)"
  });
  assert.deepEqual(restored, [
    {
      file: join(dirname(directory), "vpipe-1.owner-only-restore.acl"),
      name: "vpipe-1",
      dacl: `D:PAI(A;OICI;FA;;;${RUNNER_SID})`
    }
  ]);
  assert.deepEqual(await readdir(dirname(directory)), ["vpipe-1"], "the restore file is removed");
  assert.deepEqual(await readdir(directory), [], "nothing is left inside the per-run directory");
});

test("a directory is proven owner-only only after the restore and its read-back agree", async () => {
  const directory = await runDirectory();
  const { runner, calls } = fakeRunner();
  assert.deepEqual(await proveOwnerOnlyDirectory(directory, runner), { proven: true, sid: SID, dacl: OWNER_ONLY });
  assert.deepEqual(calls, [
    ["whoami", ...WHOAMI_ARGUMENTS],
    ["icacls", ...ownerOnlyRestore(directory, SID).args],
    ["icacls", directory, "/save", join(directory, "owner-only.acl")]
  ]);
  await assert.rejects(access(join(directory, "owner-only.acl")), { code: "ENOENT" }, "no saved file is left");
});

test("a restore file already beside the directory is not reused, and the proof stops", async () => {
  const directory = await runDirectory();
  await writeFile(ownerOnlyRestore(directory, SID).file, "planted");
  const { runner, calls } = fakeRunner();
  assert.deepEqual(await proveOwnerOnlyDirectory(directory, runner), { proven: false, step: "replace" });
  assert.deepEqual(calls, [["whoami", ...WHOAMI_ARGUMENTS]], "icacls never reads a file it did not get from the proof");
});

for (const [step, options] of [
  ["identity", { fail: ["whoami"] }],
  ["identity", { whoami: "INFO: no user\r\n" }],
  ["replace", { fail: ["/restore"] }],
  ["read-back", { fail: ["/save"] }],
  ["read-back", { dacl: null }],
  ["verify", { dacl: `D:PAI(A;OICI;FA;;;${SID})(A;OICI;FA;;;BU)` }],
  ["verify", { dacl: `D:AI(A;ID;FA;;;${SID})(A;ID;FA;;;BU)` }],
  ["verify", { dacl: RUNNER_AFTER_GRANT }]
])
  test(`an owner-only proof that fails at ${step} is no proof (${JSON.stringify(options)})`, async () => {
    const directory = await runDirectory();
    const { runner } = fakeRunner(options);
    assert.deepEqual(await proveOwnerOnlyDirectory(directory, runner), { proven: false, step });
    assert.deepEqual(await readdir(dirname(directory)), ["vpipe-1"], "no restore file is left");
    await assert.rejects(access(join(directory, "owner-only.acl")), { code: "ENOENT" });
  });
