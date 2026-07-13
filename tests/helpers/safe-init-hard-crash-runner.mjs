import { SafeInitService, buildCanonicalInitFiles } from "../../packages/workspace/src/index.ts";

const root = process.argv[2];
if (root === undefined) process.exit(64);
const mode = process.argv[3] ?? "apply";

const files = buildCanonicalInitFiles({
  workspaceId: "workspace_018f0b6d-7b1a-7abc-8def-0123456789ab",
  displayName: "Fault Fixture",
  placementMode: "centralized",
  generatorVersion: "1.0.0"
});

if (mode === "recover") {
  const recovery = new SafeInitService({
    hooks: {
      afterRecoveryRemove: ({ index }) => {
        if (index === 0) process.exit(78);
      }
    }
  });
  await recovery.recover({ controlRoot: root });
  process.exit(66);
}

const service = new SafeInitService({
  hooks: {
    afterApplyChange: ({ index }) => {
      if (index === 0) process.exit(77);
    }
  }
});
await service.apply(await service.preview({ controlRoot: root, files }));
process.exit(65);
