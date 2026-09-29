// why: #236 embeds a Node single executable application (SEA) blob into the
// pinned official Node binary. Node 24.14.0 generates the blob itself
// (`--experimental-sea-config`) but ships no injector: `--build-sea` first
// appears in a later major, and the documented injector, `postject`, is an npm
// dependency this repository does not carry. The injection is therefore
// implemented here, against the exact lookup rules the pinned runtime compiles
// in (deps/postject/postject-api.h and src/node_sea_bin.cc at v24.14.0):
//
// - Mach-O: section `__NODE_SEA_BLOB` in segment `NODE_SEA`, found with
//   `getsectdata`;
// - ELF: a note named `NODE_SEA_BLOB` inside a `PT_NOTE` segment of the loaded
//   main program, found with `dl_iterate_phdr`;
// - PE: an `RT_RCDATA` resource named `NODE_SEA_BLOB`, found with
//   `FindResourceA`;
//
// and, on every format, the sentinel fuse flipped from `:0` to `:1`.
//
// invariant: every injector is total over its input — it either returns an
// executable whose blob the matching locator below recovers byte for byte, or
// it throws a `SeaInjectionError`. Nothing is guessed: an unknown load command,
// a missing gap, or trailing bytes the layout does not explain fail closed.

import { Buffer } from "node:buffer";

export const SEA_RESOURCE_NAME = "NODE_SEA_BLOB";
export const SEA_MACHO_SEGMENT = "NODE_SEA";
export const SEA_MACHO_SECTION = "__NODE_SEA_BLOB";
export const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

export class SeaInjectionError extends Error {
  code;

