import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

// SonarCloud S6535 (T8): a hyphen last in a character class, and a slash
// anywhere in one, need no escape. Each pair below is the old pattern (as an
// oracle) and the new one; they must accept exactly the same characters, and
// every listed source must now spell the new one.

const PAIRS = [
  {
    old: String.raw`^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,511}$`,
    new: String.raw`^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,511}$`,
    sources: [
      "packages/agent-runtime/src/context/source-snapshots.ts",
      "packages/application/src/egress/trust-egress.ts",
      "packages/drivers/src/driver-contract.ts",
      "packages/extension-host/src/probe-protocol.ts",
      "packages/memory/src/memory-lifecycle.ts",
      "packages/memory/src/memory-retriever.ts"
    ]
  },
  {
    old: String.raw`^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,255}$`,
    new: String.raw`^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,255}$`,
    sources: ["packages/application/src/authority/authority.ts"]
  },
  {
    old: String.raw`^[a-z0-9][a-z0-9._:@/+\-]{0,255}$`,
    new: String.raw`^[a-z0-9][a-z0-9._:@/+-]{0,255}$`,
    sources: [
      "packages/agent-runtime/src/discovery/discovery-router.ts",
      "packages/agent-runtime/src/skills/governed-skill-registry.ts"
    ]
  },
  {
    old: String.raw`^[A-Za-z0-9][A-Za-z0-9._:/+\-]{0,255}$`,
    new: String.raw`^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,255}$`,
    sources: ["packages/agent-runtime/src/models/passport-registry.ts"]
  },
  {
    old: String.raw`^[A-Za-z0-9][A-Za-z0-9:._/@+\-]{0,511}$`,
    new: String.raw`^[A-Za-z0-9][A-Za-z0-9:._/@+-]{0,511}$`,
    sources: [
      "packages/connectors/src/confluence/architecture-source.ts",
      "packages/connectors/src/confluence/delivery-projection.ts"
    ]
  },
  {
    old: String.raw`^[A-Za-z0-9][A-Za-z0-9:._@+\/-]{0,255}$`,
    new: String.raw`^[A-Za-z0-9][A-Za-z0-9:._@+/-]{0,255}$`,
    sources: ["packages/distribution/src/hermetic-bundle.ts"]
  },
  {
    old: String.raw`^[A-Za-z0-9._@+\-]+$`,
    new: String.raw`^[A-Za-z0-9._@+-]+$`,
    sources: ["packages/distribution/src/hermetic-bundle.ts", "packages/distribution/src/tuf-update-client.ts"]
  },
  {
    old: String.raw`^[A-Za-z0-9 ,.\-]+$`,
    new: String.raw`^[A-Za-z0-9 ,.-]+$`,
    sources: ["packages/extension-host/src/index.ts"]
  }
];

test("each unescaped character class accepts exactly what the escaped one did", () => {
  for (const pair of PAIRS) {
    const old = new RegExp(pair.old, "u");
    const now = new RegExp(pair.new, "u");
    for (let code = 0; code <= 0xffff; code += 1) {
      const character = String.fromCharCode(code);
      for (const input of [character, `a${character}`]) {
        assert.equal(now.test(input), old.test(input), `${pair.new} on U+${code.toString(16)}`);
      }
    }
  }
});

test("every source spells the unescaped pattern", async () => {
  for (const pair of PAIRS) {
    for (const source of pair.sources) {
      const text = await readFile(new URL(`../../${source}`, import.meta.url), "utf8");
      assert.ok(text.includes(`/${pair.new}/u`), `${source} must spell /${pair.new}/u`);
      assert.ok(!text.includes(`/${pair.old}/u`), `${source} must not keep /${pair.old}/u`);
    }
  }
});
