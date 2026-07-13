import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ActorRef,
  DataClassification,
  Digest,
  FixedClock,
  IsoInstant,
  LogicalPath,
  PublicErrorException,
  PublicErrorRegistry,
  RequirementId,
  StableId,
  corePublicErrorRegistry
} from "../../packages/domain/src/index.ts";
import { SchemaRegistry } from "../../packages/contracts/src/index.ts";
import { SystemClock } from "../../packages/platform-node/src/index.ts";

const uuid = "018f0b6d-7b1a-7abc-8def-0123456789ab";
const digestHex = "a".repeat(64);

test("stable ID parses a canonical kind and UUID", () => {
  const id = StableId.parse(`run_${uuid}`);
  assert.equal(id.kind, "run");
  assert.equal(id.uuid, uuid);
  assert.equal(id.value, `run_${uuid}`);
});

test("stable ID enforces the expected kind", () => {
  assert.throws(() => StableId.parse(`run_${uuid}`, "workspace"), { code: "VES_ID_KIND_MISMATCH" });
});

test("stable ID creation uses an injected UUID source", () => {
  assert.equal(StableId.create("workspace", () => uuid).value, `workspace_${uuid}`);
});

test("stable ID rejects invalid kinds", () => {
  assert.throws(() => StableId.create("Run", () => uuid), { code: "VES_ID_INVALID" });
});

test("stable ID rejects non-v4/v7 and uppercase UUIDs", () => {
  assert.throws(() => StableId.parse("run_00000000-0000-1000-8000-000000000000"), {
    code: "VES_ID_INVALID"
  });
  assert.throws(() => StableId.parse(`run_${uuid.toUpperCase()}`), { code: "VES_ID_INVALID" });
});

test("requirement ID accepts the canonical VES namespace", () => {
  assert.equal(RequirementId.parse("VES-SPC-004").value, "VES-SPC-004");
});

test("requirement ID rejects ambiguous casing and widths", () => {
  assert.throws(() => RequirementId.parse("ves-SPC-4"), { code: "VES_REQUIREMENT_ID_INVALID" });
});

test("logical path preserves a canonical relative POSIX path", () => {
  const path = LogicalPath.parse("packages/domain/src/index.ts");
  assert.equal(path.value, "packages/domain/src/index.ts");
  assert.deepEqual(path.segments, ["packages", "domain", "src", "index.ts"]);
});

test("logical path accepts dot-prefixed repository segments", () => {
  assert.equal(LogicalPath.parse(".github/workflows/ci.yml").value, ".github/workflows/ci.yml");
});

test("logical path rejects POSIX absolute paths", () => {
  assert.throws(() => LogicalPath.parse("/etc/passwd"), { code: "VES_LOGICAL_PATH_INVALID" });
});

test("logical path rejects Windows paths and backslashes", () => {
  assert.throws(() => LogicalPath.parse("C:\\repo\\file"), { code: "VES_LOGICAL_PATH_INVALID" });
  assert.throws(() => LogicalPath.parse("dir\\file"), { code: "VES_LOGICAL_PATH_INVALID" });
});

test("logical path rejects parent and current traversal", () => {
  assert.throws(() => LogicalPath.parse("a/../b"), { code: "VES_LOGICAL_PATH_INVALID" });
  assert.throws(() => LogicalPath.parse("a/./b"), { code: "VES_LOGICAL_PATH_INVALID" });
});

test("logical path rejects empty and ambiguous segments", () => {
  for (const value of ["", ".", "a//b", "a/", "a\0b"]) {
    assert.throws(() => LogicalPath.parse(value), { code: "VES_LOGICAL_PATH_INVALID" });
  }
});

test("logical path rejects cross-platform reserved names and characters", () => {
  for (const value of ["CON", "NUL.txt", "dir/file:name", "dir/*.ts", "dir/file?"]) {
    assert.throws(() => LogicalPath.parse(value), { code: "VES_LOGICAL_PATH_INVALID" });
  }
});

test("logical path rejects trailing dot, trailing space, and oversized segments", () => {
  for (const value of ["dir/file.", "dir/file ", `dir/${"a".repeat(256)}`]) {
    assert.throws(() => LogicalPath.parse(value), { code: "VES_LOGICAL_PATH_INVALID" });
  }
});

