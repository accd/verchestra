import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { MemoryPromotionLifecycle } from "../../packages/memory/src/index.ts";
import {
  approval,
  artifactPlanner,
  controlOwnerId,
  digest,
  lifecycleRoot,
  memoryHit,
  now,
  objectInput,
  placementSnapshot,
  projectId,
  promotionInput,
  workspaceId
} from "../helpers/memory-lifecycle-fixture.mjs";

async function opened(options = {}) {
  const paths = await lifecycleRoot();
  const lifecycle = new MemoryPromotionLifecycle({
    dbPath: paths.dbPath,
    objectRoot: paths.objectRoot,
    ownerRoots: paths.ownerRoots,
    artifactPlanner: paths.artifactPlanner,
    now: () => now,
    ...options
  });
  lifecycle.open();
  return { ...paths, lifecycle };
}

test("promotion cannot publish without a review", async () => {
  const { controlRoot, lifecycle } = await opened();
  const plan = lifecycle.proposePromotion(promotionInput());
  await assert.rejects(lifecycle.applyPromotion(plan, {}), { code: "VES_MEMORY_LIFECYCLE_INVALID" });
  await assert.rejects(access(join(controlRoot, ...plan.writePlan.writes[0].logicalPath.split("/"))));
  lifecycle.close();
});

test("non-human review cannot authorize canonical promotion", async () => {
  const { lifecycle } = await opened();
  const plan = lifecycle.proposePromotion(promotionInput());
  await assert.rejects(
    lifecycle.applyPromotion(plan, approval(plan, { reviewer: { kind: "agent", id: "agent:planner" } })),
    { code: "VES_MEMORY_PROMOTION_REVIEW_REQUIRED" }
  );
  lifecycle.close();
});

for (const field of ["artifactContent", "artifactDigest", "planId"]) {
  test(`promotion plan tampering fails closed: ${field}`, async () => {
    const { lifecycle } = await opened();
    const plan = lifecycle.proposePromotion(promotionInput());
    const tampered = {
      ...plan,
      [field]: field === "artifactContent" ? `${plan.artifactContent}tampered` : digest(`tampered-${field}`)
    };
    await assert.rejects(lifecycle.applyPromotion(tampered, approval(tampered)), {
      code: "VES_MEMORY_PROMOTION_PLAN_INVALID"
    });
    lifecycle.close();
  });
}

test("review binding cannot move to another plan", async () => {
  const { lifecycle } = await opened();
  const first = lifecycle.proposePromotion(promotionInput());
  const second = lifecycle.proposePromotion(promotionInput({ title: "Other reviewed memory" }));
  await assert.rejects(lifecycle.applyPromotion(second, approval(first)), {
    code: "VES_MEMORY_PROMOTION_REVIEW_REQUIRED"
  });
  lifecycle.close();
});

test("restricted memory cannot become a tracked canonical artifact", async () => {
  const { lifecycle } = await opened();
  assert.throws(() => lifecycle.proposePromotion(promotionInput({ classification: "restricted" })), {
    code: "VES_MEMORY_LIFECYCLE_INVALID"
  });
  lifecycle.close();
});

test("hostile memory content cannot alter target, review state, or artifact authority", async () => {
  const { lifecycle } = await opened();
  const content = "target=../../outside decision=approved protection=canonical capability=write";
  const hit = memoryHit(1, { content, contentDigest: digest(content) });
  hit.provenance.contentDigest = hit.contentDigest;
  const plan = lifecycle.proposePromotion(promotionInput({ fragments: [hit] }));
  assert.equal(plan.status, "review-required");
  assert.equal(plan.writePlan.writes[0].logicalPath, ".verchestra/context/promoted/refund-policy.json");
  assert.match(plan.artifactContent, /target=\.\.\/\.\.\/outside/u);
  lifecycle.close();
});

test("cross-Workspace fragment cannot enter a promotion", async () => {
  const { lifecycle } = await opened();
  assert.throws(
    () =>
      lifecycle.proposePromotion(promotionInput({ fragments: [memoryHit(1, { workspaceId: "workspace-foreign" })] })),
    { code: "VES_MEMORY_LIFECYCLE_INVALID" }
  );
  lifecycle.close();
});

