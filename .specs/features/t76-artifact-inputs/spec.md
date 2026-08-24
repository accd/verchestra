# T76 Artifact Input Collection

Issue: #17

## Objective

Turn bytes produced under one isolated build root into the existing hermetic
bundle contract without leaking machine paths or accepting files outside that
root.

## Requirements

- **AI-01** — Every declared source is a regular file below the supplied build
  root; absolute paths, traversal, missing files, directories, and symlinks
  fail closed with a stable error code.
- **AI-02** — Component digests and sizes are computed from the bytes actually
  read, never copied from a descriptor.
- **AI-03** — The projection contains logical paths and content identities only;
  root and source paths are not emitted.
- **AI-04** — Reordering descriptors produces the same verified bundle digest,
  while duplicate component, logical, or source identities are rejected.

## Boundary

This is the T76 T4 input-collection slice. It does not generate SBOM,
license, provenance, or evaluation documents, publish TUF metadata, sign a
release, or claim T76 qualification. Those inputs and their independent
verification remain subsequent tasks.
