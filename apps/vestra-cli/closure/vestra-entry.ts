// Build input for the T76 candidate builder (scripts/t76-build-candidate.mjs):
// the entry esbuild bundles into the sealed release's `bin/vestra.mjs`. The
// compiled-in identity is stated here, once, so the emitted bundle can answer
// the activation health protocol as exactly `launcher:vestra` and run the real
// CLI as `vestra` for every other argument vector.
import { runSealedLauncher } from "../src/sealed-launcher.ts";

process.exitCode = await runSealedLauncher({ componentId: "launcher:vestra", invokedAs: "vestra" });