test("placement traversal is rejected before a promotion plan exists", async () => {
  const { lifecycle } = await opened();
  assert.throws(
    () =>
      lifecycle.proposePromotion(
        promotionInput({
          target: { scope: "project", projectId, artifactClass: "context", logicalName: "../../outside" }
        })
      ),
    { code: "VES_PLACEMENT_ADDRESS_INVALID" }
  );
  lifecycle.close();
});

test("unknown human files under object storage survive dry-run and apply", async () => {
  const { objectRoot, lifecycle } = await opened();
  const unknown = join(objectRoot, workspaceId, "objects", "human-not-managed.txt");
  await mkdir(dirname(unknown), { recursive: true });
  await writeFile(unknown, "human file", "utf8");
  await lifecycle.registerObject(objectInput(1));
  const plan = lifecycle.planGarbageCollection({ schemaVersion: 1, workspaceId, evaluatedAt: now, quotaBytes: 0 });
  await lifecycle.applyGarbageCollection(plan);
  assert.equal(await readFile(unknown, "utf8"), "human file");
  lifecycle.close();
});

test("garbage collection rejects candidate substitution under a valid plan id", async () => {
  const { lifecycle } = await opened();
  await lifecycle.registerObject(objectInput(1));
  const protectedObject = await lifecycle.registerObject(objectInput(2, { protection: "canonical" }));
  const plan = lifecycle.planGarbageCollection({ schemaVersion: 1, workspaceId, evaluatedAt: now, quotaBytes: 0 });
  const tampered = {
    ...plan,
    candidates: [{ ...plan.candidates[0], objectId: protectedObject.objectId }]
  };
  await assert.rejects(lifecycle.applyGarbageCollection(tampered), { code: "VES_MEMORY_GC_PLAN_INVALID" });
  assert.ok(lifecycle.listObjects({ workspaceId, projectId }).every((object) => object.state === "active"));
  lifecycle.close();
});

for (const protection of ["canonical", "required-evidence"]) {
  test(`${protection} object cannot be forgotten`, async () => {
    const { lifecycle } = await opened();
    const object = await lifecycle.registerObject(objectInput(1, { protection }));
    await assert.rejects(lifecycle.forget({ schemaVersion: 1, workspaceId, objectId: object.objectId }), {
      code: "VES_MEMORY_OBJECT_PROTECTED"
    });
    lifecycle.close();
  });
}

test("legal hold object cannot be forgotten", async () => {
  const { lifecycle } = await opened();
  const object = await lifecycle.registerObject(objectInput(1));
  lifecycle.setLegalHold({ schemaVersion: 1, workspaceId, objectId: object.objectId, holdId: "hold:case-1" });
  await assert.rejects(lifecycle.forget({ schemaVersion: 1, workspaceId, objectId: object.objectId }), {
    code: "VES_MEMORY_OBJECT_PROTECTED"
  });
  lifecycle.close();
});

test("protected object cannot be invalidated", async () => {
  const { lifecycle } = await opened();
  const object = await lifecycle.registerObject(objectInput(1, { protection: "required-evidence" }));
  await assert.rejects(
    lifecycle.invalidateObject({ schemaVersion: 1, workspaceId, objectId: object.objectId, reason: "stale" }),
    { code: "VES_MEMORY_OBJECT_PROTECTED" }
  );
  lifecycle.close();
});

test("cross-Workspace list and forget reveal no object", async () => {
  const { lifecycle } = await opened();
  const object = await lifecycle.registerObject(objectInput(1));
  assert.deepEqual(lifecycle.listObjects({ workspaceId: "workspace-foreign", projectId }), []);
  await assert.rejects(
    lifecycle.forget({ schemaVersion: 1, workspaceId: "workspace-foreign", objectId: object.objectId }),
    { code: "VES_MEMORY_LIFECYCLE_INVALID" }
  );
  lifecycle.close();
});

