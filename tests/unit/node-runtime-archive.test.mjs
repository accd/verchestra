import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { crc32, deflateRawSync, gzipSync } from "node:zlib";

import {
  ARCHIVE_LIMITS,
  SINGLE_BINARY_TARGETS,
  loadNodeRuntimePins,
  parseNodeRuntimePins,
  runtimeFromArchive,
  runtimeFromInstallation,
  sha256Of
} from "../../scripts/node-runtime-archive.mjs";

// why: the single binary embeds whatever runtime this module accepts, so its
// acceptance rule is the security boundary of #236's build: a byte that does
// not match its pinned digest must never reach an executable. The archive
// readers are exercised on synthetic tar.gz and zip archives, including the
// long-name and checksum paths a real Node archive may or may not take.

const roots = [];
after(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const scratch = async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-node-runtime-"));
  roots.push(root);
  return root;
};

const EXECUTABLE = Buffer.from("\x7fELF synthetic node runtime", "latin1");
const LICENSE = Buffer.from("Node.js is licensed for use as follows:\n", "utf8");

function tarEntry(name, body, type = "0") {
  const header = Buffer.alloc(512);
  header.write(name.slice(0, 100), 0, "utf8");
  header.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124, "latin1");
  header.write(type, 156, "latin1");
  header.write("ustar\0", 257, "latin1");
  return Buffer.concat([header, body, Buffer.alloc((512 - (body.length % 512)) % 512)]);
}

/** invariant: a pax record's decimal length counts its own digits, the space, and the newline. */
function paxRecord(key, value) {
  const payload = ` ${key}=${value}\n`;
  let length = Buffer.byteLength(payload) + 1;
  while (String(length).length + Buffer.byteLength(payload) !== length) length += 1;
  return Buffer.from(`${length}${payload}`, "utf8");
}

function tarGz(entries) {
  return gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
}