  constructor(code, message) {
    super(message);
    this.name = "SeaInjectionError";
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new SeaInjectionError(code, message);
};

const alignUp = (value, alignment) => Math.ceil(value / alignment) * alignment;
const u64 = (bytes, offset) => {
  const value = bytes.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail("VES_SEA_LAYOUT_INVALID", "a 64-bit field exceeds the safe range");
  return Number(value);
};
const writeU64 = (bytes, offset, value) => bytes.writeBigUInt64LE(BigInt(value), offset);
const cString = (bytes, offset, length) =>
  bytes
    .subarray(offset, offset + length)
    .toString("latin1")
    .replace(/\0.*$/su, "");
const inBounds = (bytes, offset, length) =>
  Number.isSafeInteger(offset) &&
  Number.isSafeInteger(length) &&
  offset >= 0 &&
  length >= 0 &&
  offset + length <= bytes.length;
const requireBounds = (bytes, offset, length, what) => {
  if (!inBounds(bytes, offset, length)) fail("VES_SEA_LAYOUT_INVALID", `${what} lies outside the executable`);
};
const allZero = (bytes) => bytes.every((byte) => byte === 0);

export function executableFormatOf(bytes) {
  if (bytes.length >= 4 && bytes.readUInt32LE(0) === 0xfeedfacf) return "mach-o";
  if (bytes.length >= 4 && bytes.readUInt32BE(0) === 0x7f454c46) return "elf";
  if (bytes.length >= 2 && bytes.readUInt16LE(0) === 0x5a4d) return "pe";
  return fail("VES_SEA_FORMAT_UNSUPPORTED", "the runtime is not a thin 64-bit Mach-O, ELF, or PE executable");
}

const fuseMarker = (state) => Buffer.from(`${SEA_FUSE}:${state}`, "latin1");

function occurrences(bytes, needle) {
  const found = [];
  for (let at = bytes.indexOf(needle); at !== -1; at = bytes.indexOf(needle, at + 1)) found.push(at);
  return found;
}

/**
 * invariant: exactly one unflipped fuse and no flipped one, or the runtime is
 * not a pristine Node binary and nothing is injected.
 */
function flipFuse(bytes) {
  if (occurrences(bytes, fuseMarker(1)).length !== 0)
    fail("VES_SEA_ALREADY_INJECTED", "the runtime already carries a flipped SEA fuse");
  const unset = occurrences(bytes, fuseMarker(0));
  if (unset.length !== 1)
    fail("VES_SEA_FUSE_INVALID", `the runtime carries ${unset.length} SEA fuses where exactly one is required`);
  const flipped = Buffer.from(bytes);
  flipped[unset[0] + fuseMarker(0).length - 1] = 0x31;
  return flipped;
}

function assertFuseFlipped(bytes) {
  if (occurrences(bytes, fuseMarker(1)).length !== 1 || occurrences(bytes, fuseMarker(0)).length !== 0)
    fail("VES_SEA_FUSE_INVALID", "the executable does not carry exactly one flipped SEA fuse");
}

const MACHO_HEADER = 32;
const LC_SEGMENT_64 = 0x19;
const LC_CODE_SIGNATURE = 0x1d;
const SEGMENT_COMMAND = 72;
const SECTION = 80;
// why: arm64 macOS maps 16 KiB pages; aligning the new segment to 16 KiB is
// also valid on x86_64, whose 4 KiB pages divide it.
const MACHO_PAGE = 0x4000;
const VM_PROT_READ = 1;
// invariant: every load command whose fields hold a file offset into
// __LINKEDIT is listed with those offsets, because inserting the blob before
// __LINKEDIT moves every one of them; a command that is neither listed here
// nor known to be offset-free fails closed instead of being copied unchanged.
const LINKEDIT_OFFSET_FIELDS = new Map([
  [0x02, [8, 16]],
  [0x0b, [32, 40, 48, 56, 64, 72]],
  [0x22, [8, 16, 24, 32, 40]],
  [0x80000022, [8, 16, 24, 32, 40]],
  [0x1d, [8]],
  [0x1e, [8]],
  [0x26, [8]],
  [0x29, [8]],
  [0x2b, [8]],
  [0x2e, [8]],
  [0x36, [8]],
  [0x80000033, [8]],
  [0x80000034, [8]]
]);
const OFFSET_FREE_COMMANDS = new Set([
  0x0c,
  0x0e,
  0x1b,
  0x24,
  0x2a,
  0x32,
  0x80000018,
  0x8000001c,
  0x8000001f,
  0x80000028,
  LC_SEGMENT_64
]);

function machoSections(bytes, offset, count) {
  const sections = [];
  for (let index = 0; index < count; index += 1) {
    const at = offset + SEGMENT_COMMAND + index * SECTION;
    sections.push({
      name: cString(bytes, at, 16),
      segment: cString(bytes, at + 16, 16),
      size: u64(bytes, at + 40),
      offset: bytes.readUInt32LE(at + 48)
    });
  }
  return sections;
}

function machoCommand(bytes, offset) {
  requireBounds(bytes, offset, 8, "a load command");
  const command = { offset, cmd: bytes.readUInt32LE(offset), size: bytes.readUInt32LE(offset + 4) };
  if (command.size < 8 || command.size % 8 !== 0) fail("VES_SEA_LAYOUT_INVALID", "a Mach-O load command is malformed");
  requireBounds(bytes, offset, command.size, "a load command");
  if (command.cmd !== LC_SEGMENT_64) return command;
  const nsects = bytes.readUInt32LE(offset + 64);
  if (command.size !== SEGMENT_COMMAND + nsects * SECTION)
    fail("VES_SEA_LAYOUT_INVALID", "a Mach-O segment command is malformed");
  return {
    ...command,
    segment: {
      name: cString(bytes, offset + 8, 16),
      vmaddr: u64(bytes, offset + 24),
      fileoff: u64(bytes, offset + 40),
      filesize: u64(bytes, offset + 48),
      sections: machoSections(bytes, offset, nsects)
    }
  };
}

function parseMachO(bytes) {
  if (bytes.length < MACHO_HEADER || bytes.readUInt32LE(0) !== 0xfeedfacf)
    fail("VES_SEA_FORMAT_UNSUPPORTED", "the runtime is not a thin 64-bit little-endian Mach-O executable");
  const count = bytes.readUInt32LE(16);
  const sizeOfCommands = bytes.readUInt32LE(20);
  const commands = [];
  let offset = MACHO_HEADER;
  for (let index = 0; index < count; index += 1) {
    const command = machoCommand(bytes, offset);
    commands.push(command);
    offset += command.size;
  }
  if (offset !== MACHO_HEADER + sizeOfCommands) fail("VES_SEA_LAYOUT_INVALID", "Mach-O load commands are inconsistent");
  return { commands, sizeOfCommands };
}

const machoSegments = (parsed) => parsed.commands.filter((command) => command.segment !== undefined);

// invariant: load commands may grow only into the bytes before the first
// file-backed section, which the loader never reads as section content.
function machoHeaderCapacity(parsed) {
  const offsets = machoSegments(parsed)
    .flatMap((command) => command.segment.sections)
    .filter((section) => section.offset > 0 && section.size > 0)
    .map((section) => section.offset);
  if (offsets.length === 0) fail("VES_SEA_LAYOUT_INVALID", "the Mach-O executable has no file-backed section");
  return Math.min(...offsets);
}

function machoLinkedit(bytes, parsed) {
  const segments = machoSegments(parsed);
  if (segments.some((command) => command.segment.name === SEA_MACHO_SEGMENT))
    fail("VES_SEA_ALREADY_INJECTED", "the runtime already carries a NODE_SEA segment");
  const linkedit = segments.at(-1);
  if (linkedit?.segment.name !== "__LINKEDIT")
    fail("VES_SEA_LAYOUT_INVALID", "__LINKEDIT is not the last Mach-O segment");
  if (segments.some((command) => command.segment.fileoff > linkedit.segment.fileoff))
    fail("VES_SEA_LAYOUT_INVALID", "a Mach-O segment lies after __LINKEDIT in the file");
  if (linkedit.segment.fileoff + linkedit.segment.filesize !== bytes.length)
    fail("VES_SEA_LAYOUT_INVALID", "bytes follow __LINKEDIT that the Mach-O layout does not explain");
  return linkedit;
}

/**
 * why: the official runtime is signed, and inserting a segment invalidates
 * that signature; it is removed here and the build re-signs the result, so the
 * embedded signature always covers the bytes that actually ship.
 */
function machoUnsignedEnd(bytes, parsed) {
  const signature = parsed.commands.find((command) => command.cmd === LC_CODE_SIGNATURE);
  if (signature === undefined) return bytes.length;
  const dataoff = bytes.readUInt32LE(signature.offset + 8);
  if (dataoff + bytes.readUInt32LE(signature.offset + 12) !== bytes.length)
    fail("VES_SEA_LAYOUT_INVALID", "the Mach-O code signature is not the final __LINKEDIT payload");
  return dataoff;
}

function machoSeaSegment(vmaddr, fileoff, span, blobLength) {
  const command = Buffer.alloc(SEGMENT_COMMAND + SECTION);
  command.writeUInt32LE(LC_SEGMENT_64, 0);
  command.writeUInt32LE(command.length, 4);
  command.write(SEA_MACHO_SEGMENT, 8, "latin1");
  writeU64(command, 24, vmaddr);
  writeU64(command, 32, span);
  writeU64(command, 40, fileoff);
  writeU64(command, 48, span);
  command.writeUInt32LE(VM_PROT_READ, 56);
  command.writeUInt32LE(VM_PROT_READ, 60);
  command.writeUInt32LE(1, 64);
  command.write(SEA_MACHO_SECTION, SEGMENT_COMMAND, "latin1");
  command.write(SEA_MACHO_SEGMENT, SEGMENT_COMMAND + 16, "latin1");
  writeU64(command, SEGMENT_COMMAND + 32, vmaddr);
  writeU64(command, SEGMENT_COMMAND + 40, blobLength);
  command.writeUInt32LE(fileoff, SEGMENT_COMMAND + 48);
  return command;
}

function shiftLinkeditOffsets(command, linkeditFileoff, span) {
  const fields = LINKEDIT_OFFSET_FIELDS.get(command.readUInt32LE(0));
  if (fields === undefined) return;
  for (const field of fields) {
    const value = command.readUInt32LE(field);
    if (value === 0) continue;
    if (value < linkeditFileoff) fail("VES_SEA_LAYOUT_INVALID", "a __LINKEDIT offset points before __LINKEDIT");
    if (value + span > 0xffffffff) fail("VES_SEA_LAYOUT_INVALID", "the injected Mach-O exceeds 32-bit offsets");
    command.writeUInt32LE(value + span, field);
  }
}

function relocatedLinkedit(bytes, linkedit, span, unsignedEnd) {
  const command = Buffer.from(bytes.subarray(linkedit.offset, linkedit.offset + linkedit.size));
  const filesize = unsignedEnd - linkedit.segment.fileoff;
  writeU64(command, 24, linkedit.segment.vmaddr + span);
  writeU64(command, 32, alignUp(filesize, MACHO_PAGE));
  writeU64(command, 40, linkedit.segment.fileoff + span);
  writeU64(command, 48, filesize);
  return command;
}

function machoCommandCopy(bytes, command, linkedit, span) {
  if (!LINKEDIT_OFFSET_FIELDS.has(command.cmd) && !OFFSET_FREE_COMMANDS.has(command.cmd))
    fail("VES_SEA_MACHO_COMMAND_UNSUPPORTED", `Mach-O load command 0x${command.cmd.toString(16)} is not understood`);
  const copy = Buffer.from(bytes.subarray(command.offset, command.offset + command.size));
  shiftLinkeditOffsets(copy, linkedit.segment.fileoff, span);
  return copy;
}

function machoCommands(bytes, parsed, linkedit, span, blobLength, unsignedEnd) {
  const commands = [];
  for (const command of parsed.commands) {
    if (command.cmd === LC_CODE_SIGNATURE) continue;
    if (command.offset !== linkedit.offset) {
      commands.push(machoCommandCopy(bytes, command, linkedit, span));
      continue;
    }
    commands.push(machoSeaSegment(linkedit.segment.vmaddr, linkedit.segment.fileoff, span, blobLength));
    commands.push(relocatedLinkedit(bytes, linkedit, span, unsignedEnd));
  }
  return commands;
}

export function injectMachO(executable, blob) {
  const bytes = flipFuse(executable);
  const parsed = parseMachO(bytes);
  const linkedit = machoLinkedit(bytes, parsed);
  const unsignedEnd = machoUnsignedEnd(bytes, parsed);
  const capacity = machoHeaderCapacity(parsed);
  if (!allZero(bytes.subarray(MACHO_HEADER + parsed.sizeOfCommands, capacity)))
    fail("VES_SEA_LAYOUT_INVALID", "the Mach-O header padding is not free");
  const span = alignUp(blob.length, MACHO_PAGE);
  const commands = machoCommands(bytes, parsed, linkedit, span, blob.length, unsignedEnd);
  const commandBytes = Buffer.concat(commands);
  if (MACHO_HEADER + commandBytes.length > capacity)
    fail("VES_SEA_LAYOUT_INVALID", "the Mach-O header has no room for the NODE_SEA segment");
  const header = Buffer.alloc(capacity);
  bytes.copy(header, 0, 0, MACHO_HEADER);
  header.writeUInt32LE(commands.length, 16);
  header.writeUInt32LE(commandBytes.length, 20);
  commandBytes.copy(header, MACHO_HEADER);
  const segment = Buffer.alloc(span);
  blob.copy(segment);
  const fileoff = linkedit.segment.fileoff;
  return Buffer.concat([header, bytes.subarray(capacity, fileoff), segment, bytes.subarray(fileoff, unsignedEnd)]);
}

function locateMachO(bytes) {
  const sections = machoSegments(parseMachO(bytes))
    .filter((command) => command.segment.name === SEA_MACHO_SEGMENT)
    .flatMap((command) => command.segment.sections)
    .filter((section) => section.name === SEA_MACHO_SECTION && section.segment === SEA_MACHO_SEGMENT);
  if (sections.length !== 1) fail("VES_SEA_BLOB_MISSING", "the executable carries no single NODE_SEA section");
  requireBounds(bytes, sections[0].offset, sections[0].size, "the NODE_SEA section");
  return bytes.subarray(sections[0].offset, sections[0].offset + sections[0].size);
}

const PT_LOAD = 1;
const PT_NOTE = 4;
const PT_PHDR = 6;
const PF_R = 4;
const PHDR_SIZE = 56;
// why: 64 KiB divides every page size a supported Linux kernel uses (4, 16, and
// 64 KiB), so the new load segment is mappable on any of them.
const ELF_SEGMENT_ALIGN = 0x10000;
const PHDR_FIELDS = Object.freeze([
  ["offset", 8],
  ["vaddr", 16],
  ["paddr", 24],
  ["filesz", 32],
  ["memsz", 40],
  ["align", 48]
]);

function parseElf(bytes) {
  if (bytes.length < 64 || bytes.readUInt32BE(0) !== 0x7f454c46 || bytes[4] !== 2 || bytes[5] !== 1)
    fail("VES_SEA_FORMAT_UNSUPPORTED", "the runtime is not a 64-bit little-endian ELF executable");
  const type = bytes.readUInt16LE(16);
  if ((type !== 2 && type !== 3) || bytes.readUInt16LE(54) !== PHDR_SIZE)
    fail("VES_SEA_FORMAT_UNSUPPORTED", "the ELF runtime is not a loadable executable");
  const phoff = u64(bytes, 32);
  const phnum = bytes.readUInt16LE(56);
  requireBounds(bytes, phoff, phnum * PHDR_SIZE, "the ELF program header table");
  const headers = [];
  for (let index = 0; index < phnum; index += 1) {
    const at = phoff + index * PHDR_SIZE;
    const header = { type: bytes.readUInt32LE(at), flags: bytes.readUInt32LE(at + 4) };
    for (const [field, offset] of PHDR_FIELDS) header[field] = u64(bytes, at + offset);
    headers.push(header);
  }
  return { phoff, headers };
}

function encodeProgramHeaders(headers) {
  const table = Buffer.alloc(headers.length * PHDR_SIZE);
  headers.forEach((header, index) => {
    const at = index * PHDR_SIZE;
    table.writeUInt32LE(header.type, at);
    table.writeUInt32LE(header.flags, at + 4);
    for (const [field, offset] of PHDR_FIELDS) writeU64(table, at + offset, header[field]);
  });
  return table;
}

function elfNote(blob) {
  const name = Buffer.from(`${SEA_RESOURCE_NAME}\0`, "latin1");
  const nameSpan = alignUp(name.length, 4);
  const note = Buffer.alloc(12 + nameSpan + alignUp(blob.length, 4));
  note.writeUInt32LE(name.length, 0);
  note.writeUInt32LE(blob.length, 4);
  name.copy(note, 12);
  blob.copy(note, 12 + nameSpan);
  return note;
}

/**
 * why: the program header table sits between the ELF header and `.interp`, so
 * it cannot grow in place. It moves to the zero padding that ends the first
 * load segment's last page, and that segment grows to cover it; the kernel and
 * the dynamic loader both find it there, whether they read `e_phoff` relative
 * to the first load address (older kernels) or read `PT_PHDR` (newer ones).
 */
function relocatedPhdrPlacement(bytes, parsed, count) {
  const loads = parsed.headers.filter((header) => header.type === PT_LOAD);
  const first = loads.find((header) => header.offset === 0);
  if (first === undefined || first.filesz !== first.memsz)
    fail("VES_SEA_LAYOUT_INVALID", "the first ELF load segment does not start the file or carries bss");
  const firstEnd = first.filesz;
  const phoff = alignUp(firstEnd, 8);
  const end = phoff + count * PHDR_SIZE;
  requireBounds(bytes, firstEnd, end - firstEnd, "the relocated ELF program header table");
  const nextFile = Math.min(...loads.filter((header) => header.offset >= firstEnd).map((header) => header.offset));
  const nextMemory = Math.min(
    ...loads
      .filter((header) => header.vaddr > first.vaddr)
      .map((header) => header.vaddr - (header.vaddr % header.align))
  );
  if (end > nextFile || first.vaddr + end > nextMemory || !allZero(bytes.subarray(firstEnd, end)))
    fail("VES_SEA_LAYOUT_INVALID", "the first ELF load segment has no free room for the program header table");
  return { first, phoff, end };
}

function elfHeaders(parsed, placement, note, noteOffset, noteAddress) {
  const loads = parsed.headers.filter((header) => header.type === PT_LOAD);
  const lastLoad = parsed.headers.lastIndexOf(loads.at(-1));
  const segment = { flags: PF_R, offset: noteOffset, vaddr: noteAddress, paddr: noteAddress };
  const sized = { filesz: note.length, memsz: note.length };
  const headers = [];
  parsed.headers.forEach((header, index) => {
    const copy = { ...header };
    if (header.type === PT_PHDR) {
      const tableSize = (parsed.headers.length + 2) * PHDR_SIZE;
      Object.assign(copy, { offset: placement.phoff, filesz: tableSize, memsz: tableSize });
      Object.assign(copy, {
        vaddr: placement.first.vaddr + placement.phoff,
        paddr: placement.first.paddr + placement.phoff
      });
    }
    if (header === placement.first) Object.assign(copy, { filesz: placement.end, memsz: placement.end });
    headers.push(copy);
    if (index === lastLoad) headers.push({ type: PT_LOAD, ...segment, ...sized, align: ELF_SEGMENT_ALIGN });
  });
  headers.push({ type: PT_NOTE, ...segment, ...sized, align: 4 });
  return headers;
}

export function injectElf(executable, blob) {
  const bytes = flipFuse(executable);
  const parsed = parseElf(bytes);
  if (elfSeaNotes(bytes, parsed).length !== 0)
    fail("VES_SEA_ALREADY_INJECTED", "the runtime already carries a NODE_SEA_BLOB note");
  const placement = relocatedPhdrPlacement(bytes, parsed, parsed.headers.length + 2);
  const note = elfNote(blob);
  const noteOffset = alignUp(bytes.length, ELF_SEGMENT_ALIGN);
  const loads = parsed.headers.filter((header) => header.type === PT_LOAD);
  const noteAddress = alignUp(Math.max(...loads.map((header) => header.vaddr + header.memsz)), ELF_SEGMENT_ALIGN);
  const table = encodeProgramHeaders(elfHeaders(parsed, placement, note, noteOffset, noteAddress));
  const output = Buffer.concat([bytes, Buffer.alloc(noteOffset - bytes.length), note]);
  table.copy(output, placement.phoff);
  writeU64(output, 32, placement.phoff);
  output.writeUInt16LE(table.length / PHDR_SIZE, 56);
  return output;
}

/** invariant: a note counts only if a load segment maps it where it claims to live. */
function mappedNoteRange(parsed, note) {
  return parsed.headers.some(
    (load) =>
      load.type === PT_LOAD &&
      load.vaddr <= note.vaddr &&
      note.vaddr + note.memsz <= load.vaddr + load.filesz &&
      note.offset - load.offset === note.vaddr - load.vaddr
  );
}

function notesIn(bytes, header) {
  const notes = [];
  let at = header.offset;
  const end = header.offset + header.filesz;
  requireBounds(bytes, header.offset, header.filesz, "an ELF note segment");
  while (at + 12 <= end) {
    const nameSize = bytes.readUInt32LE(at);
    const descSize = bytes.readUInt32LE(at + 4);
    const descAt = at + 12 + alignUp(nameSize, 4);
    notes.push({ name: cString(bytes, at + 12, nameSize), descAt, descSize });
    at = descAt + alignUp(descSize, 4);
  }
  return notes;
}

function elfSeaNotes(bytes, parsed) {
  return parsed.headers
    .filter((header) => header.type === PT_NOTE && mappedNoteRange(parsed, header))
    .flatMap((header) => notesIn(bytes, header))
    .filter((note) => note.name === SEA_RESOURCE_NAME && note.descSize > 0);
}

function locateElf(bytes) {
  const notes = elfSeaNotes(bytes, parseElf(bytes));
  if (notes.length !== 1) fail("VES_SEA_BLOB_MISSING", "the executable carries no single mapped NODE_SEA_BLOB note");
  requireBounds(bytes, notes[0].descAt, notes[0].descSize, "the NODE_SEA_BLOB note");
  return bytes.subarray(notes[0].descAt, notes[0].descAt + notes[0].descSize);
}

const RT_RCDATA = 10;
const SECTION_HEADER = 40;
const RESOURCE_DIRECTORY = 2;
const SECURITY_DIRECTORY = 4;
const IMAGE_SCN_INITIALIZED_READ = 0x40000040;
const SEA_SECTION_NAME = ".sea";
const MAX_RESOURCE_DEPTH = 3;

function parsePe(bytes) {
  if (bytes.length < 0x40 || bytes.readUInt16LE(0) !== 0x5a4d)
    fail("VES_SEA_FORMAT_UNSUPPORTED", "the runtime is not a PE executable");
  const pe = bytes.readUInt32LE(0x3c);
  requireBounds(bytes, pe, 24, "the PE header");
  if (bytes.readUInt32LE(pe) !== 0x4550) fail("VES_SEA_FORMAT_UNSUPPORTED", "the runtime has no PE signature");
  const coff = pe + 4;
  const optional = coff + 20;
  const optionalSize = bytes.readUInt16LE(coff + 16);
  requireBounds(bytes, optional, optionalSize, "the PE optional header");
  if (bytes.readUInt16LE(optional) !== 0x20b || bytes.readUInt32LE(optional + 108) <= SECURITY_DIRECTORY)
    fail("VES_SEA_FORMAT_UNSUPPORTED", "the runtime is not a PE32+ image with a security directory");
  const sectionTable = optional + optionalSize;
  const count = bytes.readUInt16LE(coff + 2);
  requireBounds(bytes, sectionTable, count * SECTION_HEADER, "the PE section table");
  const sections = [];
  for (let index = 0; index < count; index += 1) {
    const at = sectionTable + index * SECTION_HEADER;
    sections.push({
      virtualSize: bytes.readUInt32LE(at + 8),
      virtualAddress: bytes.readUInt32LE(at + 12),
      rawSize: bytes.readUInt32LE(at + 16),
      rawPointer: bytes.readUInt32LE(at + 20)
    });
  }
  return { coff, optional, sectionTable, sections };
}

const peDirectory = (bytes, pe, index) => ({
  address: bytes.readUInt32LE(pe.optional + 112 + index * 8),
  size: bytes.readUInt32LE(pe.optional + 116 + index * 8)
});

function peFileOffset(pe, rva, length) {
  const section = pe.sections.find(
    (candidate) => rva >= candidate.virtualAddress && rva + length <= candidate.virtualAddress + candidate.rawSize
  );
  if (section === undefined) fail("VES_SEA_LAYOUT_INVALID", "a PE address is not backed by section data");
  return section.rawPointer + (rva - section.virtualAddress);
}

function resourceName(bytes, base, field) {
  if ((field & 0x80000000) === 0) return { id: field };
  const at = base + (field & 0x7fffffff);
  requireBounds(bytes, at, 2, "a PE resource name");
  const length = bytes.readUInt16LE(at);
  requireBounds(bytes, at + 2, length * 2, "a PE resource name");
  return { name: bytes.subarray(at + 2, at + 2 + length * 2).toString("utf16le") };
}

function resourceData(bytes, at) {
  requireBounds(bytes, at, 16, "a PE resource data entry");
  return { rva: bytes.readUInt32LE(at), size: bytes.readUInt32LE(at + 4), codePage: bytes.readUInt32LE(at + 8) };
}

function readResourceDirectory(bytes, base, offset, depth) {
  if (depth > MAX_RESOURCE_DEPTH) fail("VES_SEA_LAYOUT_INVALID", "the PE resource tree is deeper than three levels");
  const at = base + offset;
  requireBounds(bytes, at, 16, "a PE resource directory");
  const count = bytes.readUInt16LE(at + 12) + bytes.readUInt16LE(at + 14);
  requireBounds(bytes, at + 16, count * 8, "a PE resource directory");
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const nameField = bytes.readUInt32LE(at + 16 + index * 8);
    const dataField = bytes.readUInt32LE(at + 20 + index * 8);
    const key = resourceName(bytes, base, nameField);
    entries.push(
      (dataField & 0x80000000) === 0
        ? { ...key, data: resourceData(bytes, base + dataField) }
        : { ...key, directory: readResourceDirectory(bytes, base, dataField & 0x7fffffff, depth + 1) }
    );
  }
  return {
    characteristics: bytes.readUInt32LE(at),
    stamp: bytes.readUInt32LE(at + 4),
    version: bytes.readUInt32LE(at + 8),
    entries
  };
}