test("logical path ancestry is segment-aware", () => {
  const root = LogicalPath.parse("packages/domain");
  assert.equal(LogicalPath.parse("packages/domain/src").isWithin(root), true);
  assert.equal(LogicalPath.parse("packages/domainish/src").isWithin(root), false);
  assert.equal(root.isWithin(root), true);
});

test("digest parses canonical algorithm-qualified SHA-256", () => {
  const digest = Digest.parse(`sha256:${digestHex}`);
  assert.equal(digest.algorithm, "sha256");
  assert.equal(digest.hex, digestHex);
  assert.equal(digest.value, `sha256:${digestHex}`);
});

test("digest constructs from a schema-compatible hex value", () => {
  assert.equal(Digest.sha256(digestHex).value, `sha256:${digestHex}`);
});

test("digest rejects unsupported algorithms", () => {
  assert.throws(() => Digest.parse(`md5:${"a".repeat(32)}`), { code: "VES_DIGEST_INVALID" });
});

test("digest rejects wrong length and uppercase hex", () => {
  assert.throws(() => Digest.parse("sha256:abcd"), { code: "VES_DIGEST_INVALID" });
  assert.throws(() => Digest.parse(`sha256:${digestHex.toUpperCase()}`), {
    code: "VES_DIGEST_INVALID"
  });
});

test("digest equality compares canonical values", () => {
  assert.equal(Digest.sha256(digestHex).equals(Digest.parse(`sha256:${digestHex}`)), true);
  assert.equal(Digest.sha256(digestHex).equals(Digest.sha256("b".repeat(64))), false);
});

test("instant parses canonical millisecond UTC representation", () => {
  const instant = IsoInstant.parse("2026-07-13T12:34:56.789Z");
  assert.equal(instant.value, "2026-07-13T12:34:56.789Z");
  assert.equal(instant.epochMilliseconds, Date.UTC(2026, 6, 13, 12, 34, 56, 789));
});

test("instant constructs from a valid Date snapshot", () => {
  const date = new Date("2026-07-13T12:34:56.789Z");
  const instant = IsoInstant.fromDate(date);
  date.setUTCFullYear(2000);
  assert.equal(instant.value, "2026-07-13T12:34:56.789Z");
});

test("instant rejects offsets and missing milliseconds", () => {
  assert.throws(() => IsoInstant.parse("2026-07-13T13:34:56.789+01:00"), {
    code: "VES_INSTANT_INVALID"
  });
  assert.throws(() => IsoInstant.parse("2026-07-13T12:34:56Z"), {
    code: "VES_INSTANT_INVALID"
  });
});

test("instant rejects impossible dates", () => {
  assert.throws(() => IsoInstant.parse("2026-02-30T12:00:00.000Z"), {
    code: "VES_INSTANT_INVALID"
  });
  assert.throws(() => IsoInstant.fromDate(new Date(Number.NaN)), { code: "VES_INSTANT_INVALID" });
});

test("instant comparison is total", () => {
  const first = IsoInstant.parse("2026-07-13T00:00:00.000Z");
  const second = IsoInstant.parse("2026-07-13T00:00:00.001Z");
  assert.equal(first.compare(second), -1);
  assert.equal(second.compare(first), 1);
  assert.equal(first.compare(first), 0);
});

test("instant adds finite safe millisecond durations", () => {
  const first = IsoInstant.parse("2026-07-13T00:00:00.000Z");
  assert.equal(first.addMilliseconds(1_500).value, "2026-07-13T00:00:01.500Z");
  assert.throws(() => first.addMilliseconds(Number.POSITIVE_INFINITY), {
    code: "VES_INSTANT_INVALID"
  });
});

test("fixed clock returns a deterministic immutable instant", () => {
  const clock = new FixedClock(IsoInstant.parse("2026-07-13T00:00:00.000Z"));
  assert.equal(clock.now().value, "2026-07-13T00:00:00.000Z");
  assert.equal(clock.now(), clock.now());
});

test("fixed clock advances only through an explicit call", () => {
  const clock = new FixedClock(IsoInstant.parse("2026-07-13T00:00:00.000Z"));
  clock.advanceBy(250);
  assert.equal(clock.now().value, "2026-07-13T00:00:00.250Z");
});

