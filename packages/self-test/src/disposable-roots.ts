// Node-bound facts for the Self-Test trust domain (T69, #10): disposable-root
// provisioning and probing, cleanup with residue reporting, and quarantine
// mechanics. Every verdict about these facts lives in
// packages/application/src/self-test; this adapter only measures and acts.
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { RootFacts, SelfTestProfileId } from "@verchestra/application";

// The rules compare paths as opaque forward-slash strings, so every path this
// adapter reports goes through one normalizer.
export function normalizeFactPath(path: string): string {
  const normalized = resolve(path).replaceAll(sep, "/");
  return normalized.endsWith("/") && normalized.length > 1 ? normalized.slice(0, -1) : normalized;
}

// Walks every ancestor of the requested path and records the resolved target
// of each link-like segment. A symlink or junction that escapes the intended
// area shows up here even when the fully resolved root looks disjoint —
// exactly the fact TST-01's link-chain clause needs.
export async function collectLinkChain(path: string): Promise<readonly string[]> {
  const chain: string[] = [];
  let current = resolve(path);
  for (let hop = 0; hop < 64; hop += 1) {
    const parent = dirname(current);
    const stats = await lstat(current).catch(() => null);
    if (stats?.isSymbolicLink()) {
      chain.push(normalizeFactPath(current), normalizeFactPath(await realpath(current)));
    }
    if (parent === current) break;
    current = parent;
  }
  return Object.freeze([...new Set(chain)].sort());
}

export async function probeRootFacts(path: string): Promise<RootFacts> {
  const real = await realpath(path);
  const stats = await stat(real, { bigint: true });
  return Object.freeze({
    canonicalPath: normalizeFactPath(path),
    realPath: normalizeFactPath(real),
    deviceId: stats.dev.toString(),
    inodeId: stats.ino.toString(),
    linkChain: await collectLinkChain(path)
  });
}

async function listResidue(root: string): Promise<readonly string[]> {
  const entries = await readdir(root, { recursive: true }).catch(() => []);
  return Object.freeze(entries.slice(0, 20).map((entry) => String(entry).replaceAll(sep, "/")));
}

export class DisposableRootProvider {
  readonly #baseDirectory: string;

  constructor(options: { readonly baseDirectory: string }) {
    this.#baseDirectory = options.baseDirectory;
  }

  async provision(profileId: SelfTestProfileId): Promise<RootFacts> {
    await mkdir(this.#baseDirectory, { recursive: true });
    const root = await mkdtemp(join(this.#baseDirectory, `selftest-${profileId}-`));
    return probeRootFacts(root);
  }

  // Cleanup reports facts: removal is proven only when the root demonstrably
  // no longer exists. Anything else is residue for the rules to judge.
  async cleanup(root: RootFacts): Promise<{ readonly removed: boolean; readonly residue: readonly string[] }> {
    await rm(root.canonicalPath, { recursive: true, force: true }).catch(() => undefined);
    const stillThere = await lstat(root.canonicalPath).catch(() => null);
    if (stillThere === null) return Object.freeze({ removed: true, residue: Object.freeze([]) });
    return Object.freeze({ removed: false, residue: await listResidue(root.canonicalPath) });
  }

  // Quarantine renames the root aside and drops a marker naming the reason,
  // so the leak is visible and inert instead of silent. Proof is the marker
  // existing at the quarantined location.
  async quarantine(root: RootFacts, reason: string): Promise<{ readonly quarantined: boolean }> {
    const target = `${root.canonicalPath}.quarantined-${Date.now().toString(36)}`;
    try {
      await rename(root.canonicalPath, target);
      await writeFile(join(target, "QUARANTINE.txt"), `${reason}\n`);
      return Object.freeze({ quarantined: true });
    } catch {
      return Object.freeze({ quarantined: false });
    }
  }
}

export function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