function readResources(bytes, pe) {
  const directory = peDirectory(bytes, pe, RESOURCE_DIRECTORY);
  if (directory.address === 0) return { characteristics: 0, stamp: 0, version: 0, entries: [] };
  return readResourceDirectory(bytes, peFileOffset(pe, directory.address, 16), 0, 1);
}

const emptyDirectory = () => ({ characteristics: 0, stamp: 0, version: 0, entries: [] });

// invariant: named entries precede integer ones and each group is ordered, as
// the loader's binary search over a resource directory requires.
function orderedEntries(entries) {
  const named = entries.filter((entry) => entry.name !== undefined);
  const numbered = entries.filter((entry) => entry.name === undefined);
  named.sort((left, right) => (left.name.toUpperCase() < right.name.toUpperCase() ? -1 : 1));
  numbered.sort((left, right) => left.id - right.id);
  return [...named, ...numbered];
}

function withSeaResource(root, blobSize) {
  let rcdata = root.entries.find((entry) => entry.id === RT_RCDATA && entry.directory !== undefined);
  if (rcdata === undefined) {
    rcdata = { id: RT_RCDATA, directory: emptyDirectory() };
    root.entries = orderedEntries([...root.entries, rcdata]);
  }
  if (rcdata.directory.entries.some((entry) => entry.name?.toUpperCase() === SEA_RESOURCE_NAME))
    fail("VES_SEA_ALREADY_INJECTED", "the runtime already carries a NODE_SEA_BLOB resource");
  const language = { id: 0, data: { rva: 0, size: blobSize, codePage: 0 } };
  const named = { name: SEA_RESOURCE_NAME, directory: { ...emptyDirectory(), entries: [language] } };
  rcdata.directory.entries = orderedEntries([...rcdata.directory.entries, named]);
  return language.data;
}

