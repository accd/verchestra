// T69 T3 security: a symlink or junction ancestor cannot smuggle a disposable
// root into guarded state. The adapter's link-chain facts expose the hop and
// the application rule refuses it (TST-01), and production material is
// rejected end-to-end (TST-02).
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { assertDisjointRoot, SelfTestOrchestrator } from "../../packages/application/src/index.ts";
import { DisposableRootProvider, normalizeFactPath, probeRootFacts } from "../../packages/self-test/src/index.ts";

const bases = [];

async function base() {
  const directory = await mkdtemp(join(tmpdir(), "verchestra-selftest-escape-"));
  bases.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(bases.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

// Junctions need no privileges on Windows; directory symlinks need none on
// POSIX. Either way the escape mechanism under test is a link-like ancestor.
function linkType() {
  return platform() === "win32" ? "junction" : "dir";
}

test("a link-like ancestor into guarded state is exposed in linkChain and refused as overlap", async () => {
  const directory = await base();
  const guardedDir = join(directory, "guarded-workspace");
  await mkdir(join(guardedDir, "inner"), { recursive: true });
  const link = join(directory, "innocent-alias");
  await symlink(guardedDir, link, linkType());

  const guardedFacts = await probeRootFacts(guardedDir);
  const candidateFacts = await probeRootFacts(join(link, "inner"));

  assert.ok(
    candidateFacts.linkChain.some((entry) => entry === normalizeFactPath(guardedDir)),
    `linkChain must expose the resolved guarded target; got ${JSON.stringify(candidateFacts.linkChain)}`
  );
  assert.throws(() => assertDisjointRoot(candidateFacts, [guardedFacts]), { code: "VES_SELFTEST_ROOT_OVERLAP" });
});

test("the resolved real path alone also refuses a link-shrouded candidate", async () => {
  const directory = await base();
  const guardedDir = join(directory, "guarded-two");
  await mkdir(guardedDir, { recursive: true });
  const link = join(directory, "alias-two");
  await symlink(guardedDir, link, linkType());
  const candidateFacts = await probeRootFacts(link);
  const guardedFacts = await probeRootFacts(guardedDir);
  assert.throws(() => assertDisjointRoot(candidateFacts, [guardedFacts]), { code: "VES_SELFTEST_ROOT_OVERLAP" });
});

test("an orchestrated run refuses production material before the subject executes", async () => {
  const provider = new DisposableRootProvider({ baseDirectory: await base() });
  let subjectRan = false;
  const orchestrator = new SelfTestOrchestrator({
    guardedRoots: async () => [],
    roots: {
      provision: (profileId) => provider.provision(profileId),
      cleanup: (root) => provider.cleanup(root),
      quarantine: (root, reason) => provider.quarantine(root, reason)
    },
    sentinels: { capture: async () => [] },
    subject: {
      materials: async () => [{ materialId: "key:production-signing", kind: "key", testOnly: false }],
      run: async () => {
        subjectRan = true;
        return { checkCount: 0, durationMs: 0, evidenceRefs: [], failureCodes: [], redactionCount: 0 };
      }
    }
  });
  await assert.rejects(orchestrator.run("smoke"), { code: "VES_SELFTEST_PRODUCTION_MATERIAL" });
  assert.equal(subjectRan, false);
});

test("a real adapter-backed smoke run ends removed with a PASS payload", async () => {
  const provider = new DisposableRootProvider({ baseDirectory: await base() });
  const orchestrator = new SelfTestOrchestrator({
    guardedRoots: async () => [await probeRootFacts(process.cwd())],
    roots: {
      provision: (profileId) => provider.provision(profileId),
      cleanup: (root) => provider.cleanup(root),
      quarantine: (root, reason) => provider.quarantine(root, reason)
    },
    sentinels: { capture: async () => [{ sentinelId: "static", digest: "sha256:fixed" }] },
    subject: {
      materials: async () => [{ materialId: "key:test-only", kind: "key", testOnly: true }],
      run: async () => ({ checkCount: 1, durationMs: 5, evidenceRefs: [], failureCodes: [], redactionCount: 0 })
    }
  });
  const result = await orchestrator.run("smoke");
  assert.equal(result.rootState, "removed");
  assert.equal(result.payload["self_test.verdict"], "PASS");
});
