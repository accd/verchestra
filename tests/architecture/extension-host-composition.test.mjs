// invariant (#569): nothing a user runs reaches the out-of-process probe host
// until its T3 composes it. #569's code fixes have landed (the stopped-tree
// sweep, the bound launch, admission through the registry and the approval
// store); one descendant residual stays stated in threat-model.md. The owner
// ratified AD-037 as amended on 2026-10-28. T3, under its reviewed plan, lifts
// this walk over every module reachable from the CLI and the launcher; until
// then it fails on any edge into packages/extension-host.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const HOST = join(ROOT, "packages", "extension-host");
const ENTRY_ROOTS = ["apps/vestra-cli/src", "apps/vestra-launcher/src", "apps/vestra-launcher/closure"];

function importSpecifiers(code) {
  const staticSpecifiers = [...code.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1]);
  const dynamicSpecifiers = [...code.matchAll(/import\(\s*["']([^"']+)["']\s*\)/gu)].map((match) => match[1]);
  return [...staticSpecifiers, ...dynamicSpecifiers];
}

function resolveSpecifier(specifier, fromFilePath) {
  if (specifier.startsWith(".")) return resolve(dirname(fromFilePath), specifier);
  if (!specifier.startsWith("@verchestra/")) return null;
  const [, packageName, ...subpathParts] = specifier.split("/");
  const subpath = subpathParts.length === 0 ? "." : `./${subpathParts.join("/")}`;
  const manifest = JSON.parse(readFileSync(join(ROOT, "packages", packageName, "package.json"), "utf8"));
  const target = manifest.exports?.[subpath];
  assert.ok(typeof target === "string", `${specifier} has no declared export`);
  return join(ROOT, "packages", packageName, target.replace(/^\.\//u, ""));
}

function sources(directory) {
  const found = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) found.push(...sources(path));
    else if (/\.(?:ts|mts|mjs)$/u.test(name) && !name.endsWith(".d.ts")) found.push(path);
  }
  return found;
}

function hostEdges(entries) {
  const visited = new Set(entries);
  const queue = [...entries];
  const edges = [];
  while (queue.length > 0) {
    const file = queue.shift();
    for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
      const target = specifier.startsWith("@verchestra/extension-host") ? HOST : resolveSpecifier(specifier, file);
      if (target !== null && target.startsWith(HOST)) {
        edges.push(`${relative(ROOT, file).replaceAll("\\", "/")} imports ${specifier}`);
        continue;
      }
      if (target !== null && !visited.has(target)) {
        visited.add(target);
        queue.push(target);
      }
    }
  }
  return { visited, edges };
}

test("no CLI or launcher module reaches extension-host before the host's T3 composes it", () => {
  // why: the walk itself must see an edge, or a pass would prove nothing.
  const probe = mkdtempSync(join(tmpdir(), "verchestra-extension-host-walk-"));
  try {
    const entry = join(probe, "entry.ts");
    writeFileSync(entry, 'import { FramedProbeWorker } from "@verchestra/extension-host";\n');
    assert.equal(hostEdges([entry]).edges.length, 1, "the walk misses a direct extension-host import");
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
  const entries = ENTRY_ROOTS.flatMap((root) => sources(join(ROOT, root)));
  const { visited, edges } = hostEdges(entries);
  assert.ok(visited.size > 150, `the walk reached only ${visited.size} modules`);
  assert.ok(
    [...visited].some((path) => path.startsWith(join(ROOT, "packages", "application"))),
    "the walk never left the apps"
  );
  assert.deepEqual(edges, [], "#569: the probe host stays uncomposed until its T3 composes it under a reviewed plan");
});