function layoutResources(root) {
  const directories = [];
  const dataEntries = [];
  const names = [];
  const queue = [root];
  while (queue.length > 0) {
    const directory = queue.shift();
    directories.push(directory);
    for (const entry of directory.entries) {
      if (entry.name !== undefined) names.push(entry);
      if (entry.directory !== undefined) queue.push(entry.directory);
      else dataEntries.push(entry);
    }
  }
  let offset = 0;
  for (const directory of directories) {
    directory.at = offset;
    offset += 16 + directory.entries.length * 8;
  }
  for (const entry of dataEntries) {
    entry.dataAt = offset;
    offset += 16;
  }
  for (const entry of names) {
    entry.nameAt = offset;
    offset += 2 + entry.name.length * 2;
  }
  return { directories, dataEntries, names, size: alignUp(offset, 8) };
}

function writeDirectory(tree, directory) {
  tree.writeUInt32LE(directory.characteristics, directory.at);
  tree.writeUInt32LE(directory.stamp, directory.at + 4);
  tree.writeUInt32LE(directory.version, directory.at + 8);
  tree.writeUInt16LE(directory.entries.filter((entry) => entry.name !== undefined).length, directory.at + 12);
  tree.writeUInt16LE(directory.entries.filter((entry) => entry.name === undefined).length, directory.at + 14);
  directory.entries.forEach((entry, index) => {
    const at = directory.at + 16 + index * 8;
    tree.writeUInt32LE(entry.name === undefined ? entry.id : (0x80000000 | entry.nameAt) >>> 0, at);
    tree.writeUInt32LE(entry.directory === undefined ? entry.dataAt : (0x80000000 | entry.directory.at) >>> 0, at + 4);
  });
}

