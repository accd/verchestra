import { runSingleBinary } from "./single-binary-bootstrap.ts";

// why: the single executable's main script must start the bootstrap as a side
// effect of being loaded, while tests import the composition without running
// it; this module is that side effect and nothing else.
void runSingleBinary(process.argv.slice(2)).then((status) => {
  process.exitCode = status;
});
