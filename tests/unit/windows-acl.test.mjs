// invariant: the owner-only proof of a Windows per-run directory (SSI-73) is
// decided here on every platform with a fake tool runner: which SID, which
// grant, how the saved DACL is read, and which DACLs count as owner-only. The
// real tools run in tests/security/windows-pipe-bridge-security.test.mjs on
// the Windows runner.
import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { afterEach, test } from "node:test";

import {
  WHOAMI_ARGUMENTS,
  currentUserSid,
  isOwnerOnlyDacl,
  ownerOnlyGrantArguments,
  proveOwnerOnlyDirectory,
  savedDacl,
  windowsAclToolExecutable
} from "../../packages/platform-node/src/windows-acl.ts";

const SID = "S-1-5-21-1000-2000-3000-1001";
const OWNER_ONLY = `D:PAI(A;OICI;FA;;;${SID})`;
const directories = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function runDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "verchestra-acl-"));
  directories.push(directory);
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
  for (const output of ["", `"HOST\\owner","${SID}"\r\n"HOST\\other","${SID}"`, `"HOST\\owner","S-1-"`, "garbage"])
    assert.equal(currentUserSid(output), undefined, JSON.stringify(output));
});

test("the grant removes inheritance and gives the SID alone inheritable full control", () => {
  assert.deepEqual(ownerOnlyGrantArguments("C:\\run\\vpipe-1", SID), [
    "C:\\run\\vpipe-1",
    "/inheritance:r",
    "/grant:r",
    `*${SID}:(OI)(CI)F`
  ]);
  for (const trustee of ["Everyone", "*S-1-1-0", `${SID}:(F)`, "S-1-5-21-1 /grant Everyone:F"])
    assert.throws(() => ownerOnlyGrantArguments("C:\\run", trustee), TypeError, trustee);
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

test("a directory is proven owner-only only after the grant and its read-back agree", async () => {
  const directory = await runDirectory();
  const { runner, calls } = fakeRunner();
  assert.deepEqual(await proveOwnerOnlyDirectory(directory, runner), { proven: true, sid: SID, dacl: OWNER_ONLY });
  assert.deepEqual(calls, [
    ["whoami", ...WHOAMI_ARGUMENTS],
    ["icacls", ...ownerOnlyGrantArguments(directory, SID)],
    ["icacls", directory, "/save", join(directory, "owner-only.acl")]
  ]);
  await assert.rejects(access(join(directory, "owner-only.acl")), { code: "ENOENT" }, "no saved file is left");
});

for (const [step, options] of [
  ["identity", { fail: ["whoami"] }],
  ["identity", { whoami: "INFO: no user\r\n" }],
  ["grant", { fail: ["/inheritance:r"] }],
  ["read-back", { fail: ["/save"] }],
  ["read-back", { dacl: null }],
  ["verify", { dacl: `D:PAI(A;OICI;FA;;;${SID})(A;OICI;FA;;;BU)` }],
  ["verify", { dacl: `D:AI(A;ID;FA;;;${SID})(A;ID;FA;;;BU)` }]
])
  test(`an owner-only proof that fails at ${step} is no proof (${JSON.stringify(options)})`, async () => {
    const directory = await runDirectory();
    const { runner } = fakeRunner(options);
    assert.deepEqual(await proveOwnerOnlyDirectory(directory, runner), { proven: false, step });
    await assert.rejects(access(join(directory, "owner-only.acl")), { code: "ENOENT" });
  });
