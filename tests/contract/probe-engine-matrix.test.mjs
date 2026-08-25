import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import * as dataProbe from "../../packages/data-probe/src/index.ts";

// T75 database matrix, per AD-017.
//
// AD-017 narrowed the 1.0 database claim to three things: the published probe
// contract, the conformance kit, and real SQLite. Only the third of those was
// ever proven by execution. The kit's own parity suite
// (tests/contract/conformance-kit-parity.test.mjs) does run one case per
// engine, but its engine list is written out by hand, so a ninth engine added
// to the product's closed ENGINES set would enter with no kit case and every
// test in the repository would still pass. That is the silent-omission failure
// the T75 matrix exists to prevent, and it is what this file closes.
//
// Nothing here weakens or duplicates the parity suite. It binds the parity
// suite, the published surface, and the kit layout to the canonical engine set,
// and it proves by construction which engines are live-qualified and which are
// contract-qualified rather than taking the declaration's word for it.

const PROBE_INDEX_PATH = fileURLToPath(new URL("../../packages/data-probe/src/index.ts", import.meta.url));
const PROBE_INDEX = readFileSync(PROBE_INDEX_PATH, "utf8");
const PARITY_SUITE = readFileSync(new URL("./conformance-kit-parity.test.mjs", import.meta.url), "utf8");
const CONTRACT_DOC = readFileSync(new URL("../../docs/data-probe-contract.md", import.meta.url), "utf8");

// The canonical closed engine set, read from the product rather than restated.
const ENGINES = (() => {
  const body = /const ENGINES = \[([^\]]+)\]/u.exec(PROBE_INDEX)?.[1];
  assert.ok(body, "the engine set must be readable from packages/data-probe/src/index.ts");
  return [...body.matchAll(/"([a-z]+)"/gu)].map((match) => match[1]);
})();

// Engine id -> the kit helper that carries it, and the parity case that must
// exercise it. `sybase` is SAP ASE: the engine id and the adapter's filename
// differ, which is exactly the kind of mapping a hand-maintained list loses.
const KIT = Object.freeze({
  postgresql: { helper: "postgresql-probe-fixture.mjs", parity: "postgresql kit" },
  mysql: { helper: "mysql-family-probe-fixture.mjs", parity: "mysql-family kit (mysql)" },
  mariadb: { helper: "mysql-family-probe-fixture.mjs", parity: "mysql-family kit (mariadb)" },
  sqlserver: { helper: "sqlserver-probe-fixture.mjs", parity: "sqlserver kit" },
  sybase: { helper: "sap-ase-probe-fixture.mjs", parity: "sap-ase kit" },
  oracle: { helper: "oracle-probe-fixture.mjs", parity: "oracle kit" },
  sqlite: { helper: "sqlite-probe-fixture.mjs", parity: "sqlite kit" },
  mongodb: { helper: "mongodb-probe-fixture.mjs", parity: "mongodb kit" }
});

// The engine that has a real driver, and the engines that have only a fixture
// connection. AD-017 says this split out loud; the tests below prove it holds
// rather than trusting the sentence.
const LIVE_QUALIFIED = Object.freeze(["sqlite"]);

test("the matrix covers exactly the engine set the probe admits", () => {
  // The binding. An engine added to ENGINES with no kit entry fails here.
  assert.deepEqual(Object.keys(KIT).sort(), [...ENGINES].sort());
  assert.equal(ENGINES.length, 8);
});

test("every engine has a conformance-kit parity case", () => {
  // #233's claim is kit parity across every engine including SAP ASE. This is
  // that claim as an executed check rather than a count someone maintained.
  for (const engine of ENGINES)
    assert.ok(
      PARITY_SUITE.includes(`[parity] ${KIT[engine].parity} accepts`),
      `engine ${engine} has no [parity] case in tests/contract/conformance-kit-parity.test.mjs`
    );
});

test("every engine's conformance kit exists where the published contract says it does", () => {
  // docs/data-probe-contract.md tells an edge team the kit lives at
  // tests/helpers/<engine>-probe-fixture.mjs. A published instruction that
  // points at a file which is not there is a broken contract, not a typo.
  assert.match(CONTRACT_DOC, /tests\/helpers\/<engine>-probe-fixture\.mjs/u);
  for (const engine of ENGINES) {
    const helper = new URL(`../helpers/${KIT[engine].helper}`, import.meta.url);
    assert.ok(existsSync(helper), `engine ${engine} has no conformance kit at tests/helpers/${KIT[engine].helper}`);
  }
});

