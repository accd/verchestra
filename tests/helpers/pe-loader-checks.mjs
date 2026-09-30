// why: #236's first Windows build passed every structural test yet the loader
// refused it (CreateProcess: ERROR_BAD_EXE_FORMAT, libuv EFTYPE), because its
// resource data lived outside the section holding the resource directory.
// This is an independent PE32+ reader — it shares no code with
// scripts/sea-inject.mjs — that states the rules the Windows image loader and
// resource loader enforce, so a layout the loader would refuse fails on any
// host instead of only on a Windows runner.
//
// It returns every violation it finds; an empty list means none of these rules
// is broken. It is deliberately stricter than the loader where the PE format
// is, for example the checksum and the resource directory span.

const IMAGE_FILE_EXECUTABLE_IMAGE = 0x0002;
const SECURITY = 4;
const RESOURCE = 2;
const MAX_SECTIONS = 96;

const alignUp = (value, alignment) => Math.ceil(value / alignment) * alignment;
const isPowerOfTwo = (value) => value > 0 && (value & (value - 1)) === 0;

function headers(bytes, violations) {
  if (bytes.length < 0x40 || bytes.readUInt16LE(0) !== 0x5a4d) return void violations.push("no MZ header");
  const pe = bytes.readUInt32LE(0x3c);
  if (pe + 24 > bytes.length || bytes.readUInt32LE(pe) !== 0x4550) return void violations.push("no PE signature");
  const coff = pe + 4;
  const optional = coff + 20;
  const optionalSize = bytes.readUInt16LE(coff + 16);
  if (bytes.readUInt16LE(coff) !== 0x8664) violations.push("machine is not AMD64");
  if ((bytes.readUInt16LE(coff + 18) & IMAGE_FILE_EXECUTABLE_IMAGE) === 0) violations.push("not an executable image");
  if (optional + optionalSize > bytes.length || bytes.readUInt16LE(optional) !== 0x20b)
    return void violations.push("no PE32+ optional header");
  const directoryCount = bytes.readUInt32LE(optional + 108);
  if (directoryCount > 16 || 112 + directoryCount * 8 > optionalSize)
    violations.push("the data directories overrun the optional header");
  return {
    coff,
    optional,
    sectionCount: bytes.readUInt16LE(coff + 2),
    sectionTable: optional + optionalSize,
    sectionAlignment: bytes.readUInt32LE(optional + 32),
    fileAlignment: bytes.readUInt32LE(optional + 36),
    sizeOfImage: bytes.readUInt32LE(optional + 56),
    sizeOfHeaders: bytes.readUInt32LE(optional + 60),
    checksum: bytes.readUInt32LE(optional + 64),
    directories: Array.from({ length: Math.min(directoryCount, 16) }, (_, index) => ({
      address: bytes.readUInt32LE(optional + 112 + index * 8),
      size: bytes.readUInt32LE(optional + 116 + index * 8)
    }))
  };
}

function sections(bytes, image, violations) {
  const { sectionAlignment, fileAlignment, sectionCount, sectionTable, sizeOfHeaders } = image;
  if (!isPowerOfTwo(fileAlignment) || fileAlignment < 0x200 || fileAlignment > 0x10000)
    violations.push("FileAlignment is not a power of two between 512 and 64 KiB");
  if (!isPowerOfTwo(sectionAlignment) || sectionAlignment < fileAlignment)
    violations.push("SectionAlignment is not a power of two at least FileAlignment");
  if (sectionCount === 0 || sectionCount > MAX_SECTIONS) violations.push("the section count is out of range");
  const tableEnd = sectionTable + sectionCount * 40;
  if (tableEnd > sizeOfHeaders) violations.push("the section table overruns SizeOfHeaders");
  if (sizeOfHeaders % fileAlignment !== 0) violations.push("SizeOfHeaders is not file-aligned");
  const list = Array.from({ length: sectionCount }, (_, index) => {
    const at = sectionTable + index * 40;
    return {
      name: bytes
        .subarray(at, at + 8)
        .toString("latin1")
        .replace(/\0+$/u, ""),
      virtualSize: bytes.readUInt32LE(at + 8),
      virtualAddress: bytes.readUInt32LE(at + 12),
      rawSize: bytes.readUInt32LE(at + 16),
      rawPointer: bytes.readUInt32LE(at + 20)
    };
  });
  // invariant: the loader maps sections back to back from the first page after
  // the headers; any gap, overlap, or reordering refuses the image.
  let nextAddress = alignUp(sizeOfHeaders, sectionAlignment);
  let lastRawEnd = sizeOfHeaders;
  for (const section of list) {
    const span = section.virtualSize === 0 ? section.rawSize : section.virtualSize;
    if (section.virtualAddress !== nextAddress)
      violations.push(
        `${section.name} starts at 0x${section.virtualAddress.toString(16)}, not 0x${nextAddress.toString(16)}`
      );
    nextAddress = section.virtualAddress + alignUp(span, sectionAlignment);
    if (section.rawSize === 0) continue;
    if (section.rawPointer % fileAlignment !== 0 || section.rawSize % fileAlignment !== 0)
      violations.push(`${section.name} raw data is not file-aligned`);
    if (section.rawPointer < lastRawEnd) violations.push(`${section.name} raw data overlaps what precedes it`);
    if (section.rawPointer + section.rawSize > bytes.length)
      violations.push(`${section.name} raw data ends past the file`);
    lastRawEnd = section.rawPointer + section.rawSize;
  }
  if (image.sizeOfImage !== nextAddress)
    violations.push(`SizeOfImage is 0x${image.sizeOfImage.toString(16)}, not 0x${nextAddress.toString(16)}`);
  return { list, rawEnd: lastRawEnd };
}

