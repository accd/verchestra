import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { canonicalizeJsonV2 } from "@verchestra/domain";

import { stateInvalid } from "./task-errors.ts";

const MAXIMUM_STATE_BYTES = 4 * 1024 * 1024;

export function sha256(value: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function canonicalDigest(value: unknown): `sha256:${string}` {
  return sha256(canonicalizeJsonV2(value));
}

// invariant: state files are written whole or not at all (same-directory
// temporary file, then rename), private to the user, and never through a link.
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${canonicalizeJsonV2(value)}\n`, { mode: 0o600, flag: "wx", flush: true });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function readJsonFile(path: string, label: string): Promise<unknown> {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if ((error as { readonly code?: unknown }).code === "ENOENT") return undefined;
    throw stateInvalid("VES_TASK_STATE_UNREADABLE", `${label} is unreadable`, { cause: error });
  }
  if (!metadata.isFile() || metadata.size > MAXIMUM_STATE_BYTES)
    throw stateInvalid("VES_TASK_STATE_UNREADABLE", `${label} is not a bounded regular file`);
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw stateInvalid("VES_TASK_STATE_MALFORMED", `${label} is not valid JSON`, { cause: error });
  }
}

// why: a record whose digest covers its canonical content fails closed when a
// byte of it changes, instead of steering a resumed run with edited state.
export async function writeSealedRecord(path: string, record: unknown): Promise<void> {
  await writeJsonAtomic(path, { record, digest: canonicalDigest(record) });
}

export async function readSealedRecord(path: string, label: string): Promise<unknown> {
  const stored = await readJsonFile(path, label);
  if (stored === undefined) return undefined;
  const row = stored as { readonly record?: unknown; readonly digest?: unknown };
  if (
    stored === null ||
    typeof stored !== "object" ||
    Array.isArray(stored) ||
    Object.keys(stored).sort().join(",") !== "digest,record"
  )
    throw stateInvalid("VES_TASK_STATE_MALFORMED", `${label} has an unexpected shape`);
  let computed: string;
  try {
    computed = canonicalDigest(row.record);
  } catch (error) {
    throw stateInvalid("VES_TASK_STATE_MALFORMED", `${label} is not canonical JSON`, { cause: error });
  }
  if (computed !== row.digest) throw stateInvalid("VES_TASK_STATE_TAMPERED", `${label} does not match its digest`);
  return row.record;
}

export function objectRow(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw stateInvalid("VES_TASK_STATE_MALFORMED", `${label} must be an object`);
  return value as Readonly<Record<string, unknown>>;
}

export function textField(row: Readonly<Record<string, unknown>>, key: string, label: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0 || value.length > 4096)
    throw stateInvalid("VES_TASK_STATE_MALFORMED", `${label}.${key} is invalid`);
  return value;
}
