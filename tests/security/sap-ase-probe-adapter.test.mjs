import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SapAseFixtureConnection,
  SapAseProbeAdapter,
  parseSapAseReadOperation
} from "../../packages/data-probe/src/sap-ase-adapter.ts";
import { request } from "../helpers/database-probe-fixture.mjs";
import { sapAseFixture } from "../helpers/sap-ase-probe-fixture.mjs";

const ref = request().operation.protectedRequestRef;
const options = { kind: "select", protectedRequestRef: ref, parameterClassifications: [] };

for (const [label, sql, code] of [
  ["GO batch", "select id from dbo.orders\ngo\nselect id from dbo.orders", "VES_SAP_ASE_BATCH_DENIED"],
  ["semicolon batch", "select id from dbo.orders; delete dbo.orders", "VES_SAP_ASE_BATCH_DENIED"],
  ["procedure", "exec dbo.read_orders", "VES_SAP_ASE_EXECUTION_DENIED"],
  ["implicit procedure", "dbo.read_orders", "VES_SAP_ASE_READ_FORM_DENIED"],
  ["dynamic SQL", "execute immediate ?", "VES_SAP_ASE_EXECUTION_DENIED"],
  ["set proxy", "set proxy admin", "VES_SAP_ASE_EXECUTION_DENIED"],
  ["set session authorization", "set session authorization admin", "VES_SAP_ASE_EXECUTION_DENIED"],
  ["database switch", "use master", "VES_SAP_ASE_EXECUTION_DENIED"],
  ["three-part object", "select id from sales.dbo.orders", "VES_SAP_ASE_REMOTE_OBJECT_DENIED"],
  ["four-part remote object", "select id from remote.sales.dbo.orders", "VES_SAP_ASE_REMOTE_OBJECT_DENIED"],
  ["temporary object", "select id from #orders", "VES_SAP_ASE_TEMP_OBJECT_DENIED"],
  ["tempdb object", "select id from tempdb.dbo.orders", "VES_SAP_ASE_TEMP_OBJECT_DENIED"],
  ["SELECT INTO", "select id into dbo.copy from dbo.orders", "VES_SAP_ASE_WRITE_DENIED"],
  ["UPDATE", "update dbo.orders set status = ?", "VES_SAP_ASE_WRITE_DENIED"],
  ["line comment", "select id from dbo.orders -- hidden", "VES_SAP_ASE_COMMENT_DENIED"],
  ["block comment", "select id from dbo.orders /* hidden */", "VES_SAP_ASE_COMMENT_DENIED"],
  ["literal", "select id from dbo.orders where status = 'paid'", "VES_SAP_ASE_LITERAL_DENIED"],
  ["numeric literal", "select id from dbo.orders where id = 1", "VES_SAP_ASE_LITERAL_DENIED"],
  ["quoted identifier", 'select id from "dbo"."orders"', "VES_SAP_ASE_LITERAL_DENIED"],
  ["global variable", "select @@version from dbo.orders", "VES_SAP_ASE_VARIABLE_DENIED"],
  ["WAITFOR control", "select id from dbo.orders waitfor delay ?", "VES_SAP_ASE_EXECUTION_DENIED"],
  ["unqualified object", "select id from orders", "VES_SAP_ASE_OBJECT_INVALID"],
  ["unsafe system catalog", "select password from dbo.syslogins", "VES_SAP_ASE_CATALOG_DENIED"],
  ["catalog outside introspection", "select name from dbo.sysobjects", "VES_SAP_ASE_CATALOG_DENIED"],
  ["dangerous function", "select host_name() from dbo.orders", "VES_SAP_ASE_FUNCTION_DENIED"],
  ["Unicode homoglyph", "sеlect id from dbo.orders", "VES_SAP_ASE_ENCODING_DENIED"]
]) {
  test(`SAP ASE denies ${label}`, () => assert.throws(() => parseSapAseReadOperation(sql, options), { code }));
}

for (const [label, observation] of [
  ["sa_role", { saRole: true }],
  ["sso_role", { ssoRole: true }],
  ["oper_role", { operRole: true }],
  ["replication_role", { replicationRole: true }],
  ["dtm_tm_role", { dtmRole: true }],
  ["database owner", { databaseOwner: true }],
  ["server administration privilege", { serverAdminPrivilegeCount: 1 }],
  ["write permission", { writePermissionCount: 1 }],
  ["DDL permission", { ddlPermissionCount: 1 }],
  ["execute permission", { executePermissionCount: 1 }],
  ["proxy permission", { proxyPermission: true }]
]) {
  test(`SAP ASE principal with ${label} is not read-only`, async () => {
    const fixture = await sapAseFixture({ connection: observation });
    assert.equal((await fixture.worker.verifyIdentity(fixture.plan)).principalReadOnly, false);
  });
}

test("SAP ASE session execute permission is independently rejected", async () => {
  const fixture = await sapAseFixture({ connection: { sessionExecuteCount: 1 } });
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_PROBE_SESSION_NOT_READ_ONLY" });
  assert.equal(fixture.connection.streamCalls, 0);
});

test("SAP ASE malformed protected request is sanitized before streaming", async () => {
  const fixture = await sapAseFixture();
  fixture.parameters.set(fixture.plan.operation.protectedRequestRef, new TextEncoder().encode("not-json"));
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_SAP_ASE_REQUEST_INVALID" });
  assert.equal(fixture.connection.streamCalls, 0);
});

test("SAP ASE direct cancellation and termination remain available", async () => {
  const connection = new SapAseFixtureConnection();
  const worker = new SapAseProbeAdapter({ connection });
  await worker.cancel();
  await worker.terminate();
  assert.deepEqual([connection.cancelled, connection.terminated], [true, true]);
});
