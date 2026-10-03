// invariant: decision D2 and TM-020. A sealed `bin/` artifact is judged
// self-contained from the bundler's metafile, which records every import the
// output makes: a static, dynamic, or `require` import of anything but a
// `node:` built-in fails the build, and a bundled string that merely looks
// like an import (the Strands SDK carries one, research F2) does not.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import {
  SEALED_BUNDLE_ENTRIES,
  assertSelfContainedMetafile,
  bundleSealedLauncherWithMetafile,
  sealedRuntimeImports
} from "../../scripts/t76-build-candidate.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const refused = (pattern) => (error) => {
  assert.equal(error.code, "VES_T76_BUILD_LAUNCHER_NOT_SELF_CONTAINED");
  assert.match(error.message, pattern);
  return true;
};

const metafile = (imports, outputs = 1) => ({
  inputs: {},
  outputs: Object.fromEntries(
    Array.from({ length: outputs }, (_, index) => [
      `bin/out-${index}.mjs`,
      { imports, exports: [], inputs: {}, bytes: 1 }
    ])
  )
});

// why: the same option vector the sealed bundler uses, over an in-memory
// module, with the named specifiers left external so each import kind appears.
async function bundled(contents, external = []) {
  const result = await build({
    stdin: { contents, resolveDir: ROOT, loader: "js" },
    write: false,
    outfile: "bin/probe.mjs",
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    minify: true,
    keepNames: true,
    legalComments: "none",
    metafile: true,
    external,
    logLevel: "silent"
  });
  return { metafile: result.metafile, text: Buffer.from(result.outputFiles[0].contents).toString("utf8") };
}

test("node: built-ins pass in every import kind", () => {
  assert.doesNotThrow(() =>
    assertSelfContainedMetafile(
      metafile([
        { path: "node:fs", kind: "import-statement", external: true },
        { path: "node:sqlite", kind: "dynamic-import", external: true },
        { path: "node:path", kind: "require-call", external: true }
      ]),
      "launcher:vestra"
    )
  );
});

test("a static, dynamic, or require import of anything else fails, with its kind named", () => {
  for (const [path, kind] of [
    ["lodash", "import-statement"],
    ["@strands-agents/sdk", "dynamic-import"],
    ["zod", "require-call"],
    ["fs", "import-statement"]
  ])
    assert.throws(
      () => assertSelfContainedMetafile(metafile([{ path, kind, external: true }]), "launcher:vestra"),
      refused(new RegExp(`launcher:vestra imports ${path.replace("/", "\\/")} \\(${kind}\\) at run time`, "u")),
      `${kind} ${path}`
    );
});

test("a record that does not describe exactly one output fails closed", () => {
  for (const record of [metafile([], 0), metafile([], 2), undefined, { outputs: { "bin/a.mjs": {} } }])
    assert.throws(() => sealedRuntimeImports(record, "launcher:vestra"), refused(/does not describe one output/u));
});

test("real bundles: each external import kind is caught from the bundler's own record", async () => {
  for (const [contents, external] of [
    ['import left from "left-pad"; console.log(left);', ["left-pad"]],
    ['const loaded = await import("left-pad"); console.log(loaded);', ["left-pad"]],
    ['const loaded = require("left-pad"); console.log(loaded);', ["left-pad"]]
  ]) {
    const { metafile: record } = await bundled(contents, external);
    assert.throws(() => assertSelfContainedMetafile(record, "launcher:vestra"), refused(/left-pad/u), contents);
  }
  const builtins = await bundled('import { readFile } from "node:fs/promises"; console.log(readFile);');
  assert.doesNotThrow(() => assertSelfContainedMetafile(builtins.metafile, "launcher:vestra"));
});

test("a bundled string shaped like an import is not an import", async () => {
  const { metafile: record, text } = await bundled(
    "export const hint = ' import from \"@strands-agents/sdk\"'; console.log(hint);"
  );
  // why: the text scan this replaces would have read this as an external import.
  assert.match(text, /import from "@strands-agents\/sdk"/u);
  assert.deepEqual(sealedRuntimeImports(record, "launcher:vestra"), []);
  assert.doesNotThrow(() => assertSelfContainedMetafile(record, "launcher:vestra"));
});

test("every sealed artifact of this tree bundles and imports node: built-ins only", async () => {
  for (const componentId of Object.keys(SEALED_BUNDLE_ENTRIES)) {
    const { bytes, metafile: record } = await bundleSealedLauncherWithMetafile({
      repository: ROOT,
      componentId,
      semanticVersion: "9.9.9-sealed",
      nodeVersion: process.version.slice(1)
    });
    assert.ok(bytes.byteLength > 0);
    const imports = sealedRuntimeImports(record, componentId);
    assert.ok(imports.length > 0, componentId);
    assert.deepEqual(
      imports.filter((entry) => !entry.path.startsWith("node:")),
      [],
      componentId
    );
  }
});

// why: the bundler itself must refuse, not only a caller that asks: an entry
// that reaches an unprefixed built-in is left external by the bundler, which
// is exactly what a sealed artifact may not import.
test("the sealed bundler refuses an entry that imports outside node:, in every import kind", async () => {
  const repository = await mkdtemp(join(tmpdir(), "verchestra-self-containment-"));
  try {
    const closure = join(repository, "apps", "vestra-cli", "closure");
    await mkdir(closure, { recursive: true });
    await writeFile(join(closure, "node-sqlite-lazy.ts"), "export {};\n");
    for (const [kind, source] of [
      ["import-statement", 'import { readFileSync } from "fs";\nconsole.log(readFileSync);\n'],
      ["dynamic-import", 'const loaded = await import("fs");\nconsole.log(loaded);\n'],
      ["require-call", 'const loaded = require("fs");\nconsole.log(loaded);\n']
    ]) {
      await writeFile(join(closure, "vestra-entry.ts"), source);
      await assert.rejects(
        bundleSealedLauncherWithMetafile({
          repository,
          componentId: "launcher:vestra",
          semanticVersion: "9.9.9-sealed",
          nodeVersion: process.version.slice(1)
        }),
        refused(new RegExp(`launcher:vestra imports fs \\(${kind}\\) at run time`, "u")),
        kind
      );
    }
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});
