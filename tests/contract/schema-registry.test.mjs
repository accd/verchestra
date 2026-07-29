import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { SchemaRegistry } from "../../packages/contracts/src/schema-registry.ts";

const registry = await SchemaRegistry.load(new URL("../../schemas/", import.meta.url));

const valid = {
  "public-error": {
    schemaVersion: "1",
    code: "VES_TEST",
    category: "validation",
    component: "tests",
    retryability: "never",
    recovery: "fix input",
    safeDetails: {},
    documentationVersion: "1"
  },
  "protocol-envelope": {
    schemaVersion: "1",
    protocol: "verchestra/1",
    messageId: "m1",
    correlationId: "c1",
    workspaceId: "w1",
    sequence: 0,
    sentAt: "2026-07-12T00:00:00.000Z",
    payloadSchema: "ves://event@1",
    payloadDigest: "a".repeat(64),
    payload: {}
  },
  "cli-output": { schemaVersion: "1", command: "doctor", ok: true, data: {} },
  "key-lifecycle-error": { schemaVersion: "1", code: "VES_KEY_REVOKED" },
  "release-manifest": {
    schemaVersion: "1",
    releaseId: "1.0.0",
    platform: "win32-x64",
    components: [{ name: "core", path: "core.bin", sha256: "b".repeat(64), releaseId: "1.0.0" }]
  }
};

test("registry exposes only declared canonical schema versions", () => {
  assert.deepEqual(registry.list(), [
    "cli-output@1",
    "key-lifecycle-error@1",
    "protocol-envelope@1",
    "public-error@1",
    "release-manifest@1"
  ]);
});

for (const [name, value] of Object.entries(valid)) {
  test(`validates ${name}@1`, () => {
    assert.deepEqual(registry.validate(name, "1", value), value);
  });

  test(`negotiates ${name} to the highest mutually supported version`, () => {
    assert.equal(registry.negotiate(name, ["0", "1"]), "1");
  });

  for (const [caseName, mutate] of [
    [
      "unknown field",
      (copy) => {
        copy.unexpected = true;
      }
    ],
    [
      "missing schemaVersion",
      (copy) => {
        delete copy.schemaVersion;
      }
    ],
    [
      "wrong schemaVersion",
      (copy) => {
        copy.schemaVersion = "2";
      }
    ],
    ["null document", () => null],
    ["array document", () => []],
    ["string document", () => "invalid"],
    ["numeric document", () => 42]
  ]) {
    test(`${name}@1 rejects ${caseName}`, () => {
      const copy = structuredClone(value);
      const result = mutate(copy);
      const candidate = result === undefined ? copy : result;
      assert.throws(() => registry.validate(name, "1", candidate), {
        code: "VES_SCHEMA_VALIDATION_FAILED",
        schema: `${name}@1`
      });
    });
  }
}

test("unknown schema name fails with a stable code", () => {
  assert.throws(() => registry.validate("unknown", "1", {}), { code: "VES_SCHEMA_UNKNOWN", schema: "unknown@1" });
});

test("unknown schema version fails with a stable code", () => {
  assert.throws(() => registry.validate("public-error", "2", valid["public-error"]), {
    code: "VES_SCHEMA_VERSION_UNSUPPORTED",
    schema: "public-error@2"
  });
});

test("negotiation fails when no version is mutually supported", () => {
  assert.throws(() => registry.negotiate("public-error", ["2", "3"]), {
    code: "VES_SCHEMA_NEGOTIATION_FAILED",
    schema: "public-error"
  });
});

test("generated TypeScript contracts have zero drift", () => {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const result = spawnSync(process.execPath, [`${root}/scripts/generate-contract-types.mjs`, "--check"], {
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /generated contracts are current/);
});
