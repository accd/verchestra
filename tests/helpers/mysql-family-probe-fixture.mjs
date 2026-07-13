import {
  DatabaseRegistry,
  MemoryDatabaseRegistrationStore,
  ProbePlanner
} from "../../packages/data-probe/src/index.ts";
import {
  MariaDbProbeAdapter,
  MySqlFamilyFixtureConnection,
  MySqlProbeAdapter,
  parseMySqlFamilyReadOperation
} from "../../packages/data-probe/src/mysql-family-adapter.ts";
import {
  MemoryProbeResultSink,
  MemoryProtectedParameterBroker,
  ProbeWorkerSupervisor
} from "../../packages/extension-host/src/index.ts";
import { policy, registration, request } from "./database-probe-fixture.mjs";

export async function mysqlFamilyFixture(engine, options = {}) {
  const sql = options.sql ?? "SELECT count(*) FROM public.orders WHERE status = ?";
  const classifications = options.parameterClassifications ?? ["internal"];
  const protectedRequestRef = request().operation.protectedRequestRef;
  const operation = parseMySqlFamilyReadOperation(sql, {
    engine,
    kind: options.kind ?? "select",
    protectedRequestRef,
    parameterClassifications: classifications
  });
  const registry = new DatabaseRegistry({ store: new MemoryDatabaseRegistrationStore() });
  await registry.register(registration({ engine }));
  const planner = new ProbePlanner({ registry, adapters: [{ engine, validateNormalizedOperation: () => [] }] });
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
  const connection = new MySqlFamilyFixtureConnection({ engine, ...options.connection });
  const Adapter = engine === "mysql" ? MySqlProbeAdapter : MariaDbProbeAdapter;
  const worker = new Adapter({ connection });
  const supervisor = new ProbeWorkerSupervisor({
    worker,
    parameters,
    results,
    plan,
    expectedComponent: Adapter.component,
    maximumMessageBytes: 65_536
  });
  return { operation, plan, parameters, results, connection, worker, supervisor, Adapter };
}