function encodeResources(root) {
  const layout = layoutResources(root);
  const tree = Buffer.alloc(layout.size);
  for (const directory of layout.directories) writeDirectory(tree, directory);
  for (const entry of layout.dataEntries) {
    tree.writeUInt32LE(entry.data.rva, entry.dataAt);
    tree.writeUInt32LE(entry.data.size, entry.dataAt + 4);
    tree.writeUInt32LE(entry.data.codePage, entry.dataAt + 8);
  }
  for (const entry of layout.names) {
    tree.writeUInt16LE(entry.name.length, entry.nameAt);
    tree.write(entry.name, entry.nameAt + 2, "utf16le");
  }
  return tree;
}

/**
 * why: the official runtime carries an Authenticode signature that any change
 * invalidates, and the certificate table is the only thing allowed to follow
 * the last section; it is removed so the result ends where its sections do and
 * can be signed afresh by whoever publishes it.
 */
function peUnsignedEnd(bytes, pe) {
  const sectionsEnd = Math.max(...pe.sections.map((section) => section.rawPointer + section.rawSize));
  const certificates = peDirectory(bytes, pe, SECURITY_DIRECTORY);
  const end = certificates.size === 0 ? bytes.length : certificates.address;
  if (certificates.size !== 0 && certificates.address + certificates.size !== bytes.length)
    fail("VES_SEA_LAYOUT_INVALID", "the PE certificate table is not the end of the file");
  if (end !== sectionsEnd) fail("VES_SEA_LAYOUT_INVALID", "the PE file carries data its sections do not explain");
  return end;
}