test("every engine's kit accepts a caller-supplied connection through the same seam", async () => {
  // The seam is the whole published contract: an edge team implements the
  // connection port and passes it in. If one kit ignored options.realConnection
  // and built its own fixture, that engine's edge qualification would silently
  // be testing the fixture instead of the team's driver.
  for (const engine of ENGINES) {
    const helper = readFileSync(new URL(`../helpers/${KIT[engine].helper}`, import.meta.url), "utf8");
    assert.match(
      helper,
      /options\.realConnection \?\?/u,
      `the ${engine} kit does not honour options.realConnection, so an edge implementation cannot reach the adapter`
    );
  }
});

test("every engine's connection port is published from the package entry", () => {
  // AD-017's first deliverable. A port an edge team cannot import is not
  // published, whatever the document says.
  const ports = [...PROBE_INDEX.matchAll(/type ([A-Za-z]+ConnectionPort)/gu)].map((match) => match[1]);
  assert.equal(new Set(ports).size, 7, "one port per adapter file; mysql and mariadb share FamilyConnectionPort");
  const exportsBlock = JSON.parse(
    readFileSync(new URL("../../packages/data-probe/package.json", import.meta.url), "utf8")
  ).exports;
  assert.deepEqual(exportsBlock, { ".": "./src/index.ts" }, "the ports are reachable only through the single entry");
});

test("every engine ships an adapter and a fixture connection from the package entry", () => {
  // Runtime, not text: the classes an edge team is told to subclass or replace
  // must actually be values on the module.
  const missing = [];
  for (const engine of ENGINES) {
    const adapters = Object.keys(dataProbe).filter((name) => name.endsWith("ProbeAdapter"));
    assert.ok(adapters.length >= 7, "the package entry must publish every engine adapter");
    if (!Object.keys(dataProbe).some((name) => name.endsWith("FixtureConnection"))) missing.push(engine);
  }
  assert.deepEqual(missing, []);
  assert.equal(
    Object.keys(dataProbe).filter((name) => name.endsWith("FixtureConnection")).length,
    7,
    "one fixture connection per adapter file"
  );
});

test("exactly one engine is qualified against a real driver, and it is SQLite", () => {
  // The honesty clause of the database matrix, executed. `SqliteReadConnection`
  // is the only connection class in the package that talks to a real engine
  // (node:sqlite); every other engine ships a `*FixtureConnection` only. If a
  // second real driver ever appeared, this fails and the matrix must be
  // re-declared rather than quietly absorbing it.
  const real = Object.keys(dataProbe).filter((name) => name.endsWith("ReadConnection"));
  assert.deepEqual(real, ["SqliteReadConnection"]);
  assert.deepEqual([...LIVE_QUALIFIED], ["sqlite"]);
  // Recorded, not omitted: the other seven are contract-qualified. Reaching a
  // live server needs a database client, and data-probe declares none — every
  // dependency it has is an internal workspace package. SQLite is the exception
  // precisely because node:sqlite needs no client to install.
  const manifest = JSON.parse(readFileSync(new URL("../../packages/data-probe/package.json", import.meta.url), "utf8"));
  const external = Object.entries(manifest.dependencies ?? {}).filter(([, range]) => !range.startsWith("workspace:"));
  assert.deepEqual(
    external,
    [],
    "a third-party dependency here could be a database client, which would change which engines can be live-qualified"
  );
  assert.deepEqual(
    ENGINES.filter((engine) => !LIVE_QUALIFIED.includes(engine)).sort(),
    ["mariadb", "mongodb", "mysql", "oracle", "postgresql", "sqlserver", "sybase"],
    "the contract-qualified engines are named here so the matrix records them rather than omitting them"
  );
});

test("SAP ASE holds the same kit parity as every other engine and no more", () => {
  // Issue #16 originally called SAP ASE a principal qualification target while
  // its only "16.1" evidence was a default string in a fixture connection.
  // AD-017 replaced that claim with kit parity. This asserts the replacement:
  // sybase is in the kit, and it is not in the live-qualified set.
  assert.ok(ENGINES.includes("sybase"));
  assert.ok(PARITY_SUITE.includes("[parity] sap-ase kit accepts"));
  assert.equal(LIVE_QUALIFIED.includes("sybase"), false, "no live SAP ASE server is qualified anywhere");
  const adapter = readFileSync(new URL("../../packages/data-probe/src/sap-ase-adapter.ts", import.meta.url), "utf8");
  assert.match(adapter, /SapAseFixtureConnection/u, "SAP ASE reaches the adapter only through a fixture connection");
});