test("cross-Workspace reference cannot protect or expose another object", async () => {
  const { lifecycle } = await opened();
  const first = await lifecycle.registerObject(objectInput(1));
  const second = await lifecycle.registerObject(objectInput(2, { workspaceId: "workspace-foreign" }));
  assert.throws(
    () =>
      lifecycle.addReference({
        schemaVersion: 1,
        workspaceId,
        fromObjectId: first.objectId,
        toObjectId: second.objectId
      }),
    { code: "VES_MEMORY_LIFECYCLE_INVALID" }
  );
  lifecycle.close();
});

test("sensitive object requires a logical encryption key reference", async () => {
  const { lifecycle } = await opened();
  await assert.rejects(lifecycle.registerObject(objectInput(1, { classification: "confidential" })), {
    code: "VES_MEMORY_LIFECYCLE_INVALID"
  });
  lifecycle.close();
});

test("credential and authority fields have no accepted managed-object shape", async () => {
  const { lifecycle } = await opened();
  await assert.rejects(
    lifecycle.registerObject({ ...objectInput(1), credentialValue: "secret", authority: "canonical" }),
    { code: "VES_MEMORY_LIFECYCLE_INVALID" }
  );
  lifecycle.close();
});

test("symlinked promotion parent cannot redirect a canonical write outside its owner", async () => {
  const { root, controlRoot, lifecycle } = await opened();
  const outside = join(root, "outside");
  await mkdir(outside, { recursive: true });
  await mkdir(join(controlRoot, ".verchestra"), { recursive: true });
  await symlink(outside, join(controlRoot, ".verchestra", "context"), "junction");
  const plan = lifecycle.proposePromotion(promotionInput());
  await assert.rejects(lifecycle.applyPromotion(plan, approval(plan)), {
    code: "VES_MEMORY_PROMOTION_TARGET_INVALID"
  });
  await assert.rejects(access(join(outside, "promoted", "refund-policy.json")));
  lifecycle.close();
});

test("linked promotion target cannot redirect canonical publication", async () => {
  const { root, controlRoot, lifecycle } = await opened();
  const plan = lifecycle.proposePromotion(promotionInput());
  const target = join(controlRoot, ...plan.writePlan.writes[0].logicalPath.split("/"));
  const outside = join(root, "outside-promotion");
  await mkdir(dirname(target), { recursive: true });
  await mkdir(outside);
  await symlink(outside, target, "junction");
  await assert.rejects(lifecycle.applyPromotion(plan, approval(plan)), {
    code: "VES_MEMORY_PROMOTION_TARGET_INVALID"
  });
  lifecycle.close();
});

test("symlinked object namespace cannot redirect managed bytes outside object storage", async () => {
  const { root, objectRoot, lifecycle } = await opened();
  const outside = join(root, "object-outside");
  await mkdir(outside, { recursive: true });
  await symlink(outside, join(objectRoot, workspaceId), "junction");
  await assert.rejects(lifecycle.registerObject(objectInput(1)), {
    code: "VES_MEMORY_PROMOTION_TARGET_INVALID"
  });
  await assert.rejects(access(join(outside, "objects")));
  lifecycle.close();
});

test("linked managed-object target cannot redirect content-addressed bytes", async () => {
  const { root, objectRoot, lifecycle } = await opened();
  const object = await lifecycle.registerObject(objectInput(1));
  const target = join(objectRoot, workspaceId, "objects", `${object.objectId.slice(7)}.blob`);
  const outside = join(root, "outside-object");
  await mkdir(outside);
  await rm(target);
  await symlink(outside, target, "junction");
  await assert.rejects(lifecycle.registerObject(objectInput(1)), {
    code: "VES_MEMORY_PROMOTION_TARGET_INVALID"
  });
  lifecycle.close();
});

test("lifecycle migration checksum drift fails closed", async () => {
  const { dbPath, lifecycle } = await opened();
  lifecycle.close();
  const db = new DatabaseSync(dbPath);
  db.prepare("UPDATE ves_memory_lifecycle_migrations SET checksum=? WHERE id=?").run(
    `sha256:${"0".repeat(64)}`,
    "001-lifecycle"
  );
  db.close();
  const reopened = new MemoryPromotionLifecycle({
    dbPath,
    objectRoot: join(dirname(dbPath), "objects"),
    ownerRoots: {},
    artifactPlanner,
    now: () => now
  });
  assert.throws(() => reopened.open(), { code: "VES_MEMORY_LIFECYCLE_MIGRATION_DRIFT" });
});

