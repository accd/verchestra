// Sentinel capture, the bounded fixture factory, and TEST-ONLY key material.
// This adapter must not import sibling adapters (packages/evidence included),
// so key material comes straight from node:crypto; it is generated fresh per
// run, never persisted, and always reported testOnly.
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { SelfTestError, type MaterialFact, type RootFacts, type SentinelFact } from "@verchestra/application";
import { sha256 } from "./disposable-roots.ts";

export interface SentinelTarget {
  readonly sentinelId: string;
  readonly path: string;
}

// Captures the digest of each declared sentinel. A missing sentinel is a
// fact too ("absent"): a run that deletes a sentinel must change the set,
// not silently drop out of it.
export class SentinelCatalog {
  readonly #targets: readonly SentinelTarget[];

  constructor(targets: readonly SentinelTarget[]) {
    this.#targets = Object.freeze([...targets]);
  }

  async capture(): Promise<readonly SentinelFact[]> {
    const facts: SentinelFact[] = [];
    for (const target of this.#targets) {
      const content = await readFile(target.path).catch(() => null);
      facts.push(
        Object.freeze({ sentinelId: target.sentinelId, digest: content === null ? "absent" : sha256(content) })
      );
    }
    return Object.freeze(facts);
  }
}

// Writes fixtures inside the disposable root and nowhere else: a relative
// path that resolves outside the root fails closed, and the profile's byte
// budget is enforced cumulatively so a scenario cannot balloon the root.
export class BoundedFixtureFactory {
  readonly #root: string;
  readonly #maxBytes: number;
  #writtenBytes = 0;

  constructor(root: RootFacts, maxBytes: number) {
    this.#root = root.canonicalPath;
    this.#maxBytes = maxBytes;
  }

  get writtenBytes(): number {
    return this.#writtenBytes;
  }

  async write(relativePath: string, content: string | Uint8Array): Promise<string> {
    const target = resolve(this.#root.replaceAll("/", sep), relativePath).replaceAll(sep, "/");
    if (target !== this.#root && !target.startsWith(`${this.#root}/`))
      throw new SelfTestError(
        "VES_SELFTEST_FIXTURE_ESCAPE",
        `fixture path ${relativePath} escapes the disposable root`
      );
    const bytes = typeof content === "string" ? Buffer.byteLength(content) : content.byteLength;
    if (this.#writtenBytes + bytes > this.#maxBytes)
      throw new SelfTestError(
        "VES_SELFTEST_FIXTURE_BUDGET",
        `fixture budget exceeded: ${this.#writtenBytes + bytes} of ${this.#maxBytes} bytes`
      );
    this.#writtenBytes += bytes;
    await mkdir(dirname(target.replaceAll("/", sep)), { recursive: true });
    await writeFile(target.replaceAll("/", sep), content);
    return target;
  }
}

export interface TestOnlyKey {
  readonly material: MaterialFact;
  readonly publicKeyDer: string;
  sign(data: Uint8Array): string;
}

export function testOnlyKeyMaterial(materialId: string): TestOnlyKey {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return Object.freeze({
    material: Object.freeze({ materialId, kind: "key" as const, testOnly: true }),
    publicKeyDer: publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
    sign: (data: Uint8Array) => cryptoSign(null, Buffer.from(data), privateKey).toString("base64url")
  });
}

export function fixtureJoin(root: RootFacts, ...segments: readonly string[]): string {
  return join(root.canonicalPath.replaceAll("/", sep), ...segments);
}
