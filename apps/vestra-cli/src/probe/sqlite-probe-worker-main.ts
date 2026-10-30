// why: the entry the release builder bundles into `bin/sqlite-probe-worker.mjs`
// and `corepack pnpm build:probe-worker` into the checkout's git-ignored
// `apps/vestra-cli/dist/sqlite-probe-worker.mjs` (scripts/t76-build-candidate.mjs
// `SEALED_CHILD_ENTRIES`). The probe host starts that bundle's copy with
// `node`, so this module only hands the process to the worker.
import { runSqliteProbeWorker } from "./sqlite-probe-worker.ts";

runSqliteProbeWorker(process);