// why: the image checksum covers the whole file, so it is recomputed last,
// over the final bytes, with its own field zeroed as the PE format specifies.
function peChecksum(bytes, checksumAt) {
  bytes.writeUInt32LE(0, checksumAt);
  let sum = 0;
  for (let at = 0; at < bytes.length; at += 2) {
    sum += at + 1 < bytes.length ? bytes.readUInt16LE(at) : bytes[at];
    sum = (sum & 0xffff) + (sum >>> 16);
  }
  sum = (sum & 0xffff) + (sum >>> 16);
  return (sum + bytes.length) >>> 0;
}

function peSectionHeader(name, virtualSize, virtualAddress, rawSize, rawPointer) {
  const header = Buffer.alloc(SECTION_HEADER);
  header.write(name, 0, "latin1");
  header.writeUInt32LE(virtualSize, 8);
  header.writeUInt32LE(virtualAddress, 12);
  header.writeUInt32LE(rawSize, 16);
  header.writeUInt32LE(rawPointer, 20);
  header.writeUInt32LE(IMAGE_SCN_INITIALIZED_READ, 36);
  return header;
}

function peSeaSection(bytes, pe, blob) {
  const sectionAlignment = bytes.readUInt32LE(pe.optional + 32);
  const fileAlignment = bytes.readUInt32LE(pe.optional + 36);
  const last = pe.sections.at(-1);
  const virtualAddress = alignUp(last.virtualAddress + Math.max(last.virtualSize, last.rawSize), sectionAlignment);
  const resources = readResources(bytes, pe);
  const seaData = withSeaResource(resources, blob.length);
  // why: the tree's size does not depend on the blob's address, so it is laid
  // out once to learn where the blob starts and once more to record it.
  const treeSize = encodeResources(resources).length;
  seaData.rva = virtualAddress + treeSize;
  const content = Buffer.concat([encodeResources(resources), blob]);
  return { content, treeSize, virtualAddress, sectionAlignment, fileAlignment };
}

