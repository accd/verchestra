import {
  DatabaseRegistry,
  MemoryDatabaseRegistrationStore,
  ProbePlanner
} from "../../packages/data-probe/src/index.ts";
import {
  SapAseFixtureConnection,
  SapAseProbeAdapter,
  parseSapAseReadOperation
} from "../../packages/data-probe/src/sap-ase-adapter.ts";
import {
  MemoryProbeResultSink,
  MemoryProtectedParameterBroker,
  ProbeWorkerSupervisor
} from "../../packages/extension-host/src/index.ts";
import { policy, registration, request } from "./database-probe-fixture.mjs";

export async function sapAseFixture(options = {}) {
  const sql = options.sql ?? "select count(*) from dbo.orders where status = ?";
  const classifications = options.parameterClassifications ?? ["internal"];
  const protectedRequestRef = request().operation.protectedRequestRef;
  const operation = parseSapAseReadOperation(sql, {
    kind: options.kind ?? "select",
    protectedRequestRef,
    parameterClassifications: classifications
  });
  const registry = new DatabaseRegistry({ store: new MemoryDatabaseRegistrationStore() });
  await registry.register(registration({ engine: "sybase", approvedSchemas: ["dbo", "reporting"] }));
  const planner = new ProbePlanner({
    registry,
    adapters: [{ engine: "sybase", validateNormalizedOperation: () => [] }]
  });
  const plan = await planner.plan(
    request({ operation, bounds: options.bounds ?? request().bounds }),
    policy({
      allowedObjects: ["dbo.orders", "reporting.order_totals"],
      allowedFunctions: ["avg", "count", "max", "min", "sum"],
      ...options.policy
    })
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
  const connection = options.realConnection ?? new SapAseFixtureConnection(options.connection);
  const worker = new SapAseProbeAdapter({ connection });
  const supervisor = new ProbeWorkerSupervisor({
    worker,
    parameters,
    results,
    plan,
    expectedComponent: SapAseProbeAdapter.component,
    maximumMessageBytes: 65_536
  });
  return { operation, plan, parameters, results, connection, worker, supervisor };
}
