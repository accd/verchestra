import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { GATE_STAGES } from "../../scripts/gate-stages.mjs";

// T75: the remaining matrix dimensions, bound to their canonical sources, and
// every cited piece of evidence resolved.
//
// tests/agent-readiness/t75-matrix-declaration.test.mjs binds four dimensions —
// platform, gate-profile, database and self-test — to the sources that declare
// them. Topology, driver, sandbox, installer and recovery were left as prose:
// their case lists were transcribed by hand, and `evidence` was validated only
// for being a non-empty string. So a case could cite a test file that had since
// been deleted, or cite a test that no gate profile runs, and read as
// `qualified` while every test in the repository passed. That is the same
// silent-omission failure acceptance criterion 1 forbids, one level up from the
// cases themselves.
//
// This file closes it in two moves: it derives the remaining case sets from the
// product, and it resolves every repository path any case cites, in any
// dimension, back to a file that exists and a stage that runs it.

const REPOSITORY_ROOT = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, REPOSITORY_ROOT), "utf8");

const matrix = JSON.parse(read(".specs/features/platform-qualification-matrix/matrix.json"));
const planningSource = read("packages/application/src/artifacts/artifact-planning.ts");
const serializerSource = read("packages/agent-runtime/src/context/backend-serializers.ts");
const isolationPolicySource = read("spikes/isolation/src/isolation-policy.mjs");
const selfTestSource = read("packages/application/src/self-test/self-test.ts");
const launcherHostSource = read("apps/vestra-launcher/src/supported-host.ts");
const activationSource = read("packages/distribution/src/transactional-activation.ts");

const dimension = (name) => matrix.dimensions.find((entry) => entry.dimension === name);
const cases = (name) => (dimension(name)?.cases ?? []).map((entry) => entry.case);

// Any token in an evidence note that names a tracked repository location.
const PATH_TOKEN = /(?:tests|packages|apps|spikes|docs|scripts|schemas)\/[A-Za-z0-9._/-]+/gu;

const unionMembers = (source, name) => {
  const body = new RegExp(`export type ${name} =([^;]+);`, "u").exec(source)?.[1];
  assert.ok(body, `the ${name} union must be readable`);
  return [...body.matchAll(/"([a-z-]+)"/gu)].map((match) => match[1]);
};

test("the topology dimension declares exactly the Git relations and placement modes", () => {
  const relations = /gitRelation: ((?:"[a-z]+"(?: \| )?)+)/u.exec(planningSource)?.[1];
  assert.ok(relations, "the Git relation union must be readable from artifact-planning.ts");
  const expected = [
    ...[...relations.matchAll(/"([a-z]+)"/gu)].map((match) => `git-relation:${match[1]}`),
    ...unionMembers(planningSource, "WorkspacePlacementMode").map((mode) => `placement:${mode}`)
  ];
  assert.deepEqual(cases("topology").sort(), expected.sort());
});

test("the driver dimension declares every driver the product enumerates", () => {
  // backend-serializers.ts holds the only closed four-way driver enumeration in
  // the product. Composite cases such as cross-driver-verification are allowed
  // on top of it; a declared driver that is missing from the matrix is not.
  const body = /const TARGETS = \[([^\]]+)\]/u.exec(serializerSource)?.[1];
  assert.ok(body, "the driver target set must be readable from backend-serializers.ts");
  const declared = cases("driver");
  for (const driverId of [...body.matchAll(/"([a-z-]+)"/gu)].map((match) => match[1]))
    assert.ok(declared.includes(driverId), `driver ${driverId} is enumerated by the product and not declared`);
});

test("the sandbox dimension declares an isolation grade only if the policy can name it", () => {
  // A grade the isolation policy never names cannot be qualified by anything,
  // so it must be declared not-qualified; a grade the policy does name must not
  // be declared as though nothing implemented it. This keeps the
  // `container-isolated` entry honest in both directions rather than trusting
  // its prose.
  const grades = dimension("sandbox").cases.filter((item) => item.case.startsWith("isolation-grade:"));
  assert.ok(grades.length > 0, "the sandbox dimension must declare its isolation grades");
  for (const item of grades) {
    const grade = item.case.slice("isolation-grade:".length);
    const named = isolationPolicySource.includes(`"${grade}"`);
    if (!named)
      assert.equal(
        item.status,
        "not-qualified",
        `${grade} is named nowhere in the isolation policy but is declared ${item.status}`
      );
    if (item.status === "qualified")
      assert.ok(named, `${grade} is declared qualified while the isolation policy never names it`);
  }
});

test("the installer dimension's activation targets are the launcher's declared host set", () => {
  // The installer's own target guard and the public launcher's host gate are
  // two separate literals in two packages. They must admit the same hosts, or
  // a release the launcher would accept is one the activation manager refuses.
  const launcherPlatforms = /SUPPORTED_LAUNCHER_PLATFORMS = Object\.freeze\(\[([^\]]+)\]/u.exec(
    launcherHostSource
  )?.[1];
  const launcherArches = /SUPPORTED_LAUNCHER_ARCHES = Object\.freeze\(\[([^\]]+)\]/u.exec(launcherHostSource)?.[1];
  assert.ok(launcherPlatforms && launcherArches, "the launcher host set must be readable");
  const members = (body) => [...body.matchAll(/"([a-z0-9]+)"/gu)].map((match) => match[1]).sort();

  const activationPlatforms = /!\(\[([^\]]+)\] as const\)\.includes\(options\.platform\)/u.exec(activationSource)?.[1];
  const activationArches = /!\(\[([^\]]+)\] as const\)\.includes\(options\.arch\)/u.exec(activationSource)?.[1];
  assert.ok(activationPlatforms && activationArches, "the activation target guard must be readable");

  assert.deepEqual(members(activationPlatforms), members(launcherPlatforms));
  assert.deepEqual(members(activationArches), members(launcherArches));
});

