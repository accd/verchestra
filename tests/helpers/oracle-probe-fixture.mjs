import {
  DatabaseRegistry,
  MemoryDatabaseRegistrationStore,
  ProbePlanner
} from "../../packages/data-probe/src/index.ts";
import {
  OracleFixtureConnection,
  OracleProbeAdapter,
  parseOracleReadOperation
} from "../../packages/data-probe/src/oracle-adapter.ts";
import {
  MemoryProbeResultSink,
  MemoryProtectedParameterBroker,
  ProbeWorkerSupervisor
} from "../../packages/extension-host/src/index.ts";
import { policy, registration, request } from "./database-probe-fixture.mjs";

export async function oracleFixture(options = {}) {
  const sql = options.sql ?? "SELECT count(*) FROM hr.orders WHERE status = :p1";
  const classifications = options.parameterClassifications ?? ["internal"];
  const protectedRequestRef = request().operation.protectedRequestRef;
  const operation = parseOracleReadOperation(sql, {
    kind: options.kind ?? "select",
    protectedRequestRef,
    parameterClassifications: classifications
  });
  const registry = new DatabaseRegistry({ store: new MemoryDatabaseRegistrationStore() });
  await registry.register(registration({ engine: "oracle", approvedSchemas: ["hr", "reporting"] }));
  const planner = new ProbePlanner({
    registry,
    adapters: [{ engine: "oracle", validateNormalizedOperation: () => [] }]
  });
  const plan = await planner.plan(
    request({ operation, bounds: options.bounds ?? request().bounds }),
    policy({ allowedObjects: ["hr.orders", "reporting.order_totals"], ...options.policy })
  );
  const parameters = new MemoryProtectedParameterBroker();
  parameters.set(
    protectedRequestRef,
    new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: 1,
        sql,
        parameters: options.parameters ?? (classifications.length ? ["paid"] : [])
      })
    )
  );
  const results = new MemoryProbeResultSink();
  const connection = options.realConnection ?? new OracleFixtureConnection(options.connection);
  const worker = new OracleProbeAdapter({ connection });
  const supervisor = new ProbeWorkerSupervisor({
    worker,
    parameters,
    results,
    plan,
    expectedComponent: OracleProbeAdapter.component,
    maximumMessageBytes: 65_536
  });
  return { operation, plan, parameters, results, connection, worker, supervisor };
}
