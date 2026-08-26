// The sealed launcher: the module the T76 candidate builder bundles into
// `bin/vestra.mjs` and `bin/verchestra.mjs`. A sealed launcher IS the real
// CLI - every argument vector except the activation-health probe delegates to
// the same `main()` the development shims run - and it additionally answers
// the activation health protocol that
// `packages/platform-node/src/activation-launcher-adapters.ts` requires of a
// staged release: `<runtime> <launcher> --activation-health` prints exactly
// one JSON object with exactly `schemaVersion`, `report`, `componentId`,
// `semanticVersion`, `checks`, and `behavior`, and exits 0.
//
// Nothing here synthesizes evidence. Each named check reports what this
// process can genuinely observe about the sealed closure it is part of: the
// compiled-in persistence migration registry, the release-layout native
// components next to the bundled binary, and the compiled-in driver surface.
// A missing or empty observation fails closed with a non-zero exit and a
// diagnostic on stderr - the health gate then correctly refuses activation.
//
// Import discipline: this module must never import `@verchestra/platform-node`
// by its package root. That root statically reaches runtime-store.ts and so
// node:sqlite, whose import prints an experimental-feature warning to stderr -
// and the health gate folds stderr into the same buffer it JSON-parses, so one
// warning byte fails the protocol. The migration registry is therefore taken
// from the `/readonly` observation subpath, which defers SQLite by design.

import { createHash } from "node:crypto";
import { statSync } from "node:fs";

import { resolveSelfTestProfile } from "@verchestra/application";
import { ClaudeCodeDriver, CodexDriver, DeterministicMockDriver, OpenCodeDriver, PiDriver } from "@verchestra/drivers";
import { DEFAULT_RUNTIME_MIGRATIONS } from "@verchestra/platform-node/readonly";

import { main } from "./main.ts";
import { installedReleaseManifest } from "./release-manifest.ts";

// The protocol argument fixed by the activation health gate
// (ACTIVATION_HEALTH_ARGUMENT in activation-launcher-adapters.ts). Restated
// here as a literal because importing it would require the platform-node
// package root - see the import discipline note above.
const ACTIVATION_HEALTH_ARGUMENT = "--activation-health";

// The release-layout native components, resolved relative to the bundled
// launcher: in a staged release the bundle lives at `<releaseRoot>/bin/`, so
// `../native/...` is the release's own `native/` directory. In the repository
// checkout these paths do not exist, which is the correct observation: a
// development tree is not a sealed release and must not pass its health gate.
const NATIVE_COMPONENT_PATHS = Object.freeze(["native/sqlite-vec", "native/cedar-wasm.wasm"]);

export interface SealedLauncherIdentity {
  readonly componentId: "launcher:vestra" | "launcher:verchestra";
  readonly invokedAs: "vestra" | "verchestra";
}

interface HealthCheck {
  readonly name: "migration" | "native" | "driver";
  readonly status: "pass" | "fail";
  readonly observation: Record<string, unknown>;
}

const sha256 = (value: string): string => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

// A genuine, deterministic projection of the compiled-in persistence
// migration registry: every registered migration's identity plus a digest of
// the exact statement the runtime would apply.
function observeMigrations(): HealthCheck {
  const registered = DEFAULT_RUNTIME_MIGRATIONS.map((migration) => ({
    id: migration.id,
    upDigest: sha256(migration.up)
  }));
  return {
    name: "migration",
    status: registered.length > 0 ? "pass" : "fail",
    observation: { registry: "runtime-store", count: registered.length, registered }
  };
}

// Stats the sealed release's native components relative to this bundle. The
// observation carries the genuinely observed byte sizes; absence is a failed
// check, never a fabricated pass.
function observeNativeComponents(): HealthCheck {
  const components = NATIVE_COMPONENT_PATHS.map((logicalPath) => {
    try {
      const stats = statSync(new URL(`../${logicalPath}`, import.meta.url));
      if (!stats.isFile() || stats.size <= 0) return { logicalPath, present: false };
      return { logicalPath, present: true, sizeBytes: stats.size };
    } catch {
      return { logicalPath, present: false };
    }
  });
  return {
    name: "native",
    status: components.every((component) => component.present) ? "pass" : "fail",
    observation: { components }
  };
}

// The compiled-in driver surface: the concrete driver classes this closure
// carries (names survive minification because the builder bundles with
// keep-names) and the packaged self-test profile that exercises them.
function observeDrivers(): HealthCheck {
  const drivers = [ClaudeCodeDriver, CodexDriver, DeterministicMockDriver, OpenCodeDriver, PiDriver]
    .map((driver) => driver.name)
    .sort();
  const profile = resolveSelfTestProfile("drivers");
  return {
    name: "driver",
    status: drivers.length > 0 && profile.requiredCheckIds.length > 0 ? "pass" : "fail",
    observation: {
      drivers,
      selfTestProfile: { profileId: profile.profileId, requiredCheckIds: [...profile.requiredCheckIds] }
    }
  };
}

// The normalized behavior projection. Derived from the compiled-in release
// manifest alone, so both canonical launchers - which share this exact
// bundled code - observe it identically by construction, which is what the
// gate's divergence check requires.
function behaviorProjection(): Record<string, unknown> {
  return {
    manifestSchemaVersion: installedReleaseManifest.schemaVersion,
    commands: installedReleaseManifest.commands.map(({ name, mutating, supportsJson }) => ({
      name,
      mutating,
      supportsJson
    }))
  };
}

function emitActivationHealth(identity: SealedLauncherIdentity): number {
  const checks = [observeMigrations(), observeNativeComponents(), observeDrivers()];
  const report = {
    schemaVersion: 1,
    report: "activation-health",
    componentId: identity.componentId,
    semanticVersion: installedReleaseManifest.semanticVersion,
    checks,
    behavior: behaviorProjection()
  };
  if (checks.some((check) => check.status !== "pass")) {
    process.stderr.write(`${JSON.stringify(report)}\n`);
    return 1;
  }
  process.stdout.write(JSON.stringify(report));
  return 0;
}

/**
 * The sealed launchers' single entry: exactly `--activation-health` answers
 * the health protocol; every other argument vector is the real CLI.
 */
export async function runSealedLauncher(
  identity: SealedLauncherIdentity,
  argv: readonly string[] = process.argv.slice(2)
): Promise<number> {
  if (argv.length === 1 && argv[0] === ACTIVATION_HEALTH_ARGUMENT) return emitActivationHealth(identity);
  return main(identity.invokedAs, argv);
}
