// why: minimal, synthetic executables in each format the single-binary injector
// accepts. They are laid out the way the official Node runtimes are — a signed
// Mach-O whose __LINKEDIT ends the file, an ELF whose first load segment
// leaves slack before the next page, a signed PE32+ with a resource tree — but
// they are a few kilobytes, so every injection branch, including the ones only
// a Windows or Linux runner could execute for real, is exercised on any host.
//
// Each executable carries exactly one unflipped SEA fuse unless a case asks
// otherwise.

import { Buffer } from "node:buffer";

import { SEA_FUSE } from "../../scripts/sea-inject.mjs";

export const FUSE_UNSET = Buffer.from(`${SEA_FUSE}:0`, "latin1");

const u64 = (buffer, offset, value) => buffer.writeBigUInt64LE(BigInt(value), offset);

function withFuse(buffer, offset, fuses) {
  for (let index = 0; index < fuses; index += 1) FUSE_UNSET.copy(buffer, offset + index * (FUSE_UNSET.length + 8));
  return buffer;
}

function machoSegment(name, vmaddr, vmsize, fileoff, filesize, sections = []) {
  const command = Buffer.alloc(72 + sections.length * 80);
  command.writeUInt32LE(0x19, 0);
  command.writeUInt32LE(command.length, 4);
  command.write(name, 8, "latin1");
  u64(command, 24, vmaddr);
  u64(command, 32, vmsize);
  u64(command, 40, fileoff);
  u64(command, 48, filesize);
  command.writeUInt32LE(5, 56);
  command.writeUInt32LE(5, 60);
  command.writeUInt32LE(sections.length, 64);
  sections.forEach((section, index) => {
    const at = 72 + index * 80;
    command.write(section.name, at, "latin1");
    command.write(name, at + 16, "latin1");
    u64(command, at + 32, section.addr);
    u64(command, at + 40, section.size);
    command.writeUInt32LE(section.offset, at + 48);
  });
  return command;
}

function linkeditCommand(cmd, dataoff, datasize) {
  const command = Buffer.alloc(16);
  command.writeUInt32LE(cmd, 0);
  command.writeUInt32LE(16, 4);
  command.writeUInt32LE(dataoff, 8);
  command.writeUInt32LE(datasize, 12);
  return command;
}

/**
 * invariant: a signed thin arm64 Mach-O: __PAGEZERO, __TEXT (one section at 0x4000),
 * __LINKEDIT at 0x8000 holding a symbol table and a code signature that ends
 * the file.
 */
export function syntheticMachO(options = {}) {
  const symtab = Buffer.alloc(24);
  symtab.writeUInt32LE(0x2, 0);
  symtab.writeUInt32LE(24, 4);
  symtab.writeUInt32LE(0x8000, 8);
  symtab.writeUInt32LE(0x8010, 16);
  symtab.writeUInt32LE(0x10, 20);
  const commands = [
    machoSegment("__PAGEZERO", 0, 0x100000000, 0, 0),
    machoSegment("__TEXT", 0x100000000, 0x8000, 0, 0x8000, [
      { name: "__text", addr: 0x100004000, size: 0x200, offset: 0x4000 }
    ]),
    machoSegment("__LINKEDIT", 0x100008000, 0x4000, 0x8000, 0x40),
    symtab,
    ...(options.extraCommand === undefined ? [] : [options.extraCommand]),
    linkeditCommand(0x1d, options.signatureOffset ?? 0x8020, 0x20)
  ];
  const commandBytes = Buffer.concat(commands);
  const bytes = Buffer.alloc(0x8040);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(0x0100000c, 4);
  bytes.writeUInt32LE(2, 12);
  bytes.writeUInt32LE(commands.length, 16);
  bytes.writeUInt32LE(commandBytes.length, 20);
  commandBytes.copy(bytes, 32);
  bytes.fill(0xaa, 0x8000, 0x8040);
  return withFuse(bytes, 0x4010, options.fuses ?? 1);
}

function programHeader(table, index, header) {
  const at = index * 56;
  table.writeUInt32LE(header.type, at);
  table.writeUInt32LE(header.flags, at + 4);
  u64(table, at + 8, header.offset);
  u64(table, at + 16, header.vaddr);
  u64(table, at + 24, header.vaddr);
  u64(table, at + 32, header.filesz);
  u64(table, at + 40, header.filesz);
  u64(table, at + 48, header.align);
}

/**
 * invariant: a non-PIE aarch64 ELF: PT_PHDR, a read-only first load segment ending at
 * `firstSize`, and an executable load segment at 0x1000 that holds the fuse.
 */
