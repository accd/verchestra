import {
  DatabaseRegistry,
  MemoryDatabaseRegistrationStore,
  ProbePlanner
} from "../../packages/data-probe/src/index.ts";
import {
  PostgreSqlFixtureConnection,
  PostgreSqlProbeAdapter,
  parsePostgreSqlReadOperation
} from "../../packages/data-probe/src/postgresql-adapter.ts";
import {
  MemoryProbeResultSink,
  MemoryProtectedParameterBroker,
  ProbeWorkerSupervisor
} from "../../packages/extension-host/src/index.ts";
import { policy, registration, request } from "./database-probe-fixture.mjs";

export function sqlRequest(sql = "SELECT count(*) FROM public.orders WHERE status = $1", parameters = ["paid"]) {
  return { schemaVersion: 1, sql, parameters };
}

export async function postgresFixture(options = {}) {
  const protectedRequestRef = request().operation.protectedRequestRef;
  const operation = parsePostgreSqlReadOperation(options.sql ?? sqlRequest().sql, {
    kind: options.kind ?? "select",
    protectedRequestRef,
    parameterClassifications: options.parameterClassifications ?? ["internal"]
  });
  const registry = new DatabaseRegistry({ store: new MemoryDatabaseRegistrationStore() });
  await registry.register(registration());
  const planner = new ProbePlanner({
    registry,
    adapters: [{ engine: "postgresql", validateNormalizedOperation: () => [] }]
  });
  const plan = await planner.plan(
    request({ operation, bounds: options.bounds ?? request().bounds }),
    policy(options.policy)
  );
  const parameters = new MemoryProtectedParameterBroker();
  parameters.set(
    protectedRequestRef,
    new TextEncoder().encode(JSON.stringify(sqlRequest(options.sql, options.parameters)))
  );
  const results = new MemoryProbeResultSink();
  const connection = new PostgreSqlFixtureConnection(options.connection);
  const worker = new PostgreSqlProbeAdapter({ connection });
  const supervisor = new ProbeWorkerSupervisor({
    worker,
    parameters,
    results,
    plan,
    expectedComponent: PostgreSqlProbeAdapter.component,
    maximumMessageBytes: 65_536
  });
  return { operation, plan, parameters, results, connection, worker, supervisor };
}
