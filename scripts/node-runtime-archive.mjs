// why: #236 embeds the official Node runtime, so the build must prove it holds
// exactly the bytes nodejs.org published for the target before embedding them.
// The pinned digests in apps/vestra-launcher/single-binary/node-runtime.json
// were recorded from the published SHASUMS256.txt; this module verifies an
// archive (or an installed official runtime) against them and extracts only the
// two members the binary needs. It never downloads anything.

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, gunzipSync, inflateRawSync } from "node:zlib";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const NODE_RUNTIME_PINS_PATH = "apps/vestra-launcher/single-binary/node-runtime.json";
export const SINGLE_BINARY_TARGETS = Object.freeze([
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-x64"
]);

const SHA256 = /^[a-f0-9]{64}$/u;
const NODE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const TAR_BLOCK = 512;

export class NodeRuntimeError extends Error {
  code;

  constructor(code, message, options) {
    super(message, options);
    this.name = "NodeRuntimeError";
    this.code = code;
  }
}

const fail = (code, message, cause) => {
  throw new NodeRuntimeError(code, message, cause === undefined ? undefined : { cause });
};

export const sha256Of = (bytes) => createHash("sha256").update(bytes).digest("hex");

const pinnedFile = (value, label, key) => {
  if (value === null || typeof value !== "object" || !SHA256.test(value.sha256) || typeof value[key] !== "string")
    fail("VES_BINARY_RUNTIME_PINS_INVALID", `${label} is not a pinned file`);
  return Object.freeze({ [key]: value[key], sha256: value.sha256 });
};

function pinnedTarget(value, target) {
  if (value === null || typeof value !== "object")
    fail("VES_BINARY_RUNTIME_PINS_INVALID", `the runtime pins name no ${target} entry`);
  return Object.freeze({
    archive: pinnedFile(value.archive, `${target} archive`, "fileName"),
    executable: pinnedFile(value.executable, `${target} executable`, "member"),
    licenseFile: pinnedFile(value.licenseFile, `${target} license`, "member")
  });
}

/**
 * invariant: the pins name exactly the five supported targets and one exact
 * Node version, so a target the fleet does not qualify can never be built.
 */
export function parseNodeRuntimePins(document) {
  if (document?.schemaVersion !== 1 || document.runtime !== "node" || !NODE_VERSION.test(document.version))
    fail("VES_BINARY_RUNTIME_PINS_INVALID", "the runtime pins are not a schema-1 Node runtime declaration");
  const keys = Object.keys(document.targets ?? {}).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...SINGLE_BINARY_TARGETS]))
    fail("VES_BINARY_RUNTIME_PINS_INVALID", "the runtime pins do not name exactly the supported targets");
  const targets = Object.fromEntries(keys.map((key) => [key, pinnedTarget(document.targets[key], key)]));
  return Object.freeze({
    version: document.version,
    distributionBaseUrl: document.distributionBaseUrl,
    shasumsUrl: document.shasumsUrl,
    license: document.license,
    targets: Object.freeze(targets)
  });
}

export async function loadNodeRuntimePins(root = ROOT) {
  const bytes = await readFile(join(root, ...NODE_RUNTIME_PINS_PATH.split("/")));
  return Object.freeze({ ...parseNodeRuntimePins(JSON.parse(bytes.toString("utf8"))), digest: sha256Of(bytes) });
}

const tarField = (header, offset, length) =>
  header
    .subarray(offset, offset + length)
    .toString("utf8")
    .replace(/\0.*$/su, "");

function tarSize(header) {
  const raw = tarField(header, 124, 12).trim();
  if (!/^[0-7]+$/u.test(raw)) fail("VES_BINARY_RUNTIME_ARCHIVE_INVALID", "a tar entry has no octal size");
  return Number.parseInt(raw, 8);
}

function paxPath(body) {
  const match = /(?:^|\n)\d+ path=([^\n]*)\n/u.exec(body.toString("utf8"));
  return match?.[1];
}

function tarName(header, pending) {
  if (pending !== undefined) return pending;
  const name = tarField(header, 0, 100);
  const prefix = tarField(header, 345, 155);
  return prefix.length > 0 ? `${prefix}/${name}` : name;
}

/** why: GNU and pax long names both precede the entry they rename. */
function nextPendingName(type, body, pending) {
  if (type === "x") return paxPath(body) ?? pending;
  if (type === "L") return tarField(body, 0, body.length);
  return undefined;
}

function tarMembers(tar, wanted) {
  const found = new Map();
  let pending;
  for (let at = 0; at + TAR_BLOCK <= tar.length;) {
    const header = tar.subarray(at, at + TAR_BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const size = tarSize(header);
    const type = String.fromCharCode(header[156]);
    const body = tar.subarray(at + TAR_BLOCK, at + TAR_BLOCK + size);
    const name = tarName(header, pending);
    pending = nextPendingName(type, body, pending);
    if ((type === "0" || type === "\0") && wanted.includes(name)) found.set(name, Buffer.from(body));
    at += TAR_BLOCK + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
  }
  return found;
}

function zipDirectoryOffset(zip) {
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 0xffff); at -= 1) {
    if (zip.readUInt32LE(at) === 0x06054b50)
      return { entries: zip.readUInt16LE(at + 10), offset: zip.readUInt32LE(at + 16) };
  }
  return fail("VES_BINARY_RUNTIME_ARCHIVE_INVALID", "the zip archive has no central directory");
}