function zipOf(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const { name, body, method, unixMode, recordedSize, localName } of files) {
    const stored = method === 8 ? deflateRawSync(body) : body;
    const nameBytes = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(nameBytes.length, 26);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    if (unixMode !== undefined) record.writeUInt8(3, 5);
    record.writeUInt16LE(method, 10);
    record.writeUInt32LE(crc32(body), 16);
    record.writeUInt32LE(stored.length, 20);
    record.writeUInt32LE(recordedSize ?? body.length, 24);
    record.writeUInt16LE(nameBytes.length, 28);
    record.writeUInt32LE(((unixMode ?? 0) << 16) >>> 0, 38);
    record.writeUInt32LE(offset, 42);
    locals.push(local, localName === undefined ? nameBytes : Buffer.from(localName, "utf8"), stored);
    central.push(record, nameBytes);
    offset += local.length + nameBytes.length + stored.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function pinsFor(archiveName, archive, members) {
  const entry = {
    archive: { fileName: archiveName, sha256: sha256Of(archive) },
    executable: { member: members.executable, sha256: sha256Of(EXECUTABLE) },
    licenseFile: { member: members.license, sha256: sha256Of(LICENSE) }
  };
  return parseNodeRuntimePins({
    schemaVersion: 1,
    runtime: "node",
    version: "24.14.0",
    targets: Object.fromEntries(SINGLE_BINARY_TARGETS.map((key) => [key, entry]))
  });
}

test("the tracked pins name exactly the five targets at the repository's pinned Node version", async () => {
  const pins = await loadNodeRuntimePins();
  const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  assert.equal(pins.version, manifest.engines.node);
  assert.deepEqual(Object.keys(pins.targets), [...SINGLE_BINARY_TARGETS]);
  assert.equal(pins.shasumsUrl, `https://nodejs.org/dist/v${pins.version}/SHASUMS256.txt`);
  for (const [target, pin] of Object.entries(pins.targets)) {
    const [platform, arch] = target.split("-");
    const distribution = `node-v${pins.version}-${platform === "win32" ? "win" : platform}-${arch}`;
    assert.equal(pin.archive.fileName, `${distribution}${platform === "win32" ? ".zip" : ".tar.gz"}`, target);
    assert.equal(pin.executable.member, `${distribution}/${platform === "win32" ? "node.exe" : "bin/node"}`, target);
    assert.equal(pin.licenseFile.member, `${distribution}/LICENSE`, target);
  }
  assert.match(pins.digest, /^[a-f0-9]{64}$/u);
});

test("pins that do not name exactly the supported targets are refused", async () => {
  const document = JSON.parse(
    await readFile(new URL("../../apps/vestra-launcher/single-binary/node-runtime.json", import.meta.url), "utf8")
  );
  const without = structuredClone(document);
  delete without.targets["linux-x64"];
  const extra = structuredClone(document);
  extra.targets["win32-arm64"] = document.targets["win32-x64"];
  const badDigest = structuredClone(document);
  badDigest.targets["darwin-arm64"].archive.sha256 = "not-a-digest";
  for (const candidate of [
    without,
    extra,
    badDigest,
    { ...document, schemaVersion: 2 },
    { ...document, version: "24" },
    ...[
      ["archive", "fileName", "../node-v24.14.0-darwin-arm64.tar.gz"],
      ["archive", "fileName", "nested/node-v24.14.0-darwin-arm64.tar.gz"],
      ["executable", "member", "../../outside/bin/node"],
      ["executable", "member", "/node-v24.14.0-darwin-arm64/bin/node"],
      ["executable", "member", "node-v24.14.0-darwin-arm64/./bin/node"],
      ["licenseFile", "member", "node-v24.14.0-darwin-arm64\\LICENSE"],
      ["licenseFile", "member", "node-v24.14.0-darwin-arm64//LICENSE"]
    ].map(([file, key, value]) => {
      const escaping = structuredClone(document);
      escaping.targets["darwin-arm64"][file][key] = value;
      return escaping;
    })
  ]) {
    assert.throws(() => parseNodeRuntimePins(candidate), { code: "VES_BINARY_RUNTIME_PINS_INVALID" });
  }
});

test("a verified tar.gz yields exactly its pinned members, including pax and GNU long names", async () => {
  const cache = await scratch();
  const longDirectory = `node-v24.14.0-linux-x64/${"nested/".repeat(20)}`;
  const pax = paxRecord("path", `${longDirectory}bin/node`);
  const gnu = Buffer.from(`${longDirectory}LICENSE\0`, "utf8");
  const archive = tarGz([
    tarEntry("node-v24.14.0-linux-x64/", Buffer.alloc(0), "5"),
    tarEntry("PaxHeader", pax, "x"),
    tarEntry("truncated-name", EXECUTABLE),
    tarEntry("././@LongLink", gnu, "L"),
    tarEntry("also-truncated", LICENSE)
  ]);
  await writeFile(join(cache, "node.tar.gz"), archive);
  const pins = pinsFor("node.tar.gz", archive, {
    executable: `${longDirectory}bin/node`,
    license: `${longDirectory}LICENSE`
  });
  const runtime = await runtimeFromArchive(pins, "linux-x64", cache);
  assert.equal(runtime.verifiedBy, "archive");
  assert.deepEqual(runtime.executable, EXECUTABLE);
  assert.deepEqual(runtime.license, LICENSE);
});

test("a verified zip yields its stored and deflated members", async () => {
  const cache = await scratch();
  const archive = zipOf([
    { name: "node-v24.14.0-win-x64/LICENSE", body: LICENSE, method: 0 },
    { name: "node-v24.14.0-win-x64/node.exe", body: EXECUTABLE, method: 8 }
  ]);
  await writeFile(join(cache, "node.zip"), archive);
  const pins = pinsFor("node.zip", archive, {
    executable: "node-v24.14.0-win-x64/node.exe",
    license: "node-v24.14.0-win-x64/LICENSE"
  });
  const runtime = await runtimeFromArchive(pins, "win32-x64", cache);
  assert.deepEqual(runtime.executable, EXECUTABLE);
  assert.deepEqual(runtime.license, LICENSE);
});

test("an archive whose bytes differ from the pin is refused before anything is extracted", async () => {
  const cache = await scratch();
  const archive = tarGz([tarEntry("n/bin/node", EXECUTABLE), tarEntry("n/LICENSE", LICENSE)]);
  const pins = pinsFor("node.tar.gz", archive, { executable: "n/bin/node", license: "n/LICENSE" });
  await writeFile(join(cache, "node.tar.gz"), Buffer.concat([archive, Buffer.from([0])]));
  await assert.rejects(runtimeFromArchive(pins, "linux-arm64", cache), { code: "VES_BINARY_RUNTIME_DIGEST_MISMATCH" });
});

test("a member whose bytes differ from its own pin is refused even inside a pinned archive", async () => {
  const cache = await scratch();
  const archive = tarGz([tarEntry("n/bin/node", Buffer.from("not the runtime")), tarEntry("n/LICENSE", LICENSE)]);
  await writeFile(join(cache, "node.tar.gz"), archive);
  const pins = pinsFor("node.tar.gz", archive, { executable: "n/bin/node", license: "n/LICENSE" });
  await assert.rejects(runtimeFromArchive(pins, "linux-arm64", cache), { code: "VES_BINARY_RUNTIME_DIGEST_MISMATCH" });
});

test("a missing archive, a missing member, and a corrupt zip entry all fail closed", async () => {
  const cache = await scratch();
  const archive = tarGz([tarEntry("n/bin/node", EXECUTABLE)]);
  await writeFile(join(cache, "node.tar.gz"), archive);
  const pins = pinsFor("node.tar.gz", archive, { executable: "n/bin/node", license: "n/LICENSE" });
  await assert.rejects(runtimeFromArchive(pins, "linux-x64", cache), { code: "VES_BINARY_RUNTIME_ARCHIVE_INVALID" });
  await assert.rejects(runtimeFromArchive(pins, "linux-x64", join(cache, "absent")), {
    code: "VES_BINARY_RUNTIME_UNAVAILABLE"
  });

  const zip = zipOf([
    { name: "w/node.exe", body: EXECUTABLE, method: 8 },
    { name: "w/LICENSE", body: LICENSE, method: 0 }
  ]);
  zip[zip.indexOf(LICENSE)] ^= 0xff;
  await writeFile(join(cache, "node.zip"), zip);
  const zipPins = pinsFor("node.zip", zip, { executable: "w/node.exe", license: "w/LICENSE" });
  await assert.rejects(runtimeFromArchive(zipPins, "win32-x64", cache), { code: "VES_BINARY_RUNTIME_ARCHIVE_INVALID" });
});

test("an installed runtime is accepted only when the executable and its LICENSE match their pins", async () => {
  const archive = Buffer.from("unused");
  const posix = await scratch();
  await mkdir(join(posix, "bin"));
  await writeFile(join(posix, "bin", "node"), EXECUTABLE);
  await writeFile(join(posix, "LICENSE"), LICENSE);
  const pins = pinsFor("unused", archive, { executable: "n/bin/node", license: "n/LICENSE" });
  const runtime = await runtimeFromInstallation(pins, "darwin-arm64", join(posix, "bin", "node"));
  assert.equal(runtime.verifiedBy, "installation");
  assert.deepEqual(runtime.executable, EXECUTABLE);

  const windows = await scratch();
  await writeFile(join(windows, "node.exe"), EXECUTABLE);
  await writeFile(join(windows, "LICENSE"), LICENSE);
  assert.deepEqual((await runtimeFromInstallation(pins, "win32-x64", join(windows, "node.exe"))).license, LICENSE);

  await writeFile(join(posix, "LICENSE"), "edited");
  await assert.rejects(runtimeFromInstallation(pins, "darwin-arm64", join(posix, "bin", "node")), {
    code: "VES_BINARY_RUNTIME_DIGEST_MISMATCH"
  });
  await writeFile(join(windows, "node.exe"), "a different runtime");
  await assert.rejects(runtimeFromInstallation(pins, "win32-x64", join(windows, "node.exe")), {
    code: "VES_BINARY_RUNTIME_DIGEST_MISMATCH"
  });
});

test("a pax header is walked by record length, so a record value cannot forge a path", async () => {
  const cache = await scratch();
  const forged = paxRecord("comment", `x\n${paxRecord("path", "n/bin/node").toString("utf8")}`);
  const archive = tarGz([
    tarEntry("PaxHeader", forged, "x"),
    tarEntry("decoy", Buffer.from("not the runtime")),
    tarEntry("n/bin/node", EXECUTABLE),
    tarEntry("n/LICENSE", LICENSE)
  ]);
  await writeFile(join(cache, "node.tar.gz"), archive);
  const pins = pinsFor("node.tar.gz", archive, { executable: "n/bin/node", license: "n/LICENSE" });
  assert.deepEqual((await runtimeFromArchive(pins, "linux-x64", cache)).executable, EXECUTABLE);

  const malformed = tarGz([
    tarEntry("PaxHeader", Buffer.from("99 path=n/bin/node\n"), "x"),
    tarEntry("n/bin/node", EXECUTABLE),
    tarEntry("n/LICENSE", LICENSE)
  ]);
  await writeFile(join(cache, "malformed.tar.gz"), malformed);
  const malformedPins = pinsFor("malformed.tar.gz", malformed, { executable: "n/bin/node", license: "n/LICENSE" });
  await assert.rejects(runtimeFromArchive(malformedPins, "linux-x64", cache), {
    code: "VES_BINARY_RUNTIME_ARCHIVE_INVALID",
    message: /pax extended header is malformed/u
  });
});

test("a link, a duplicate, or a truncated entry under a pinned tar member name refuses the archive", async () => {
  const cache = await scratch();
  const cases = [
    ["symlink", [tarEntry("n/bin/node", Buffer.alloc(0), "2"), tarEntry("n/LICENSE", LICENSE)], /not a regular file/u],
    ["hardlink", [tarEntry("n/bin/node", Buffer.alloc(0), "1"), tarEntry("n/LICENSE", LICENSE)], /not a regular file/u],
    [
      "duplicate",
      [tarEntry("n/bin/node", EXECUTABLE), tarEntry("n/bin/node", EXECUTABLE), tarEntry("n/LICENSE", LICENSE)],
      /appears more than once/u
    ]
  ];
  for (const [label, entries, message] of cases) {
    const archive = tarGz(entries);
    await writeFile(join(cache, `${label}.tar.gz`), archive);
    const pins = pinsFor(`${label}.tar.gz`, archive, { executable: "n/bin/node", license: "n/LICENSE" });
    await assert.rejects(
      runtimeFromArchive(pins, "linux-x64", cache),
      { code: "VES_BINARY_RUNTIME_ARCHIVE_INVALID", message },
      label
    );
  }

  const whole = Buffer.concat([tarEntry("n/LICENSE", LICENSE), tarEntry("n/bin/node", EXECUTABLE)]);
  const truncated = gzipSync(whole.subarray(0, 3 * 512 + 4));
  await writeFile(join(cache, "truncated.tar.gz"), truncated);
  const truncatedPins = pinsFor("truncated.tar.gz", truncated, { executable: "n/bin/node", license: "n/LICENSE" });
  await assert.rejects(runtimeFromArchive(truncatedPins, "linux-x64", cache), {
    code: "VES_BINARY_RUNTIME_ARCHIVE_INVALID",
    message: /extends past the end/u
  });
});

test("expansion is bounded: an oversized tar, tar member, or zip member is refused before it is read", async () => {
  const cache = await scratch();
  const archive = tarGz([tarEntry("n/bin/node", EXECUTABLE), tarEntry("n/LICENSE", LICENSE)]);
  await writeFile(join(cache, "node.tar.gz"), archive);
  const pins = pinsFor("node.tar.gz", archive, { executable: "n/bin/node", license: "n/LICENSE" });
  await assert.rejects(runtimeFromArchive(pins, "linux-x64", cache, { ...ARCHIVE_LIMITS, expandedTarBytes: 1024 }), {
    code: "VES_BINARY_RUNTIME_ARCHIVE_INVALID",
    message: /does not expand within its bound/u
  });
  await assert.rejects(
    runtimeFromArchive(pins, "linux-x64", cache, { ...ARCHIVE_LIMITS, memberBytes: EXECUTABLE.length - 1 }),
    { code: "VES_BINARY_RUNTIME_ARCHIVE_INVALID", message: /exceeds the member size bound/u }
  );

  const zip = zipOf([
    { name: "w/node.exe", body: EXECUTABLE, method: 8 },
    { name: "w/LICENSE", body: LICENSE, method: 0 }
  ]);
  await writeFile(join(cache, "node.zip"), zip);
  const zipPins = pinsFor("node.zip", zip, { executable: "w/node.exe", license: "w/LICENSE" });
  await assert.rejects(
    runtimeFromArchive(zipPins, "win32-x64", cache, { ...ARCHIVE_LIMITS, memberBytes: EXECUTABLE.length - 1 }),
    { code: "VES_BINARY_RUNTIME_ARCHIVE_INVALID", message: /exceeds the member size bound/u }
  );
  assert.ok(ARCHIVE_LIMITS.expandedTarBytes >= 1024 ** 3 && ARCHIVE_LIMITS.memberBytes >= 256 * 1024 ** 2);
});

test("a zip member that is a symlink, overflows its size, or disagrees with its local header is refused", async () => {
  const cache = await scratch();
  const license = { name: "w/LICENSE", body: LICENSE, method: 0 };
  const cases = [
    [
      "symlink",
      { name: "w/node.exe", body: Buffer.from("../../elsewhere"), method: 0, unixMode: 0o120777 },
      /not a regular file/u
    ],
    ["bomb", { name: "w/node.exe", body: EXECUTABLE, method: 8, recordedSize: 4 }, /does not inflate within/u],
    ["renamed", { name: "w/node.exe", body: EXECUTABLE, method: 8, localName: "w/nodX.exe" }, /disagrees/u]
  ];
  for (const [label, member, message] of cases) {
    const zip = zipOf([member, license]);
    await writeFile(join(cache, `${label}.zip`), zip);
    const pins = pinsFor(`${label}.zip`, zip, { executable: "w/node.exe", license: "w/LICENSE" });
    await assert.rejects(
      runtimeFromArchive(pins, "win32-x64", cache),
      { code: "VES_BINARY_RUNTIME_ARCHIVE_INVALID", message },
      label
    );
  }

  const zip = zipOf([{ name: "w/node.exe", body: EXECUTABLE, method: 0 }, license]);
  zip.writeUInt32LE(zip.length, zip.length - 22 + 16);
  await writeFile(join(cache, "outside.zip"), zip);
  const pins = pinsFor("outside.zip", zip, { executable: "w/node.exe", license: "w/LICENSE" });
  await assert.rejects(runtimeFromArchive(pins, "win32-x64", cache), {
    code: "VES_BINARY_RUNTIME_ARCHIVE_INVALID",
    message: /lies outside the zip archive/u
  });
});

test("a NUL-terminated name ends at its first NUL, however long the padding after it", async () => {
  const cache = await scratch();
  const padded = Buffer.concat([
    Buffer.from("n/bin/node\0", "utf8"),
    Buffer.from(`ignored${"\0".repeat(64)}`.repeat(4096), "utf8")
  ]);
  const archive = tarGz([
    tarEntry("././@LongLink", padded, "L"),
    tarEntry("truncated-name", EXECUTABLE),
    tarEntry("n/LICENSE\0trailing", LICENSE)
  ]);
  await writeFile(join(cache, "node.tar.gz"), archive);
  const pins = pinsFor("node.tar.gz", archive, { executable: "n/bin/node", license: "n/LICENSE" });
  const runtime = await runtimeFromArchive(pins, "linux-x64", cache);
  assert.deepEqual(runtime.executable, EXECUTABLE);
  assert.deepEqual(runtime.license, LICENSE);
});
