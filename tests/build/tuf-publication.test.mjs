import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  NodeFilesystemDistributionSource,
  TufUpdateClient
} from "../../packages/distribution/src/tuf-update-client.ts";
import {
  buildTufReleasePublication,
  writeTufReleasePublication
} from "../../packages/distribution/src/tuf-publication.ts";
import { component } from "../helpers/hermetic-bundle-fixture.mjs";
import { fixture, MapDistributionSource } from "../helpers/tuf-publication-fixture.mjs";

const resolvePublication = async (publication, mode) => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-tuf-publication-"));
  const client = new TufUpdateClient({
    trustRootDirectory: join(root, "trust"),
    stagingRoot: join(root, "staging"),
    trustedRoot: publication.trustedRoot,
    source: new MapDistributionSource(publication, mode),
    chunkSize: 17
  });
  try {
    return await client.resolveAndStage({ platform: "win32", arch: "x64" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

test("publishes a signed root, delegated components, and a complete bundle", async () => {
  const { bundle, publication } = fixture();
  assert.equal(publication.releaseDigest, bundle.releaseDigest);
  assert.equal(publication.metadata.has("root.json"), true);
  assert.equal(publication.metadata.has("1.components.json"), true);
  assert.equal(publication.targets.size, bundle.components.length + 1);
  for (const mode of ["online", "mirror", "offline", "air-gapped"]) {
    const staged = await resolvePublication(publication, mode);
    assert.equal(staged.releaseDigest, bundle.releaseDigest);
    assert.equal(staged.sourceMode, mode);
    assert.deepEqual(staged.bundle, bundle);
    assert.equal(staged.components.length, bundle.components.length);
  }
});

test("publication identity is independent of component descriptor order", () => {
  const { candidate, componentBytes, roles, expires, publication } = fixture();
  const reversed = buildTufReleasePublication({
    schemaVersion: 1,
    candidate,
    componentBytes: [...componentBytes].reverse(),
    metadataVersion: 1,
    rootVersion: 1,
    expires,
    roles,
    consistentSnapshot: true
  });
  assert.equal(Buffer.from(publication.trustedRoot).toString("hex"), Buffer.from(reversed.trustedRoot).toString("hex"));
  assert.deepEqual([...publication.metadata], [...reversed.metadata]);
  assert.deepEqual([...publication.targets], [...reversed.targets]);
});

test("publication can emit non-consistent-snapshot paths without changing the bundle", async () => {
  const { bundle, candidate, componentBytes, roles, expires } = fixture();
  const publication = buildTufReleasePublication({
    schemaVersion: 1,
    candidate,
    componentBytes,
    metadataVersion: 1,
    rootVersion: 1,
    expires,
    roles,
    consistentSnapshot: false
  });
  const staged = await resolvePublication(publication, "offline");
  assert.equal(staged.releaseDigest, bundle.releaseDigest);
  assert.equal(publication.targets.has(publication.manifestPath), true);
});

test("writes a complete publication atomically into metadata and targets views", async () => {
  const { publication } = fixture();
  const root = await mkdtemp(join(tmpdir(), "verchestra-tuf-filesystem-"));
  const destination = join(root, "repository");
  try {
    const layout = await writeTufReleasePublication(publication, destination);
    assert.equal(layout.directory, destination);
    for (const [path, bytes] of publication.metadata) {
      assert.deepEqual(await readFile(join(layout.metadataDirectory, path)), Buffer.from(bytes));
    }
    for (const [path, bytes] of publication.targets) {
      assert.deepEqual(await readFile(join(layout.targetsDirectory, path)), Buffer.from(bytes));
    }
    const staged = await new TufUpdateClient({
      trustRootDirectory: join(root, "trust"),
      stagingRoot: join(root, "staging"),
      trustedRoot: publication.trustedRoot,
      source: new NodeFilesystemDistributionSource({
        mode: "offline",
        sourceId: "source:offline:filesystem",
        root: layout.directory
      }),
      chunkSize: 17
    }).resolveAndStage({ platform: "win32", arch: "x64" });
    assert.equal(staged.releaseDigest, publication.releaseDigest);
    await assert.rejects(() => writeTufReleasePublication(publication, destination), {
      code: "VES_TUF_PUBLICATION_DESTINATION_EXISTS"
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects unsafe target paths before creating a publication directory", async () => {
  const { publication } = fixture();
  const root = await mkdtemp(join(tmpdir(), "verchestra-tuf-paths-"));
  const destination = join(root, "repository");
  const unsafe = {
    ...publication,
    targets: new Map([["../escape.bin", Buffer.from("escape")]])
  };
  try {
    await assert.rejects(() => writeTufReleasePublication(unsafe, destination), {
      code: "VES_TUF_PUBLICATION_PATH_INVALID"
    });
    await assert.rejects(() => lstat(destination), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a realistic bundle with nested and runtime component paths stages end to end", async () => {
  // tuf-js matches delegation patterns segment by segment with equal segment
  // counts, so the former "components/*" glob could never match the nested
  // components/<trackedPath> paths a real candidate carries, and runtime/* and
  // native/* matched no glob at all — every such target was unresolvable. The
  // shared fixture's two-segment paths are exactly why this never surfaced,
  // so this bundle mirrors the real candidate's shape instead.
  const realistic = [
    component("node-runtime", "runtime:node", { logicalPath: "runtime/node" }),
    component("core-code", "core:verchestra", {
      logicalPath: "components/packages/distribution/src/tuf-update-client.ts"
    }),
    component("schema", "schemas:contracts", {
      logicalPath: "components/schemas/contracts/execution-package.schema.json"
    }),
    component("migration", "migrations:runtime", {
      logicalPath: "components/packages/workspace/src/init/safe-init.ts"
    }),
    component("policy", "policy:cedar", { logicalPath: "components/packages/policy/src/cedar-policy.ts" }),
    component("cedar-wasm", "wasm:cedar", { logicalPath: "native/cedar-wasm.wasm" }),
    component("sqlite-native", "native:sqlite", { logicalPath: "native/sqlite-vec" }),
    component("driver", "driver:claude", { logicalPath: "components/packages/drivers/src/claude-code-driver.ts" }),
    component("connector", "connector:jira", { logicalPath: "components/packages/connectors/src/jira/jira.ts" }),
    component("skill", "skill:tlc", { logicalPath: "components/packages/agent-runtime/src/skills/tlc.md" }),
    component("license", "license:product", { logicalPath: "licenses/product.txt" }),
    component("sbom", "sbom:cyclonedx", { logicalPath: "evidence/sbom.cdx.json" }),
    component("provenance", "provenance:build", { logicalPath: "evidence/provenance.intoto.jsonl" }),
    component("evaluation", "evaluation:release", { logicalPath: "evidence/evaluation.json" }),
    component("launcher", "launcher:vestra", { logicalPath: "bin/vestra.mjs" }),
    component("launcher", "launcher:verchestra", { logicalPath: "bin/verchestra.mjs" })
  ];
  const { bundle, publication } = fixture({ components: realistic });
  const nested = bundle.components.filter((entry) => entry.logicalPath.split("/").length >= 4);
  assert.ok(nested.length >= 5, "the bundle genuinely carries nested component paths");

  const staged = await resolvePublication(publication, "online");
  assert.equal(staged.releaseDigest, bundle.releaseDigest);
  assert.equal(staged.components.length, bundle.components.length);
  assert.deepEqual(
    staged.components.map((entry) => entry.logicalPath).sort(),
    bundle.components.map((entry) => entry.logicalPath).sort()
  );

  const root = await mkdtemp(join(tmpdir(), "verchestra-tuf-realistic-"));
  try {
    const written = await writeTufReleasePublication(publication, join(root, "publication"));
    const offline = await new TufUpdateClient({
      trustRootDirectory: join(root, "trust"),
      stagingRoot: join(root, "staging"),
      trustedRoot: publication.trustedRoot,
      source: new NodeFilesystemDistributionSource({
        mode: "offline",
        sourceId: "source:offline:realistic",
        root: written.directory
      })
    }).resolveAndStage({ platform: "win32", arch: "x64" });
    assert.equal(offline.releaseDigest, bundle.releaseDigest);
    assert.equal(offline.components.length, bundle.components.length);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
