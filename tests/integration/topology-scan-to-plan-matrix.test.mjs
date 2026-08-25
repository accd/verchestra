import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";

import { createWritePlan, effectivePlacement, scanWorkspace } from "../../packages/workspace/src/index.ts";
import { git, initRepository, scannerRoot, scannerRoots } from "../helpers/workspace-scanner-fixture.mjs";

// T75 topology matrix, lifecycle axis: scan -> plan.
//
// tests/integration/workspace-scanner.test.mjs proves the scanner classifies
// each Git relation, and tests/unit/topology-placement-matrix.test.mjs proves
// the placement policy decides correctly for every relation. Nothing joined
// them. The scanner emits `RepositoryInventory.relation`
// (workspace-scanner.ts:23) and the planner consumes
// `PlacementProject.gitRelation` (artifact-planning.ts:10); the two unions are
// declared in different packages, asserted independently, and their agreement
// was never executed. A relation the scanner can produce but the planner
// refuses would be a workspace that scans and then cannot be planned — and the
// first place it would surface is a user's machine.
//
// This file builds ONE real workspace carrying every relation at once, scans
// it, derives a placement snapshot from what the scanner actually reported, and
// plans against it. Every value crossing the seam comes from the scan; nothing
// is hand-written on the planner's side.
//
// FINDING recorded by this file, not fixed by it. There is no scan-to-plan
// adapter in the product. `createWritePlan`'s only product caller is
// packages/memory/src/memory-lifecycle.ts:581, and it receives a stored
// PlacementSnapshot (`row["placement"]`, :451) rather than one derived from a
// scan. The seam is therefore unimplemented, and the two sides have already
// drifted in a way that proves nobody has crossed it: the scanner mints
// `repositoryId` as a canonical V2 digest (`v2:sha256:...`,
// scanner-primitives.ts:139) while the planner's owner validator requires a
// bare `sha256:...`. A `repositoryId` handed straight to `gitOwnerId` is
// refused. `the scanner's repository identity is not directly usable as a
// placement owner` below pins that mismatch so it is recorded as a checked
// fact; the remaining tests apply the one lossless normalization that resolves
// it, and prove the rest of the bridge holds once it is applied. Writing the
// adapter is a product change and is deliberately out of this file's scope.