export function injectPe(executable, blob) {
  const bytes = flipFuse(executable);
  const pe = parsePe(bytes);
  const unsignedEnd = peUnsignedEnd(bytes, pe);
  const section = peSeaSection(bytes, pe, blob);
  const headerAt = pe.sectionTable + pe.sections.length * SECTION_HEADER;
  const firstRaw = Math.min(...pe.sections.filter((entry) => entry.rawSize > 0).map((entry) => entry.rawPointer));
  if (headerAt + SECTION_HEADER > Math.min(bytes.readUInt32LE(pe.optional + 60), firstRaw))
    fail("VES_SEA_LAYOUT_INVALID", "the PE header has no room for another section");
  if (!allZero(bytes.subarray(headerAt, headerAt + SECTION_HEADER)) || unsignedEnd % section.fileAlignment !== 0)
    fail("VES_SEA_LAYOUT_INVALID", "the PE section table cannot take another section");
  const rawSize = alignUp(section.content.length, section.fileAlignment);
  const output = Buffer.concat([
    bytes.subarray(0, unsignedEnd),
    section.content,
    Buffer.alloc(rawSize - section.content.length)
  ]);
  peSectionHeader(SEA_SECTION_NAME, section.content.length, section.virtualAddress, rawSize, unsignedEnd).copy(
    output,
    headerAt
  );
  output.writeUInt16LE(pe.sections.length + 1, pe.coff + 2);
  output.writeUInt32LE(output.readUInt32LE(pe.optional + 8) + rawSize, pe.optional + 8);
  output.writeUInt32LE(
    alignUp(section.virtualAddress + section.content.length, section.sectionAlignment),
    pe.optional + 56
  );
  output.writeUInt32LE(section.virtualAddress, pe.optional + 112 + RESOURCE_DIRECTORY * 8);
  output.writeUInt32LE(section.treeSize, pe.optional + 116 + RESOURCE_DIRECTORY * 8);
  output.writeUInt32LE(0, pe.optional + 112 + SECURITY_DIRECTORY * 8);
  output.writeUInt32LE(0, pe.optional + 116 + SECURITY_DIRECTORY * 8);
  output.writeUInt32LE(peChecksum(output, pe.optional + 64), pe.optional + 64);
  return output;
}

