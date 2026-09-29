import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { test } from "node:test";

import { SEA_FUSE, executableFormatOf, injectSeaBlob, locateSeaBlob } from "../../scripts/sea-inject.mjs";
import { FUSE_UNSET, peLayout, syntheticElf, syntheticMachO, syntheticPe } from "../helpers/sea-executable-fixture.mjs";

// why: the injector is the one piece of #236 written against binary formats
// rather than a library, and two of its three formats can only execute on a
// Windows or Linux runner. These cases pin every layout decision to a
// synthetic executable on any host, and each fail-closed branch to the exact
// code it must raise, so a regression is caught here before a runner ever
// tries to start a corrupted binary.

const BLOB = Buffer.from("synthetic single executable blob\0with an odd length", "latin1");
const FUSE_SET = Buffer.from(`${SEA_FUSE}:1`, "latin1");

const count = (bytes, needle) => {
  let found = 0;
  for (let at = bytes.indexOf(needle); at !== -1; at = bytes.indexOf(needle, at + 1)) found += 1;
  return found;
};

const FORMATS = Object.freeze([
  ["mach-o", syntheticMachO],
  ["elf", syntheticElf],
  ["pe", syntheticPe]
]);

for (const [format, build] of FORMATS) {
  test(`${format}: the injected blob is recovered byte for byte and the fuse is flipped once`, () => {
    const original = build();
    const pristine = Buffer.from(original);
    const injected = injectSeaBlob(original, BLOB);

    assert.equal(executableFormatOf(injected), format);
    const located = locateSeaBlob(injected);
    assert.equal(located.format, format);
    assert.deepEqual(located.blob, BLOB);
    assert.equal(count(injected, FUSE_SET), 1);
    assert.equal(count(injected, FUSE_UNSET), 0);
    assert.deepEqual(original, pristine, "injection must never modify its input");
  });

  test(`${format}: injection is deterministic`, () => {
    assert.deepEqual(injectSeaBlob(build(), BLOB), injectSeaBlob(build(), BLOB));
  });

  test(`${format}: a runtime that was already injected is refused`, () => {
    const injected = injectSeaBlob(build(), BLOB);
    assert.throws(() => injectSeaBlob(injected, BLOB), { code: "VES_SEA_ALREADY_INJECTED" });
  });

  test(`${format}: a runtime without exactly one fuse is refused`, () => {
    for (const fuses of [0, 2]) {
      assert.throws(() => injectSeaBlob(build({ fuses }), BLOB), { code: "VES_SEA_FUSE_INVALID" }, `${fuses} fuses`);
    }
  });

  test(`${format}: an executable with no injected blob is never reported as carrying one`, () => {
    assert.throws(() => locateSeaBlob(build()), { code: "VES_SEA_FUSE_INVALID" });
  });
}

test("mach-o: the signature is dropped and every __LINKEDIT offset moves past the blob", () => {
  const injected = injectSeaBlob(syntheticMachO(), BLOB);
  const commands = [];
  for (let index = 0, at = 32; index < injected.readUInt32LE(16); index += 1) {
    commands.push({ cmd: injected.readUInt32LE(at), at, name: injected.subarray(at + 8, at + 24).toString("latin1") });
    at += injected.readUInt32LE(at + 4);
  }
  assert.equal(commands.filter((command) => command.cmd === 0x1d).length, 0, "no stale code signature survives");
  const segments = commands
    .filter((command) => command.cmd === 0x19)
    .map((command) => command.name.replace(/\0+$/u, ""));
  assert.deepEqual(
    segments,
    ["__PAGEZERO", "__TEXT", "NODE_SEA", "__LINKEDIT"],
    "NODE_SEA sits immediately before __LINKEDIT"
  );
  const symtab = commands.find((command) => command.cmd === 0x2);
  assert.equal(injected.readUInt32LE(symtab.at + 8), 0x8000 + 0x4000, "the symbol table moved by one 16 KiB page");
  assert.equal(injected.readUInt32LE(symtab.at + 16), 0x8010 + 0x4000, "the string table moved by one 16 KiB page");
  assert.equal(injected.length, 0x8020 + 0x4000, "the file ends where the unsigned __LINKEDIT ends");
});

test("mach-o: an unknown load command fails closed instead of being copied", () => {
  const note = Buffer.alloc(40);
  note.writeUInt32LE(0x31, 0);
  note.writeUInt32LE(40, 4);
  assert.throws(() => injectSeaBlob(syntheticMachO({ extraCommand: note }), BLOB), {
    code: "VES_SEA_MACHO_COMMAND_UNSUPPORTED"
  });
});

test("mach-o: a code signature that does not end the file is refused", () => {
  assert.throws(() => injectSeaBlob(syntheticMachO({ signatureOffset: 0x8010 }), BLOB), {
    code: "VES_SEA_LAYOUT_INVALID"
  });
});