after(async () => Promise.all(scannerRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const PROJECT_MARKER = (name) => `{"name":"${name}","private":true}\n`;
const OWNER = /^sha256:[a-f0-9]{64}$/u;

// Builds a control repository containing every Git relation the scanner can
// classify. Returns the control root.
async function everyRelationWorkspace() {
  const source = await scannerRoot("verchestra-t75-submodule-source-");
  await initRepository(source, { "package.json": PROJECT_MARKER("submodule") });

  const root = await scannerRoot("verchestra-t75-topology-");
  await initRepository(root, { "package.json": PROJECT_MARKER("control") });

  // nested: an independently cloned repository inside the control tree.
  await initRepository(join(root, "projects", "nested"), { "package.json": PROJECT_MARKER("nested") });

  // submodule: a real Git submodule.
  git(root, "-c", "protocol.file.allow=always", "submodule", "add", "--quiet", source, "vendor/submodule");
  git(root, "commit", "--quiet", "-am", "add submodule");

  // worktree: a real linked worktree.
  git(root, "worktree", "add", "--quiet", join(root, "linked-worktree"), "-b", "t75-topology-worktree");

  // placeholder: a project whose gitdir does not exist.
  const broken = join(root, "projects", "missing");
  await mkdir(broken, { recursive: true });
  await writeFile(join(broken, "package.json"), PROJECT_MARKER("missing"));
  await writeFile(join(broken, ".git"), "gitdir: ../../.git/modules/absent\n");

  return root;
}

// The one normalization the seam needs: a canonical V2 digest carries a `v2:`
// prefix the placement owner validator does not admit. Dropping it is lossless
// and total, and it is the only transform applied anywhere in this file.
const CANONICAL_V2_PREFIX = "v2:";
const asPlacementOwner = (repositoryId) =>
  repositoryId === null ? null : repositoryId.replace(CANONICAL_V2_PREFIX, "");

// Derives a placement snapshot from a scan result. This is the seam under test:
// every field on the planner's side is taken from the scanner's own output.
function snapshotFromScan(inventory, overrides = {}) {
  const control = inventory.repositories.find((entry) => entry.relation === "control");
  const owners = new Map(inventory.repositories.map((entry) => [entry.repositoryId, entry]));
  const projects = inventory.projects.map((project, index) => ({
    projectId: `project_018f0b6d-7b1a-7abc-8def-${String(index).padStart(12, "0")}`,
    slug: `p${index}`,
    sourceLogicalPath: project.logicalPath,
    gitOwnerId: asPlacementOwner(project.gitOwnerId),
    gitRelation: owners.get(project.gitOwnerId)?.relation ?? "placeholder",
    ignoredByControl: project.ignoredByControl,
    placement: "inherit",
    nestedWriteAuthorized: false
  }));
  return {
    schemaVersion: 1,
    controlOwnerId: asPlacementOwner(control.repositoryId),
    placementMode: "colocated",
    defaultProjectPlacement: "colocated",
    nestedGitDefault: "centralized",
    requireExplicitNestedRepositoryWrites: true,
    projects,
    ...overrides
  };
}

const desired = (project) => ({
  address: { scope: "project", projectId: project.projectId, artifactClass: "spec", logicalName: "primary" },
  contentDigest: `sha256:${"c".repeat(64)}`,
  generatorVersion: "1.0.0",
  lifecyclePolicy: "tracked"
});

test("one real workspace produces every Git relation the scanner declares", async () => {
  // Coverage of the relation union in a single inventory, rather than five
  // separate fixtures that never coexist. A relation that only classifies
  // correctly in isolation fails here.
  const inventory = await scanWorkspace({ controlRoot: await everyRelationWorkspace() });
  const relations = new Set(inventory.repositories.map((entry) => entry.relation));
  assert.deepEqual(
    [...relations].sort(),
    ["control", "nested", "placeholder", "submodule", "worktree"],
    "the scanner must classify every declared relation in one workspace"
  );
  const placeholder = inventory.repositories.find((entry) => entry.relation === "placeholder");
  assert.equal(placeholder.status, "broken");
  assert.equal(placeholder.brokenReason, "gitdir-missing");
});

test("the scanner's repository identity is not directly usable as a placement owner", async () => {
  // The recorded seam. The scanner mints a canonical V2 digest; the planner's
  // owner validator admits only a bare sha256. Handing one straight to the
  // other is refused, so any scan-to-plan adapter must normalize — and this
  // fails the day either side changes its identifier format, which is exactly
  // when an adapter written against today's shapes would start corrupting
  // ownership silently.
  const inventory = await scanWorkspace({ controlRoot: await everyRelationWorkspace() });
  const control = inventory.repositories.find((entry) => entry.relation === "control");
  assert.match(control.repositoryId, /^v2:sha256:[a-f0-9]{64}$/u, "the scanner mints canonical V2 digests");

  const snapshot = snapshotFromScan(inventory);
  const raw = { ...snapshot.projects[0], gitOwnerId: control.repositoryId };
  assert.throws(
    () => effectivePlacement(raw, { ...snapshot, projects: [raw] }),
    { code: "VES_PLACEMENT_SNAPSHOT_INVALID" },
    "a raw repositoryId must not be silently accepted as a Git owner"
  );

  // And the normalization that resolves it is lossless: the same digest bytes.
  assert.match(asPlacementOwner(control.repositoryId), /^sha256:[a-f0-9]{64}$/u);
  assert.equal(
    asPlacementOwner(control.repositoryId).slice("sha256:".length),
    control.repositoryId.slice("v2:sha256:".length),
    "normalization must drop only the version prefix, never rehash"
  );
});

test("every relation a real scan reports is accepted by the placement vocabulary", async () => {
  // The bridge. The planner validates its own vocabulary and throws
  // VES_PLACEMENT_SNAPSHOT_INVALID on an unrecognised gitRelation, so passing
  // scanner output straight through is the executable proof that the two
  // unions agree.
  const inventory = await scanWorkspace({ controlRoot: await everyRelationWorkspace() });
  const snapshot = snapshotFromScan(inventory);
  assert.ok(snapshot.projects.length >= 5, "the fixture must yield a project per relation");
  for (const project of snapshot.projects) {
    const placement = effectivePlacement(project, snapshot);
    assert.ok(
      ["colocated", "centralized"].includes(placement),
      `scanned relation ${project.gitRelation} did not resolve to a placement`
    );
  }
  const observed = new Set(snapshot.projects.map((project) => project.gitRelation));
  assert.deepEqual(
    [...observed].sort(),
    ["control", "nested", "placeholder", "submodule", "worktree"],
    "every relation must reach the planner, not only the ones the control root owns"
  );
});

test("a project whose real gitdir is missing is planned centrally, never into a repository that is not there", async () => {
  // The scanner reports gitOwnerId: null for a broken repository. The planner's
  // owner guard is what stops that becoming a write into a nonexistent
  // repository, and this is the first test that feeds it a null owner produced
  // by a real scan rather than a literal.
  const inventory = await scanWorkspace({ controlRoot: await everyRelationWorkspace() });
  const snapshot = snapshotFromScan(inventory);
  const orphan = snapshot.projects.find((project) => project.gitOwnerId === null);
  assert.ok(orphan, "the broken repository must leave its project unowned");
  assert.equal(effectivePlacement(orphan, snapshot), "centralized");
  assert.throws(() => effectivePlacement({ ...orphan, placement: "colocated" }, snapshot), {
    code: "VES_PLACEMENT_OWNER_REQUIRED"
  });
});

test("a plan built from a real scan writes only to owners the scan reported", async () => {
  // scan -> plan, end to end. Every owner id in the plan must be a repository
  // the scanner actually found; an owner the plan invented would be a write
  // aimed at a repository nobody observed.
  const inventory = await scanWorkspace({ controlRoot: await everyRelationWorkspace() });
  const snapshot = snapshotFromScan(inventory);
  const plan = createWritePlan(snapshot.projects.map(desired), snapshot);
  const scannedOwners = new Set(inventory.repositories.map((entry) => asPlacementOwner(entry.repositoryId)));
  assert.ok(plan.ownerIds.length > 0);
  for (const ownerId of plan.ownerIds) {
    assert.match(ownerId, OWNER);
    assert.ok(scannedOwners.has(ownerId), `plan targets owner ${ownerId}, which the scan never reported`);
  }
  assert.equal(plan.writes.length, snapshot.projects.length, "every scanned project must receive its artifact");
});

test("a plan built from a real scan carries no machine-local path", async () => {
  // The scan is portable by contract (workspace-scanner.test.mjs proves the
  // inventory is). The plan derived from it must not reintroduce the control
  // root, or the artifact addresses stop being reproducible on another machine.
  const root = await everyRelationWorkspace();
  const inventory = await scanWorkspace({ controlRoot: root });
  const snapshot = snapshotFromScan(inventory);
  const plan = createWritePlan(snapshot.projects.map(desired), snapshot);
  assert.equal(JSON.stringify(plan).includes(root), false, "the write plan leaked the absolute control root");
  for (const write of plan.writes) assert.equal(write.logicalPath.includes(".."), false);
});

test("an authorized colocated write reaches the exact independent owner the scan found", async () => {
  // The relations the placement policy treats as independent are the ones the
  // scanner produces from real submodules and worktrees. This proves an
  // authorized write lands in that owner and not in the control repository.
  const inventory = await scanWorkspace({ controlRoot: await everyRelationWorkspace() });
  const base = snapshotFromScan(inventory, { placementMode: "mixed" });
  const independent = base.projects.filter((project) =>
    ["nested", "submodule", "worktree"].includes(project.gitRelation)
  );
  assert.equal(independent.length, 3, "the fixture must produce all three independent relations");
  for (const project of independent) {
    const authorized = { ...project, placement: "colocated", nestedWriteAuthorized: true };
    const snapshot = {
      ...base,
      projects: base.projects.map((entry) => (entry.projectId === project.projectId ? authorized : entry))
    };
    assert.equal(effectivePlacement(authorized, snapshot), "colocated");
    const plan = createWritePlan([desired(authorized)], snapshot);
    assert.deepEqual(plan.ownerIds, [project.gitOwnerId], `${project.gitRelation} write left its own repository`);
    assert.notEqual(project.gitOwnerId, base.controlOwnerId, `${project.gitRelation} must be a separate owner`);
  }
});