test("system clock returns a canonical instant bounded by wall time", () => {
  const before = Date.now();
  const actual = new SystemClock().now();
  const after = Date.now();
  assert.ok(actual.epochMilliseconds >= before && actual.epochMilliseconds <= after);
  assert.match(actual.value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
});

test("actor accepts every closed actor kind", () => {
  for (const kind of ["human", "agent", "service", "system"]) {
    assert.equal(ActorRef.create(kind, "github:alice").kind, kind);
  }
});

test("actor rejects whitespace, control data, and unknown kinds", () => {
  assert.throws(() => ActorRef.create("human", "Alice Smith"), { code: "VES_ACTOR_INVALID" });
  assert.throws(() => ActorRef.create("robot", "worker-1"), { code: "VES_ACTOR_INVALID" });
});

test("actor serializes a frozen minimal reference", () => {
  const actor = ActorRef.create("agent", "driver:qwen");
  assert.deepEqual(actor.toJSON(), { kind: "agent", id: "driver:qwen" });
  assert.equal(Object.isFrozen(actor), true);
});

test("classification parses the closed data vocabulary", () => {
  for (const value of ["public", "internal", "confidential", "restricted", "secret"]) {
    assert.equal(DataClassification.parse(value).value, value);
  }
});

test("classification rejects unknown or mis-cased labels", () => {
  assert.throws(() => DataClassification.parse("Private"), {
    code: "VES_CLASSIFICATION_INVALID"
  });
});

test("classification ordering is monotonic", () => {
  assert.equal(DataClassification.parse("restricted").dominates(DataClassification.parse("internal")), true);
  assert.equal(DataClassification.parse("public").dominates(DataClassification.parse("secret")), false);
});

test("most restrictive classification is independent of input order", () => {
  const values = ["internal", "secret", "public"].map((value) => DataClassification.parse(value));
  assert.equal(DataClassification.mostRestrictive(values).value, "secret");
  assert.equal(DataClassification.mostRestrictive(values.reverse()).value, "secret");
});

function registry() {
  return new PublicErrorRegistry([
    {
      code: "VES_RUN_STALE",
      category: "state",
      component: "workflow",
      retryability: "after-change",
      recovery: "Refresh the run and request approval again.",
      documentationVersion: "1",
      safeDetails: { runId: "string", expectedVersion: "number", terminal: "boolean" }
    }
  ]);
}

test("public error registry creates the exact stable envelope", () => {
  const error = registry().create("VES_RUN_STALE", {
    runId: `run_${uuid}`,
    expectedVersion: 3,
    terminal: false
  });
  assert.deepEqual(error, {
    schemaVersion: "1",
    code: "VES_RUN_STALE",
    category: "state",
    component: "workflow",
    retryability: "after-change",
    recovery: "Refresh the run and request approval again.",
    safeDetails: { runId: `run_${uuid}`, expectedVersion: 3, terminal: false },
    documentationVersion: "1"
  });
});

test("public error code identity is independent from private exception text", () => {
  const envelope = registry().create("VES_RUN_STALE", {
    runId: `run_${uuid}`,
    expectedVersion: 3,
    terminal: false
  });
  const first = new PublicErrorException(envelope, "database wording one");
  const second = new PublicErrorException(envelope, "different internal wording");
  assert.equal(first.code, second.code);
  assert.notEqual(first.message, second.message);
});

test("public error registry rejects unknown codes", () => {
  assert.throws(() => registry().create("VES_UNKNOWN", {}), { code: "VES_ERROR_CODE_UNKNOWN" });
});

test("public error registry rejects duplicate definitions", () => {
  const definition = {
    code: "VES_DUPLICATE",
    category: "internal",
    component: "runtime",
    retryability: "never",
    recovery: "Report the evidence reference.",
    documentationVersion: "1",
    safeDetails: {}
  };
  assert.throws(() => new PublicErrorRegistry([definition, definition]), {
    code: "VES_ERROR_DEFINITION_INVALID"
  });
});

test("public error rejects undeclared safe detail fields", () => {
  assert.throws(
    () =>
      registry().create("VES_RUN_STALE", {
        runId: `run_${uuid}`,
        expectedVersion: 3,
        terminal: false,
        stack: "must not escape"
      }),
    { code: "VES_ERROR_DETAILS_INVALID" }
  );
});

test("public error rejects missing and wrongly typed safe details", () => {
  assert.throws(() => registry().create("VES_RUN_STALE", { runId: `run_${uuid}`, expectedVersion: "3" }), {
    code: "VES_ERROR_DETAILS_INVALID"
  });
});

test("public error definitions reject sensitive-looking detail keys", () => {
  assert.throws(
    () =>
      new PublicErrorRegistry([
        {
          code: "VES_UNSAFE",
          category: "security",
          component: "secrets",
          retryability: "never",
          recovery: "Rotate the credential.",
          documentationVersion: "1",
          safeDetails: { password: "string" }
        }
      ]),
    { code: "VES_ERROR_DEFINITION_INVALID" }
  );
});

test("public error rejects non-finite numbers and oversized strings", () => {
  assert.throws(
    () =>
      registry().create("VES_RUN_STALE", {
        runId: `run_${uuid}`,
        expectedVersion: Number.NaN,
        terminal: false
      }),
    { code: "VES_ERROR_DETAILS_INVALID" }
  );
  assert.throws(
    () =>
      registry().create("VES_RUN_STALE", {
        runId: "x".repeat(1_025),
        expectedVersion: 3,
        terminal: false
      }),
    { code: "VES_ERROR_DETAILS_INVALID" }
  );
});

test("public error emits optional evidence and raw schema digest fields", () => {
  const error = registry().create(
    "VES_RUN_STALE",
    { runId: `run_${uuid}`, expectedVersion: 3, terminal: false },
    { evidenceRef: `evidence_${uuid}`, causeChainDigest: Digest.sha256(digestHex) }
  );
  assert.equal(error.evidenceRef, `evidence_${uuid}`);
  assert.equal(error.causeChainDigest, digestHex);
});

test("public error snapshots and freezes caller-owned details", () => {
  const details = { runId: `run_${uuid}`, expectedVersion: 3, terminal: false };
  const error = registry().create("VES_RUN_STALE", details);
  details.runId = "changed";
  assert.equal(error.safeDetails.runId, `run_${uuid}`);
  assert.equal(Object.isFrozen(error.safeDetails), true);
  assert.equal(Object.isFrozen(error), true);
});

test("public error registry lists codes deterministically", () => {
  const second = {
    code: "VES_ALPHA",
    category: "validation",
    component: "cli",
    retryability: "never",
    recovery: "Correct the input.",
    documentationVersion: "1",
    safeDetails: {}
  };
  const combined = new PublicErrorRegistry([second, ...registry().definitions]);
  assert.deepEqual(combined.codes, ["VES_ALPHA", "VES_RUN_STALE"]);
});

test("public exception JSON excludes message, stack, and cause", () => {
  const envelope = registry().create("VES_RUN_STALE", {
    runId: `run_${uuid}`,
    expectedVersion: 3,
    terminal: false
  });
  const error = new PublicErrorException(envelope, "sensitive database failure", {
    cause: new Error("password=raw")
  });
  const serialized = JSON.stringify(error);
  assert.deepEqual(JSON.parse(serialized), envelope);
  assert.equal(serialized.includes("sensitive"), false);
  assert.equal(serialized.includes("password"), false);
  assert.equal(serialized.includes("stack"), false);
});

test("core public error catalog has every T13 construction failure", () => {
  assert.deepEqual(corePublicErrorRegistry.codes, [
    "VES_ACTOR_INVALID",
    "VES_CLASSIFICATION_INVALID",
    "VES_DIGEST_INVALID",
    "VES_ERROR_CODE_UNKNOWN",
    "VES_ERROR_DEFINITION_INVALID",
    "VES_ERROR_DETAILS_INVALID",
    "VES_ID_INVALID",
    "VES_ID_KIND_MISMATCH",
    "VES_INSTANT_INVALID",
    "VES_LOGICAL_PATH_INVALID",
    "VES_REQUIREMENT_ID_INVALID"
  ]);
});

test("every core public error validates against the canonical schema", async () => {
  const schemas = await SchemaRegistry.load(new URL("../../schemas/", import.meta.url));
  for (const code of corePublicErrorRegistry.codes) {
    assert.equal(schemas.validate("public-error", "1", corePublicErrorRegistry.create(code, {})).code, code);
  }
});