function locatePe(bytes) {
  const pe = parsePe(bytes);
  const rcdata = readResources(bytes, pe).entries.find((entry) => entry.id === RT_RCDATA && entry.directory);
  const named = rcdata?.directory.entries.filter((entry) => entry.name?.toUpperCase() === SEA_RESOURCE_NAME) ?? [];
  const data = named.length === 1 ? named[0].directory?.entries[0]?.data : undefined;
  if (data === undefined) fail("VES_SEA_BLOB_MISSING", "the executable carries no single NODE_SEA_BLOB resource");
  const at = peFileOffset(pe, data.rva, data.size);
  return bytes.subarray(at, at + data.size);
}

const INJECTORS = Object.freeze({ "mach-o": injectMachO, elf: injectElf, pe: injectPe });
const LOCATORS = Object.freeze({ "mach-o": locateMachO, elf: locateElf, pe: locatePe });

export function injectSeaBlob(executable, blob) {
  if (!Buffer.isBuffer(executable) || !Buffer.isBuffer(blob) || blob.length === 0)
    fail("VES_SEA_INPUT_INVALID", "injection needs an executable and a non-empty blob");
  return INJECTORS[executableFormatOf(executable)](executable, blob);
}

/**
 * invariant: the blob is recovered the way the pinned runtime's own lookup
 * would recover it, and the fuse is proven flipped; the build runs this on
 * every artifact it emits, so an executable Node could not start from is
 * never written.
 */
export function locateSeaBlob(executable) {
  const format = executableFormatOf(executable);
  assertFuseFlipped(executable);
  return Object.freeze({ format, blob: Buffer.from(LOCATORS[format](executable)) });
}