export function syntheticElf(options = {}) {
  const firstSize = options.firstSize ?? 0x200;
  const headers = [
    { type: 6, flags: 4, offset: 64, vaddr: 0x400040, filesz: 3 * 56, align: 8 },
    { type: 1, flags: 4, offset: 0, vaddr: 0x400000, filesz: firstSize, align: 0x1000 },
    { type: 1, flags: 5, offset: 0x1000, vaddr: 0x401000, filesz: 0x100, align: 0x1000 }
  ];
  const bytes = Buffer.alloc(0x1100);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]).copy(bytes, 0);
  bytes.writeUInt16LE(2, 16);
  bytes.writeUInt16LE(0xb7, 18);
  bytes.writeUInt32LE(1, 20);
  u64(bytes, 32, 64);
  bytes.writeUInt16LE(64, 52);
  bytes.writeUInt16LE(56, 54);
  bytes.writeUInt16LE(headers.length, 56);
  const table = Buffer.alloc(headers.length * 56);
  headers.forEach((header, index) => programHeader(table, index, header));
  table.copy(bytes, 64);
  bytes.fill(0x11, 64 + table.length, Math.min(firstSize, 0x1000));
  return withFuse(bytes, 0x1010, options.fuses ?? 1);
}

// invariant: one RT_VERSION (16) resource, id 1, language 1033, whose data RVA
// the PE injection test proves is carried into the rebuilt tree unchanged.
function versionResources(sectionRva) {
  const tree = Buffer.alloc(0x80);
  const directory = (at, id, child) => {
    tree.writeUInt16LE(1, at + 14);
    tree.writeUInt32LE(id, at + 16);
    tree.writeUInt32LE(child, at + 20);
  };
  directory(0x00, 16, (0x80000000 | 0x18) >>> 0);
  directory(0x18, 1, (0x80000000 | 0x30) >>> 0);
  directory(0x30, 1033, 0x48);
  tree.writeUInt32LE(sectionRva + 0x60, 0x48);
  tree.writeUInt32LE(4, 0x4c);
  tree.write("VERS", 0x60, "latin1");
  return tree;
}

/**
 * invariant: a signed PE32+ image: `.text` at file 0x200, `.rsrc` at 0x400 holding a
 * version resource, and a certificate table at 0x600 that ends the file at
 * 0x610 unless `overlay` appends bytes nothing in the layout explains.
 */
export function syntheticPe(options = {}) {
  const bytes = Buffer.alloc(0x610 + (options.overlay ?? 0));
  bytes.writeUInt16LE(0x5a4d, 0);
  bytes.writeUInt32LE(0x40, 0x3c);
  bytes.writeUInt32LE(0x4550, 0x40);
  const coff = 0x44;
  bytes.writeUInt16LE(0x8664, coff);
  bytes.writeUInt16LE(2, coff + 2);
  bytes.writeUInt16LE(240, coff + 16);
  const optional = coff + 20;
  bytes.writeUInt16LE(0x20b, optional);
  bytes.writeUInt32LE(0x1000, optional + 32);
  bytes.writeUInt32LE(0x200, optional + 36);
  bytes.writeUInt32LE(0x3000, optional + 56);
  bytes.writeUInt32LE(0x200, optional + 60);
  bytes.writeUInt32LE(0x1234, optional + 64);
  bytes.writeUInt32LE(16, optional + 108);
  bytes.writeUInt32LE(0x2000, optional + 112 + 2 * 8);
  bytes.writeUInt32LE(0x60, optional + 116 + 2 * 8);
  bytes.writeUInt32LE(0x600, optional + 112 + 4 * 8);
  bytes.writeUInt32LE(0x10, optional + 116 + 4 * 8);
  const sections = optional + 240;
  for (const [index, name, virtualAddress, rawPointer] of [
    [0, ".text", 0x1000, 0x200],
    [1, ".rsrc", 0x2000, 0x400]
  ]) {
    const at = sections + index * 40;
    bytes.write(name, at, "latin1");
    bytes.writeUInt32LE(0x100, at + 8);
    bytes.writeUInt32LE(virtualAddress, at + 12);
    bytes.writeUInt32LE(0x200, at + 16);
    bytes.writeUInt32LE(rawPointer, at + 20);
    bytes.writeUInt32LE(0x40000040, at + 36);
  }
  versionResources(0x2000).copy(bytes, 0x400);
  bytes.fill(0xcc, 0x600, bytes.length);
  return withFuse(bytes, 0x210, options.fuses ?? 1);
}

export const peLayout = Object.freeze({ optional: 0x44 + 20, versionDataRva: 0x2060 });