test("incomplete lifecycle schema fails closed even with an intact migration ledger", async () => {
  const paths = await lifecycleRoot();
  const lifecycle = new MemoryPromotionLifecycle({ ...paths, now: () => now });
  lifecycle.open();
  lifecycle.close();
  const db = new DatabaseSync(paths.dbPath);
  db.exec("DROP TABLE memory_gc_runs");
  db.close();
  const reopened = new MemoryPromotionLifecycle({ ...paths, now: () => now });
  assert.throws(() => reopened.open(), { code: "VES_MEMORY_LIFECYCLE_CORRUPT" });
});

test("external-control placement never writes into an ignored project root", async () => {
  const { lifecycle } = await opened();
  const plan = lifecycle.proposePromotion(
    promotionInput({
      placement: placementSnapshot({
        placementMode: "external-control",
        projects: [
          {
            ...placementSnapshot().projects[0],
            gitOwnerId: `sha256:${"b".repeat(64)}`,
            gitRelation: "nested",
            ignoredByControl: true
          }
        ]
      })
    })
  );
  assert.equal(plan.writePlan.writes[0].gitOwnerId, controlOwnerId);
  assert.match(plan.writePlan.writes[0].logicalPath, /^\.verchestra\/projects\/api/u);
  lifecycle.close();
});

// Regression for the platform matrix's darwin failure: macOS resolves the temp
// root /var into /private/var and Windows expands 8.3 names such as RUNNER~1,
// so every configured root is routinely an alias of its canonical directory.
// assertSafeTarget compared an aliased ancestry against the canonical root and
// reported "Target ancestry escapes its owner" for perfectly contained targets.
// A directory link (junction on Windows, symlink on POSIX) reproduces the alias
// on any platform; the full lifecycle must operate through it.
test("lifecycle operates through roots reached by a canonicalizing directory link", async () => {
  const paths = await lifecycleRoot();
  const aliasParent = await mkdtemp(join(tmpdir(), "verchestra-lifecycle-alias-"));
  const alias = join(aliasParent, "alias");
  await symlink(paths.root, alias, "junction");
  assert.notEqual(alias, await realpath(alias), "the alias must canonicalize to a different path");

  const lifecycle = new MemoryPromotionLifecycle({
    dbPath: paths.dbPath,
    objectRoot: join(alias, "objects"),
    ownerRoots: { [controlOwnerId]: join(alias, "control") },
    artifactPlanner: paths.artifactPlanner,
    now: () => now
  });
  lifecycle.open();

  // Object storage + garbage collection walk assertSafeTarget on the aliased
  // object root.
  await lifecycle.registerObject(objectInput(1));
  const plan = lifecycle.planGarbageCollection({ schemaVersion: 1, workspaceId, evaluatedAt: now, quotaBytes: 0 });
  await lifecycle.applyGarbageCollection(plan);

  // Promotion publishes through the aliased owner root.
  const promotion = lifecycle.proposePromotion(promotionInput());
  const outcome = await lifecycle.applyPromotion(promotion, approval(promotion));
  assert.equal(outcome.outcome, "published");
  const published = join(paths.controlRoot, ...promotion.writePlan.writes[0].logicalPath.split("/"));
  assert.equal((await readFile(published, "utf8")).length > 0, true);
  lifecycle.close();
  await rm(aliasParent, { recursive: true, force: true });
});

