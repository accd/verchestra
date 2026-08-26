// Where a command finds the files of the layout it is actually running in.
//
// The sealed launcher (sealed-launcher.ts) delegates every argument vector but
// `--activation-health` to the same `main()` a repository checkout runs, so the
// identical composition code executes from two different layouts:
//
//   repository  <repo>/apps/vestra-cli/src/<module>.ts        (import.meta.url per module)
//   sealed      <releaseRoot>/bin/vestra.mjs                  (one bundle, one URL)
//
// Any `new URL("...", import.meta.url)` written for one layout silently
// resolves somewhere else in the other, and the resulting failure looks like a
// product defect rather than a packaging one. Three shipped defects had exactly
// this shape: the doctor's schema registry resolved two levels ABOVE the
// release root (always null, so the verdict was FAIL from a sealed bundle
// only), the Self-Test full profile pointed `execFile` at a `.ts` file the
// bundle does not contain, and both Self-Test driver profiles spawned a fake
// driver that is sealed under `components/`, not beside `bin/`. All three are
// fixed by naming BOTH layouts here, once.
//
// Resolution is ordered, not exclusive: the layout this process is actually in
// is tried first, and the other remains a fallback, so a repository checkout
// keeps its exact previous resolution and a sealed bundle can never be
// captured by an unrelated directory that happens to sit above its root.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { isSealedRelease } from "./release-manifest.ts";

export interface ReleaseLayoutPaths {
  /** Specifier relative to the sealed `bin/*.mjs` bundle. */
  readonly sealed: string;
  /** Specifier relative to the repository module that owns the reference. */
  readonly source: string;
}

/**
 * The candidate URLs for one artifact, most likely layout first. Exported so a
 * test can assert the order and the chosen candidate directly, without having
 * to observe it through a command's exit code.
 */
export function releaseLayoutCandidates(moduleUrl: string, paths: ReleaseLayoutPaths): readonly URL[] {
  const sealed = new URL(paths.sealed, moduleUrl);
  const source = new URL(paths.source, moduleUrl);
  return Object.freeze(isSealedRelease() ? [sealed, source] : [source, sealed]);
}

/**
 * The canonical JSON schema directory. The T76 candidate builder seals every
 * tracked `schemas/**\/*.json` as a `schema` component at
 * `components/<trackedPath>` (scripts/t76-build-candidate.mjs `sourceKind` and
 * `sourceDescriptors`), so a staged release carries the registry at
 * `<releaseRoot>/components/schemas/`, one directory up from `bin/`.
 */
export function schemaRegistryCandidates(moduleUrl: string): readonly URL[] {
  return releaseLayoutCandidates(moduleUrl, { sealed: "../components/schemas/", source: "../../../schemas/" });
}

/**
 * The durable-crash child the Self-Test full profile `execFile`s. It is a real
 * child process, not an import, so the bundle cannot inline it: the builder
 * emits it as a second sealed bundle beside the launchers at
 * `<releaseRoot>/bin/self-test-full-crash-child.mjs`, and the repository runs
 * the tracked TypeScript source. Returns the first candidate that exists so a
 * missing artifact surfaces as the runner's own entrypoint failure against the
 * path this layout expects, never as a silent run of the other layout's file.
 */
export function resolveDurableCrashChild(moduleUrl: string): string {
  return firstExisting(
    releaseLayoutCandidates(moduleUrl, {
      sealed: "./self-test-full-crash-child.mjs",
      source: "./self-test-full-crash-child.ts"
    })
  );
}

/**
 * The fake driver executable the `full` and `drivers` Self-Test profiles spawn
 * to probe two real driver adapters without a provider install. It is the
 * second spawned sibling with the same problem as the crash child, but it
 * needs no new build output: it is already a tracked `.mjs` file, so the
 * candidate builder seals it verbatim as a `core-code` component at
 * `components/apps/vestra-cli/src/self-test-driver-fake.mjs`. Only the
 * specifier was wrong, which made every driver probe unavailable from a sealed
 * release and refused the full profile at `deriveDriverBinding` - correctly,
 * since an unavailable driver may never be attributed to.
 */
export function resolveSelfTestDriverFake(moduleUrl: string): string {
  return firstExisting(
    releaseLayoutCandidates(moduleUrl, {
      sealed: "../components/apps/vestra-cli/src/self-test-driver-fake.mjs",
      source: "./self-test-driver-fake.mjs"
    })
  );
}

// Falling back to the first candidate when none exists keeps the failure
// honest: the caller reports a missing entrypoint at the path its own layout
// expects, rather than silently running the other layout's file.
function firstExisting(candidates: readonly URL[]): string {
  const resolved = candidates.map((url) => fileURLToPath(url));
  return resolved.find((path) => existsSync(path)) ?? resolved[0]!;
}