test("elf: the program header table moves into the first segment's slack and gains a load and a note", () => {
  const injected = injectSeaBlob(syntheticElf(), BLOB);
  const phoff = Number(injected.readBigUInt64LE(32));
  const phnum = injected.readUInt16LE(56);
  assert.equal(phoff, 0x200, "the table moved to the first free, 8-byte-aligned offset");
  assert.equal(phnum, 5);
  const headers = Array.from({ length: phnum }, (_, index) => {
    const at = phoff + index * 56;
    return {
      type: injected.readUInt32LE(at),
      offset: Number(injected.readBigUInt64LE(at + 8)),
      vaddr: Number(injected.readBigUInt64LE(at + 16)),
      filesz: Number(injected.readBigUInt64LE(at + 32)),
      align: Number(injected.readBigUInt64LE(at + 48))
    };
  });
  assert.deepEqual(
    headers.map((header) => header.type),
    [6, 1, 1, 1, 4],
    "PT_PHDR first, the new load after the last load, the note last"
  );
  assert.deepEqual(headers[0], { type: 6, offset: 0x200, vaddr: 0x400200, filesz: 5 * 56, align: 8 });
  assert.equal(headers[1].filesz, 0x200 + 5 * 56, "the first load segment grew to cover the moved table");
  assert.equal(headers[3].offset % 0x10000, 0, "the new load segment is 64 KiB aligned in the file");
  assert.equal(headers[3].vaddr % 0x10000, 0, "and in memory");
  assert.equal(headers[3].align, 0x10000);
  assert.equal(headers[4].offset, headers[3].offset, "the note is exactly the new load segment's content");
});

test("elf: a first load segment without room for the grown table is refused", () => {
  assert.throws(() => injectSeaBlob(syntheticElf({ firstSize: 0x1000 - 10 }), BLOB), {
    code: "VES_SEA_LAYOUT_INVALID"
  });
});

test("pe: the resource tree keeps every existing resource and the signature is removed", () => {
  const injected = injectSeaBlob(syntheticPe(), BLOB);
  const { optional } = peLayout;
  assert.equal(injected.readUInt16LE(0x44 + 2), 3, "one section was added");
  assert.equal(injected.readUInt32LE(optional + 112 + 4 * 8), 0, "the certificate directory is cleared");
  assert.equal(injected.readUInt32LE(optional + 116 + 4 * 8), 0);
  const resourceRva = injected.readUInt32LE(optional + 112 + 2 * 8);
  assert.equal(resourceRva, 0x3000, "the rebuilt tree lives in the new section after .rsrc");
  const sectionAt = optional + 240 + 2 * 40;
  assert.equal(injected.subarray(sectionAt, sectionAt + 4).toString("latin1"), ".sea");
  assert.equal(injected.readUInt32LE(sectionAt + 20), 0x600, "the new section starts where the signature was");
  assert.equal(injected.readUInt32LE(optional + 56), 0x4000, "SizeOfImage covers the new section");

  const tree = injected.readUInt32LE(sectionAt + 20);
  const entries = (at) =>
    Array.from(
      { length: injected.readUInt16LE(tree + at + 12) + injected.readUInt16LE(tree + at + 14) },
      (_, index) => ({
        name: injected.readUInt32LE(tree + at + 16 + index * 8),
        child: injected.readUInt32LE(tree + at + 20 + index * 8)
      })
    );
  const root = entries(0);
  assert.deepEqual(
    root.map((entry) => entry.name),
    [10, 16],
    "RT_RCDATA joins RT_VERSION in ascending id order"
  );
  const version = entries(entries(root[1].child & 0x7fffffff)[0].child & 0x7fffffff)[0];
  assert.equal(
    injected.readUInt32LE(tree + version.child),
    peLayout.versionDataRva,
    "the version resource is untouched"
  );
});

test("pe: the image checksum is recomputed over the final bytes", () => {
  const injected = injectSeaBlob(syntheticPe(), BLOB);
  const checksumAt = peLayout.optional + 64;
  const stored = injected.readUInt32LE(checksumAt);
  const copy = Buffer.from(injected);
  copy.writeUInt32LE(0, checksumAt);
  let sum = 0;
  for (let at = 0; at < copy.length; at += 2) {
    sum += copy.readUInt16LE(at);
    sum = (sum & 0xffff) + (sum >>> 16);
  }
  assert.equal(stored, ((sum & 0xffff) + (sum >>> 16) + copy.length) >>> 0);
  assert.notEqual(stored, 0x1234, "the original checksum is not carried over");
});

test("pe: bytes after the certificate table fail closed", () => {
  assert.throws(() => injectSeaBlob(syntheticPe({ overlay: 0x20 }), BLOB), { code: "VES_SEA_LAYOUT_INVALID" });
});

test("an unrecognized or empty input is refused before anything is parsed", () => {
  assert.throws(() => executableFormatOf(Buffer.from("#!/bin/sh\n")), { code: "VES_SEA_FORMAT_UNSUPPORTED" });
  assert.throws(() => injectSeaBlob(syntheticElf(), Buffer.alloc(0)), { code: "VES_SEA_INPUT_INVALID" });
  const fat = Buffer.alloc(64);
  fat.writeUInt32BE(0xcafebabe, 0);
  assert.throws(() => injectSeaBlob(fat, BLOB), { code: "VES_SEA_FORMAT_UNSUPPORTED" });
});