// #58 (memory vertical): memory-lifecycle.ts ordered canonical-JSON object
// members -- and the promoted artifact's fragment list -- with
// String.prototype.localeCompare, which is locale-dependent and diverges from
// UTF-16 code-unit order for the mixed-case ASCII identifiers this surface
// accepts (SAFE allows [A-Za-z0-9]). It also joined the fragment sort key with
// NUL, which ICU treats as completely ignorable, collapsing the field
// boundary. Replacing localeCompare with a comparator that reverses code-unit
// order simulates a divergent collation without depending on any particular
// installed ICU locale disagreeing on the host running the test.
async function withHostileLocaleCompare(run) {
  const original = String.prototype.localeCompare;
  String.prototype.localeCompare = function hostileLocaleCompare(other) {
    const left = String(this);
    return left < other ? 1 : left > other ? -1 : 0;
  };
  try {
    return await run();
  } finally {
    String.prototype.localeCompare = original;
  }
}

function mixedCaseFragment(index, sourceId, chunkId) {
  const hit = memoryHit(index, { sourceId, chunkId });
  return { ...hit, provenance: { ...hit.provenance, sourceId } };
}

const mixedCasePromotion = () =>
  promotionInput({
    fragments: [mixedCaseFragment(1, "source-a", "chunk-a"), mixedCaseFragment(2, "Source-b", "Chunk-b")]
  });

test("promotion plan identity and artifact bytes are stable across divergent locale collations", async () => {
  const { lifecycle } = await opened();
  const plain = lifecycle.proposePromotion(mixedCasePromotion());
  const hostile = await withHostileLocaleCompare(() => lifecycle.proposePromotion(mixedCasePromotion()));
  assert.equal(plain.planId, hostile.planId);
  assert.equal(plain.artifactDigest, hostile.artifactDigest);
  assert.equal(plain.artifactContent, hostile.artifactContent);
  // Code-unit order specifically, not merely "some" deterministic order:
  // uppercase sorts before lowercase in UTF-16, so "Source-b" leads even
  // though every ambient collation the repository has met orders "source-a"
  // first.
  assert.deepEqual(
    JSON.parse(plain.artifactContent).fragments.map((fragment) => fragment.source.sourceId),
    ["Source-b", "source-a"]
  );
  lifecycle.close();
});

test("a promotion plan proposed under a hostile locale still verifies and publishes", async () => {
  const { controlRoot, lifecycle } = await opened();
  const plan = await withHostileLocaleCompare(() => lifecycle.proposePromotion(mixedCasePromotion()));
  const outcome = await lifecycle.applyPromotion(plan, approval(plan));
  assert.equal(outcome.outcome, "published");
  const published = join(controlRoot, ...plan.writePlan.writes[0].logicalPath.split("/"));
  assert.equal(digest(await readFile(published, "utf8")), plan.artifactDigest);
  lifecycle.close();
});

test("managed object identity is stable across divergent locale collations", async () => {
  const plain = await opened();
  const hostile = await opened();
  const first = await plain.lifecycle.registerObject(objectInput(1));
  const second = await withHostileLocaleCompare(() => hostile.lifecycle.registerObject(objectInput(1)));
  assert.equal(first.objectId, second.objectId);
  plain.lifecycle.close();
  hostile.lifecycle.close();
});

test("garbage collection plan identity, stored receipt and state digest are locale-independent", async () => {
  const { lifecycle } = await opened();
  await lifecycle.registerObject(objectInput(1));
  await lifecycle.registerObject(objectInput(2));
  const request = { schemaVersion: 1, workspaceId, evaluatedAt: now, quotaBytes: 0 };
  const plan = lifecycle.planGarbageCollection(request);
  const hostilePlan = await withHostileLocaleCompare(() => lifecycle.planGarbageCollection(request));
  assert.equal(plan.planId, hostilePlan.planId);
  assert.deepEqual(plan.candidates, hostilePlan.candidates);

  // The receipt is stored as canonical JSON and re-encoded on replay: applying
  // under a hostile collation and replaying under the ambient one must agree,
  // or the replay fails closed with VES_MEMORY_LIFECYCLE_CORRUPT.
  const applied = await withHostileLocaleCompare(() => lifecycle.applyGarbageCollection(plan));
  const replayed = await lifecycle.applyGarbageCollection(plan);
  assert.deepEqual(replayed.quarantinedObjectIds, applied.quarantinedObjectIds);

  assert.equal(lifecycle.stateDigest(), await withHostileLocaleCompare(() => lifecycle.stateDigest()));
  lifecycle.close();
});
