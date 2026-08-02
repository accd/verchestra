// T69 T3: the adapter produces facts; these tests prove the facts are
// complete, honest, and bounded. Verdicts over the facts are covered by
// tests/unit/self-test-rules.test.mjs.
import assert from "node:assert/strict";
import { verify as cryptoVerify, createPublicKey } from "node:crypto";
import { chmod, lstat, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { platform, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";
import {
  BoundedFixtureFactory,
  DisposableRootProvider,
  SentinelCatalog,
  fixtureJoin,
  sha256,
  testOnlyKeyMaterial
} from "../../packages/self-test/src/index.ts";

const bases = [];

async function base() {
  const directory = await mkdtemp(join(tmpdir(), "verchestra-selftest-adapter-"));
  bases.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(bases.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test("provisioned roots carry complete facts and are disjoint between runs", async () => {
  const provider = new DisposableRootProvider({ baseDirectory: await base() });
  const first = await provider.provision("smoke");
  const second = await provider.provision("smoke");
  for (const facts of [first, second]) {
    assert.ok(facts.canonicalPath.length > 0 && !facts.canonicalPath.includes("\\"));
    assert.ok(facts.realPath.length > 0 && facts.deviceId.length > 0 && facts.inodeId.length > 0);
    assert.ok(Array.isArray(facts.linkChain));
  }
  assert.notEqual(first.canonicalPath, second.canonicalPath);
  assert.notEqual(first.inodeId, second.inodeId);
});

test("cleanup proves removal: the root no longer exists afterwards", async () => {
  const provider = new DisposableRootProvider({ baseDirectory: await base() });
  const root = await provider.provision("smoke");
  await writeFile(fixtureJoin(root, "leftover.txt"), "x");
  const outcome = await provider.cleanup(root);
  assert.equal(outcome.removed, true);
  assert.deepEqual(outcome.residue, []);
  assert.equal(await lstat(root.canonicalPath).catch(() => null), null);
});

// Removal must be a proven fact, not an assumption that `rm` worked. Proving
// that requires removal to genuinely fail: Windows cannot delete a directory
// that is a process's working directory, and POSIX cannot unlink from a
// read-only parent. Both restore immediately.
async function makeUndeletable(root) {
  if (platform() === "win32") {
    const previous = process.cwd();
    process.chdir(root);
    return () => {
      process.chdir(previous);
    };
  }
  await chmod(dirname(root), 0o555);
  return () => chmod(dirname(root), 0o755);
}

test("cleanup reports removed false with residue when the root survives", async () => {
  const provider = new DisposableRootProvider({ baseDirectory: await base() });
  const root = await provider.provision("smoke");
  await writeFile(fixtureJoin(root, "stuck.txt"), "still here");
  const release = await makeUndeletable(root.canonicalPath);
  const outcome = await provider.cleanup(root);
  await release();

  assert.notEqual(
    await lstat(root.canonicalPath).catch(() => null),
    null,
    "the arrangement failed: the root was deleted, so this case proves nothing"
  );
  assert.equal(outcome.removed, false, "cleanup must not claim a removal it cannot prove");
  assert.ok(outcome.residue.length > 0, "surviving content must be reported as residue");
});

test("quarantine renames the root aside with a marker naming the reason", async () => {
  const directory = await base();
  const provider = new DisposableRootProvider({ baseDirectory: directory });
  const root = await provider.provision("smoke");
  await writeFile(fixtureJoin(root, "residue.bin"), "stuck");
  const outcome = await provider.quarantine(root, "sentinel mutation: workspace.db");
  assert.equal(outcome.quarantined, true);
  assert.equal(await lstat(root.canonicalPath).catch(() => null), null, "original path must be gone");
  const quarantined = (await readdir(directory)).filter((entry) => entry.includes(".quarantined-"));
  assert.equal(quarantined.length, 1);
  const marker = await readFile(join(directory, quarantined[0], "QUARANTINE.txt"), "utf8");
  assert.match(marker, /sentinel mutation: workspace\.db/u);
});

test("quarantining a root that no longer exists reports quarantined false, never success", async () => {
  const provider = new DisposableRootProvider({ baseDirectory: await base() });
  const root = await provider.provision("smoke");
  await provider.cleanup(root);
  const outcome = await provider.quarantine(root, "already gone");
  assert.equal(outcome.quarantined, false);
});

test("the fixture factory writes inside the root, tracks bytes, and fails closed on budget", async () => {
  const provider = new DisposableRootProvider({ baseDirectory: await base() });
  const root = await provider.provision("smoke");
  const factory = new BoundedFixtureFactory(root, 10);
  const written = await factory.write("nested/dir/a.txt", "12345");
  assert.ok(written.startsWith(root.canonicalPath));
  assert.equal(factory.writtenBytes, 5);
  await assert.rejects(factory.write("b.txt", "123456"), { code: "VES_SELFTEST_FIXTURE_BUDGET" });
  assert.equal(factory.writtenBytes, 5, "a rejected write must not consume budget");
});

test("a fixture path that escapes the root fails closed before any write", async () => {
  const provider = new DisposableRootProvider({ baseDirectory: await base() });
  const root = await provider.provision("smoke");
  const factory = new BoundedFixtureFactory(root, 1024);
  await assert.rejects(factory.write("../outside.txt", "nope"), { code: "VES_SELFTEST_FIXTURE_ESCAPE" });
});

test("sentinel capture digests content, reports absence, and reflects change", async () => {
  const directory = await base();
  const sentinelPath = join(directory, "state.db");
  await writeFile(sentinelPath, "original");
  const catalog = new SentinelCatalog([
    { sentinelId: "state.db", path: sentinelPath },
    { sentinelId: "missing", path: join(directory, "nope") }
  ]);
  const before = await catalog.capture();
  assert.equal(before[0].digest, sha256("original"));
  assert.equal(before[1].digest, "absent");
  await writeFile(sentinelPath, "tampered");
  const after = await catalog.capture();
  assert.notEqual(after[0].digest, before[0].digest);
});

test("test-only key material declares itself and produces verifiable signatures", () => {
  const key = testOnlyKeyMaterial("key:selftest-run");
  assert.deepEqual(key.material, { materialId: "key:selftest-run", kind: "key", testOnly: true });
  const data = Buffer.from("self-test payload");
  const signature = Buffer.from(key.sign(data), "base64url");
  const publicKey = createPublicKey({
    key: Buffer.from(key.publicKeyDer, "base64url"),
    format: "der",
    type: "spki"
  });
  assert.equal(cryptoVerify(null, data, publicKey, signature), true);
});
