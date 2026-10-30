// Build input for the T76 candidate builder (scripts/t76-build-candidate.mjs
// `SEALED_CHILD_ENTRIES`): the entry esbuild bundles into the sealed release's
// `bin/sqlite-probe-worker.mjs`, and `corepack pnpm build:probe-worker` into a
// checkout's git-ignored `apps/vestra-cli/dist/sqlite-probe-worker.mjs`. The
// probe host starts that bundle's copy with `node`, so this module only hands
// the process to the worker (door 3 of .specs/features/sqlite-probe-worker/plan.md).
import { runSqliteProbeWorker } from "../src/probe/sqlite-probe-worker.ts";

runSqliteProbeWorker(process);
