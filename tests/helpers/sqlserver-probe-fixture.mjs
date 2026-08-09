import {
  DatabaseRegistry,
  MemoryDatabaseRegistrationStore,
  ProbePlanner
} from "../../packages/data-probe/src/index.ts";
import {
  SqlServerFixtureConnection,
  SqlServerProbeAdapter,
  parseSqlServerReadOperation
} from "../../packages/data-probe/src/sqlserver-adapter.ts";
import {
  MemoryProbeResultSink,
  MemoryProtectedParameterBroker,
  ProbeWorkerSupervisor
} from "../../packages/extension-host/src/index.ts";
import { policy, registration, request } from "./database-probe-fixture.mjs";

export async function sqlServerFixture(options = {}) {
  const sql = options.sql ?? "SELECT count(*) FROM public.orders WHERE status = @p1";
  const classifications = options.parameterClassifications ?? ["internal"];
  const protectedRequestRef = request().operation.protectedRequestRef;
  const operation = parseSqlServerReadOperation(sql, {
    kind: options.kind ?? "select",
    protectedRequestRef,
    parameterClassifications: classifications
  });
  const registry = new DatabaseRegistry({ store: new MemoryDatabaseRegistrationStore() });
  await registry.register(registration({ engine: "sqlserver" }));
  const planner = new ProbePlanner({
    registry,
    adapters: [{ engine: "sqlserver", validateNormalizedOperation: () => [] }]
  });
  const plan = await planner.plan(
    request({ operation, bounds: options.bounds ?? request().bounds }),
    policy(options.policy)
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
  const connection = options.realConnection ?? new SqlServerFixtureConnection(options.connection);
  const worker = new SqlServerProbeAdapter({ connection });
  const supervisor = new ProbeWorkerSupervisor({
    worker,
    parameters,
    results,
    plan,
    expectedComponent: SqlServerProbeAdapter.component,
    maximumMessageBytes: 65_536
  });
  return { operation, plan, parameters, results, connection, worker, supervisor };
}
