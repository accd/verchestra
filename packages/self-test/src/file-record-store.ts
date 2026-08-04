import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

function keyDigest(key: string): string {
  if (typeof key !== "string" || key.length === 0 || key.length > 512)
    throw new Error("Self-Test record key is invalid");
  return createHash("sha256").update(key).digest("hex");
}

/** A small durable, content-addressed record adapter for disposable runs. */
export class FileRecordStore {
  readonly #root: string;

  constructor(options: { readonly root: string }) {
    this.#root = options.root;
  }

  async load<T>(key: string): Promise<T | undefined> {
    try {
      return JSON.parse(await readFile(join(this.#root, `${keyDigest(key)}.json`), "utf8")) as T;
    } catch (error) {
      if ((error as { readonly code?: unknown }).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async save<T>(key: string, value: T): Promise<T> {
    await mkdir(this.#root, { recursive: true });
    const target = join(this.#root, `${keyDigest(key)}.json`);
    const encoded = JSON.stringify(value);
    const existing = await this.load<T>(key);
    if (existing !== undefined) {
      if (JSON.stringify(existing) !== encoded) throw new Error("Self-Test durable record conflicts");
      return existing;
    }
    const staging = `${target}.${process.pid}.tmp`;
    await writeFile(staging, encoded, { flag: "wx", mode: 0o600 });
    try {
      await rename(staging, target);
    } catch (error) {
      if ((error as { readonly code?: unknown }).code !== "EEXIST") throw error;
      const current = await this.load<T>(key);
      if (current === undefined || JSON.stringify(current) !== encoded)
        throw new Error("Self-Test durable record conflicts");
      return current;
    }
    return value;
  }

  /** Replace a mutable checkpoint while keeping the record on disk. */
  async replace<T>(key: string, value: T): Promise<T> {
    await mkdir(this.#root, { recursive: true });
    const target = join(this.#root, `${keyDigest(key)}.json`);
    const staging = `${target}.${process.pid}.tmp`;
    await writeFile(staging, JSON.stringify(value), { flag: "w", mode: 0o600 });
    try {
      await rename(staging, target);
    } catch (error) {
      if ((error as { readonly code?: unknown }).code !== "EEXIST") throw error;
      await writeFile(target, JSON.stringify(value), { mode: 0o600 });
    }
    return value;
  }

  async find<T extends Record<string, unknown>>(field: string, value: unknown): Promise<T | undefined> {
    let names: string[];
    try {
      names = await readdir(this.#root);
    } catch (error) {
      if ((error as { readonly code?: unknown }).code === "ENOENT") return undefined;
      throw error;
    }
    for (const name of names.filter((entry) => entry.endsWith(".json")).sort()) {
      const record = JSON.parse(await readFile(join(this.#root, name), "utf8")) as T;
      if (record[field] === value) return record;
    }
    return undefined;
  }
}
