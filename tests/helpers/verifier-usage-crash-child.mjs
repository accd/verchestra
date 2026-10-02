// DETERMINISTIC FAKE composition - not `vestra task`. A labeled stand-in for the
// part of a task command that verifies: it opens the Run's runtime store,
// meters on the Run's ledger as the task composition does, and runs the
// production verifier session against the labeled fake `codex`. It never
// contacts a provider.
//
// invariant: once the session is over it reports `metered` and waits, still
// inside the metered work, to be killed: where a task command would be running
// its mutation gates. The work never ends, so the ledger is never recorded
// again, and whatever a test then finds in the store was stored when the usage
// event was metered.
import { runCodexVerifier } from "../../apps/vestra-cli/src/task/task-codex.ts";
import { RuntimeStore } from "../../packages/platform-node/src/index.ts";
import { meteredOnLedger, runCheckpoints } from "./verifier-usage-fixture.mjs";

const [dbPath, tasksRoot, session, metering] = process.argv.slice(2);
const store = new RuntimeStore({ dbPath });
store.open();
await meteredOnLedger(runCheckpoints(store, tasksRoot), JSON.parse(metering), async (meter) => {
  await runCodexVerifier({ ...JSON.parse(session), meter, signal: new AbortController().signal });
  process.stdout.write("metered\n");
  await new Promise(() => setInterval(() => undefined, 1_000));
});
