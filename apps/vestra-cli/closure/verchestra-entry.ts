// Build input for the T76 candidate builder (scripts/t76-build-candidate.mjs):
// the entry esbuild bundles into the sealed release's `bin/verchestra.mjs`.
// Identical to vestra-entry.ts except for the compiled-in identity, which is
// what lets the activation health gate prove the two canonical launchers
// observe byte-identical behavior while reporting distinct component ids.
import { runSealedLauncher } from "../src/sealed-launcher.ts";

process.exitCode = await runSealedLauncher({ componentId: "launcher:verchestra", invokedAs: "verchestra" });