function zipEntryBytes(zip, entry) {
  if (zip.readUInt32LE(entry.local) !== 0x04034b50)
    fail("VES_BINARY_RUNTIME_ARCHIVE_INVALID", "a zip entry has no local header");
  const start = entry.local + 30 + zip.readUInt16LE(entry.local + 26) + zip.readUInt16LE(entry.local + 28);
  const stored = zip.subarray(start, start + entry.compressedSize);
  const bytes = entry.method === 0 ? Buffer.from(stored) : entry.method === 8 ? inflateRawSync(stored) : undefined;
  if (bytes === undefined || bytes.length !== entry.size || crc32(bytes) !== entry.crc)
    fail("VES_BINARY_RUNTIME_ARCHIVE_INVALID", "a zip entry does not decode to its recorded bytes");
  return bytes;
}

function zipMembers(zip, wanted) {
  const found = new Map();
  const directory = zipDirectoryOffset(zip);
  for (let index = 0, at = directory.offset; index < directory.entries; index += 1) {
    if (zip.readUInt32LE(at) !== 0x02014b50)
      fail("VES_BINARY_RUNTIME_ARCHIVE_INVALID", "a zip directory entry is invalid");
    const nameLength = zip.readUInt16LE(at + 28);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    const entry = {
      method: zip.readUInt16LE(at + 10),
      crc: zip.readUInt32LE(at + 16),
      compressedSize: zip.readUInt32LE(at + 20),
      size: zip.readUInt32LE(at + 24),
      local: zip.readUInt32LE(at + 42)
    };
    if (wanted.includes(name)) found.set(name, zipEntryBytes(zip, entry));
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return found;
}

function verifiedMember(members, pin) {
  const bytes = members.get(pin.member);
  if (bytes === undefined) fail("VES_BINARY_RUNTIME_ARCHIVE_INVALID", `the archive does not contain ${pin.member}`);
  if (sha256Of(bytes) !== pin.sha256)
    fail("VES_BINARY_RUNTIME_DIGEST_MISMATCH", `${pin.member} does not match its pinned digest`);
  return bytes;
}

async function readRequired(path, what) {
  try {
    return await readFile(path);
  } catch (error) {
    return fail("VES_BINARY_RUNTIME_UNAVAILABLE", `${what} is not available`, error);
  }
}

/**
 * invariant: the archive is found by its pinned file name and trusted only if
 * its SHA-256 matches the pin; each extracted member is then checked against
 * its own pinned digest as well, so a repacked archive cannot pass either.
 */
export async function runtimeFromArchive(pins, target, cacheDirectory) {
  const pin = pins.targets[target];
  const archive = await readRequired(join(resolve(cacheDirectory), pin.archive.fileName), "the pinned Node archive");
  if (sha256Of(archive) !== pin.archive.sha256)
    fail("VES_BINARY_RUNTIME_DIGEST_MISMATCH", `${pin.archive.fileName} does not match its pinned SHA-256`);
  const wanted = [pin.executable.member, pin.licenseFile.member];
  const members = pin.archive.fileName.endsWith(".zip")
    ? zipMembers(archive, wanted)
    : tarMembers(gunzipSync(archive), wanted);
  return Object.freeze({
    verifiedBy: "archive",
    executable: verifiedMember(members, pin.executable),
    license: verifiedMember(members, pin.licenseFile)
  });
}

/**
 * why: an air-gapped builder may hold an installed official runtime rather
 * than its archive. The executable and the LICENSE beside it are accepted only
 * if both match the digests recorded from that same archive, so this path
 * embeds exactly the bytes the archive path would.
 */
export async function runtimeFromInstallation(pins, target, executablePath) {
  const pin = pins.targets[target];
  const executable = await readRequired(resolve(executablePath), "the installed Node executable");
  if (sha256Of(executable) !== pin.executable.sha256)
    fail("VES_BINARY_RUNTIME_DIGEST_MISMATCH", "the installed Node executable is not the pinned official binary");
  const installRoot = target.startsWith("win32-")
    ? dirname(resolve(executablePath))
    : dirname(dirname(resolve(executablePath)));
  const license = await readRequired(join(installRoot, "LICENSE"), "the installed Node LICENSE");
  if (sha256Of(license) !== pin.licenseFile.sha256)
    fail("VES_BINARY_RUNTIME_DIGEST_MISMATCH", "the installed Node LICENSE is not the pinned official file");
  return Object.freeze({ verifiedBy: "installation", executable, license });
}