test("the recovery dimension's crash matrix matches the product's durable boundary catalog", () => {
  // The evidence note states a boundary count. That number is a claim about the
  // product catalog, so it must be the catalog's real size rather than a figure
  // that was true when someone wrote it.
  const crash = dimension("recovery").cases.find((item) => item.case === "crash-recovery");
  const declared = /(\d+) durable boundaries x (\d+) phases/u.exec(crash.evidence);
  assert.ok(declared, "the crash-recovery evidence must state its boundary and phase counts");
  const catalog = /export const FULL_DURABLE_BOUNDARY_IDS = Object\.freeze\(\[([^\]]+)\]/u.exec(selfTestSource)?.[1];
  const phases = /export const DURABLE_CRASH_PHASES = Object\.freeze\(\[([^\]]+)\]/u.exec(selfTestSource)?.[1];
  assert.ok(catalog && phases, "the durable boundary catalog must be readable from self-test.ts");
  assert.equal(Number(declared[1]), [...catalog.matchAll(/"[a-z.-]+"/gu)].length);
  assert.equal(Number(declared[2]), [...phases.matchAll(/"[a-z]+"/gu)].length);
});

test("every dimension's canonical source resolves to a tracked location", () => {
  // A dimension whose source has moved is a dimension nobody can re-derive.
  for (const entry of matrix.dimensions)
    for (const path of entry.source.split(",").map((value) => value.trim()))
      assert.ok(
        existsSync(new URL(path, REPOSITORY_ROOT)),
        `${entry.dimension} names the source ${path}, which does not exist`
      );
});

test("every repository path a case cites as evidence exists", () => {
  // The rule the declaration was missing. `evidence` was checked only for being
  // a non-empty string, so a case could cite a deleted test and still read as
  // qualified. Every path-shaped token in every note is now resolved.
  const cited = [];
  for (const entry of matrix.dimensions)
    for (const item of entry.cases)
      for (const path of item.evidence.match(PATH_TOKEN) ?? []) {
        cited.push(path);
        assert.ok(
          existsSync(new URL(path, REPOSITORY_ROOT)),
          `${entry.dimension}/${item.case} cites ${path}, which does not exist`
        );
      }
  assert.ok(cited.length >= 25, "the declaration must cite real repository evidence, not only prose");
});

test("every test file a qualified case cites runs in a declared gate profile", () => {
  // Citing a real test is not enough. A test that no gate profile executes is
  // not evidence that anything ran, so each cited test is mapped back to the
  // stage that owns its directory and then to the profiles carrying that stage.
  const manifest = JSON.parse(read("package.json"));
  const stageForRoot = new Map();
  for (const [script, command] of Object.entries(manifest.scripts))
    if (script.startsWith("test:"))
      for (const match of command.matchAll(/(?:^|\s)(tests\/[a-z-]+|spikes)\b/gu))
        if (!stageForRoot.has(match[1])) stageForRoot.set(match[1], script);
  assert.ok(stageForRoot.size >= 8, "the test stages must be readable from package.json");

  let checked = 0;
  for (const entry of matrix.dimensions)
    for (const item of entry.cases) {
      if (item.status !== "qualified") continue;
      for (const path of item.evidence.match(PATH_TOKEN) ?? []) {
        if (!path.endsWith(".test.mjs")) continue;
        const root = path.startsWith("spikes/") ? "spikes" : path.split("/").slice(0, 2).join("/");
        const stage = stageForRoot.get(root);
        assert.ok(stage, `${entry.dimension}/${item.case} cites ${path}, which no test stage runs`);
        const profiles = Object.entries(GATE_STAGES).filter(([, stages]) => stages.includes(stage));
        assert.ok(
          profiles.length > 0,
          `${entry.dimension}/${item.case} cites ${path}, whose stage ${stage} no gate profile runs`
        );
        checked += 1;
      }
    }
  assert.ok(checked >= 15, "the qualified cases must cite executable evidence, not only source files");
});

test("every dimension issue #16 names carries at least one executable citation", () => {
  // A dimension whose every case cites only prose or a source file has no
  // evidence that anything was ever run for it.
  for (const name of ["topology", "driver", "sandbox", "database", "installer", "recovery", "self-test"]) {
    const entry = dimension(name);
    assert.ok(entry, `issue #16 names the ${name} matrix and it is not declared`);
    const executable = entry.cases.some((item) =>
      (item.evidence.match(PATH_TOKEN) ?? []).some((path) => path.endsWith(".test.mjs"))
    );
    assert.ok(executable, `the ${name} dimension cites no test file at all`);
  }
});
