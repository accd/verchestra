import {
  DatabaseRegistry,
  MemoryDatabaseRegistrationStore,
  ProbePlanner
} from "../../packages/data-probe/src/index.ts";
import {
  MemoryProbeResultSink,
  MemoryProtectedParameterBroker,
  MockProbeWorker,
  ProbeWorkerSupervisor
} from "../../packages/extension-host/src/index.ts";
import { adapter, policy, registration, request, workspaceId } from "./database-probe-fixture.mjs";

export async function probePlan(overrides = {}) {
  const registry = new DatabaseRegistry({ store: new MemoryDatabaseRegistrationStore() });
  await registry.register(registration());
  return new ProbePlanner({ registry, adapters: [adapter()] }).plan(request(overrides), policy());
}

export async function workerFixture(options = {}) {
  const plan = await probePlan(options.request);
  const parameters = new MemoryProtectedParameterBroker();
  parameters.set(
    plan.operation.protectedRequestRef,
    new TextEncoder().encode(options.parameter ?? '{"status":"paid"}')
  );
  const results = new MemoryProbeResultSink();
  const worker = new MockProbeWorker(options.worker);
  const supervisor = new ProbeWorkerSupervisor({
    worker,
    parameters,
    results,
    plan,
    expectedComponent: { id: "probe-worker:mock", digest: `sha256:${"1".repeat(64)}` },
    maximumMessageBytes: 65_536
  });
  return { plan, parameters, results, worker, supervisor, workspaceId };
}