const sectionHolding = (list, rva, length) =>
  list.find((section) => rva >= section.virtualAddress && rva + length <= section.virtualAddress + section.rawSize);

function certificateTable(bytes, image, rawEnd, violations) {
  const certificates = image.directories[SECURITY] ?? { address: 0, size: 0 };
  if (certificates.address === 0 && certificates.size === 0) {
    if (bytes.length !== rawEnd) violations.push("bytes follow the last section with no certificate table");
    return;
  }
  if (certificates.address !== alignUp(rawEnd, 8) || certificates.address + certificates.size !== bytes.length)
    violations.push("the certificate table is not exactly the bytes after the last section");
}

function checksumOf(bytes, at) {
  let sum = 0;
  for (let offset = 0; offset < bytes.length; offset += 2) {
    const word =
      offset === at || offset === at + 2 ? 0 : offset + 1 < bytes.length ? bytes.readUInt16LE(offset) : bytes[offset];
    sum += word;
    sum = (sum & 0xffff) + (sum >>> 16);
  }
  return ((sum & 0xffff) + (sum >>> 16) + bytes.length) >>> 0;
}

function upperCaseOrder(left, right) {
  const [a, b] = [left.toUpperCase(), right.toUpperCase()];
  return a < b ? -1 : Number(a > b);
}

/**
 * invariant: the resource loader resolves every directory, name, and data
 * entry relative to the resource directory, and Windows refuses to start an
 * image whose resource bytes lie outside the section holding that directory.
 */
function resources(bytes, image, list, violations) {
  const span = image.directories[RESOURCE];
  if (span === undefined || span.address === 0) return;
  const section = sectionHolding(list, span.address, span.size);
  if (section === undefined) return void violations.push("the resource directory span is not inside one section");
  const base = section.rawPointer + (span.address - section.virtualAddress);
  const inSpan = (offset, length) => offset >= 0 && offset + length <= span.size;
  const walk = (offset, depth, path) => {
    if (depth > 3) return void violations.push(`resource ${path} nests deeper than three levels`);
    if (!inSpan(offset, 16)) return void violations.push(`resource directory ${path} lies outside the span`);
    const named = bytes.readUInt16LE(base + offset + 12);
    const count = named + bytes.readUInt16LE(base + offset + 14);
    if (!inSpan(offset + 16, count * 8)) return void violations.push(`resource directory ${path} overruns the span`);
    const keys = [];
    for (let index = 0; index < count; index += 1) {
      const nameField = bytes.readUInt32LE(base + offset + 16 + index * 8);
      const child = bytes.readUInt32LE(base + offset + 20 + index * 8);
      let key = nameField;
      if (index < named) {
        const at = nameField & 0x7fffffff;
        if ((nameField & 0x80000000) === 0 || !inSpan(at, 2) || !inSpan(at + 2, bytes.readUInt16LE(base + at) * 2)) {
          violations.push(`resource ${path} has a named entry without an in-span name`);
          continue;
        }
        key = bytes.subarray(base + at + 2, base + at + 2 + bytes.readUInt16LE(base + at) * 2).toString("utf16le");
      } else if ((nameField & 0x80000000) !== 0) violations.push(`resource ${path} has a named entry among ids`);
      keys.push(key);
      const childPath = `${path}/${key}`;
      if ((child & 0x80000000) !== 0) {
        walk(child & 0x7fffffff, depth + 1, childPath);
        continue;
      }
      if (depth !== 3) violations.push(`resource ${childPath} is data above the language level`);
      if (!inSpan(child, 16)) {
        violations.push(`resource ${childPath} data entry lies outside the span`);
        continue;
      }
      const rva = bytes.readUInt32LE(base + child);
      const size = bytes.readUInt32LE(base + child + 4);
      if (!inSpan(rva - span.address, size))
        violations.push(`resource ${childPath} bytes lie outside the resource directory span`);
    }
    const names = keys.slice(0, named);
    const ids = keys.slice(named);
    if (names.some((name, index) => index > 0 && upperCaseOrder(names[index - 1], name) >= 0))
      violations.push(`resource ${path} names are not strictly ordered`);
    if (ids.some((id, index) => index > 0 && ids[index - 1] >= id))
      violations.push(`resource ${path} ids are not strictly ordered`);
  };
  walk(0, 1, "");
}

export function peLoaderViolations(bytes) {
  const violations = [];
  const image = headers(bytes, violations);
  if (image === undefined) return violations;
  const { list, rawEnd } = sections(bytes, image, violations);
  certificateTable(bytes, image, rawEnd, violations);
  if (image.checksum !== checksumOf(bytes, image.optional + 64)) violations.push("CheckSum does not match the file");
  for (const [index, directory] of image.directories.entries()) {
    if (index === SECURITY || directory.address === 0) continue;
    if (directory.address + directory.size > image.sizeOfImage)
      violations.push(`data directory ${index} lies past SizeOfImage`);
  }
  resources(bytes, image, list, violations);
  return violations;
}
