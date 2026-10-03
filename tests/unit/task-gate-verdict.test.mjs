// invariant: a gate run has one verdict (ADR2-4). The gate decides with it
// whether a task may be committed and verification decides with it whether a
// mutant was killed, so a run the gate would refuse to commit fails for both.
import assert from "node:assert/strict";
import { test } from "node:test";

import { taskGateVerdict } from "../../packages/application/src/index.ts";
import { coordinator, digest, gateInput, gatePorts } from "../helpers/gate-commit-fixture.mjs";

const EXIT_CODE = Object.freeze({ resultProtocol: "exit-code", minimumTests: 0 });
const TEST_SUMMARY = Object.freeze({ resultProtocol: "test-summary", minimumTests: 30 });
const SUMMARY = Object.freeze({ total: 30, passed: 30, failed: 0, skipped: 0, cancelled: 0, todo: 0 });

const run = (overrides = {}) => ({ exitCode: 0, timedOut: false, outputLimitExceeded: false, ...overrides });

test("an exit-code gate passes on a zero exit alone and fails on anything that bounded it", () => {
  assert.equal(taskGateVerdict(EXIT_CODE, run()), "PASS");
  for (const [label, overrides] of [
    ["a non-zero exit", { exitCode: 1 }],
    ["an exit the runner could not read", { exitCode: -1 }],
    ["a timeout", { timedOut: true }],
    ["an output overflow", { outputLimitExceeded: true }]
  ])
    assert.equal(taskGateVerdict(EXIT_CODE, run(overrides)), "FAIL", label);
});

test("an exit-code gate reads no test summary", () => {
  assert.equal(taskGateVerdict(EXIT_CODE, run({ tests: { ...SUMMARY, passed: 0, failed: 30 } })), "PASS");
});

test("a test-summary gate passes only on a complete clean summary that meets its minimum", () => {
  assert.equal(taskGateVerdict(TEST_SUMMARY, run({ tests: SUMMARY })), "PASS");
  assert.equal(taskGateVerdict(TEST_SUMMARY, run({ tests: { ...SUMMARY, total: 31, passed: 31 } })), "PASS");
});

// why: the verifier's own copy of the rule admitted the last four rows, so a
// mutant whose gates ended that way counted as surviving while the gate would
// have refused to commit it.
for (const [label, tests] of [
  ["a failed test", { ...SUMMARY, passed: 29, failed: 1 }],
  ["a skipped test", { ...SUMMARY, passed: 29, skipped: 1 }],
  ["fewer passing tests than the minimum", { ...SUMMARY, total: 29, passed: 29 }],
  ["a cancelled test", { ...SUMMARY, passed: 29, cancelled: 1 }],
  ["a todo test", { ...SUMMARY, passed: 29, todo: 1 }],
  ["a total that is not the sum of its parts", { ...SUMMARY, total: 31 }],
  ["no summary at all", undefined]
]) {
  test(`a test-summary gate with ${label} fails`, () => {
    assert.equal(taskGateVerdict(TEST_SUMMARY, run(tests === undefined ? {} : { tests })), "FAIL");
  });
}

test("a clean summary does not rescue a run the runner bounded", () => {
  for (const overrides of [{ exitCode: 1 }, { timedOut: true }, { outputLimitExceeded: true }])
    assert.equal(taskGateVerdict(TEST_SUMMARY, run({ ...overrides, tests: SUMMARY })), "FAIL");
});

// invariant: the evidence each gate records is byte-identical to what it was
// before the verdict moved; these digests were taken from the coordinator on
// main before the change and match the coordinator after it.
const failing = (tests) => ({
  gates: {
    run: async (command) => ({
      exitCode: 0,
      timedOut: false,
      outputLimitExceeded: false,
      stdoutDigest: digest(`${command.gateId}:stdout`),
      stderrDigest: digest(""),
      stdoutBytes: 100,
      stderrBytes: 0,
      outputRef: `output:${command.gateId}`,
      ...(command.resultProtocol === "test-summary" ? { tests } : {})
    })
  }
});

test("the gate records the same evidence bytes and digests it recorded before the verdict moved", async () => {
  const passed = gatePorts();
  const result = await coordinator(passed.ports).execute(gateInput());
  assert.equal(result.gateEvidenceDigest, "sha256:aa954dceaf433d4c3b9cdbeb6f028818c6d30e5cc3e027bb0bdfc119942d86e3");
  assert.equal(result.idempotencyKey, "sha256:b493ef30769fb379ee6bf66c0e1adab4fa53a587bed534bf4dbb914cb3aba95b");
  const exitCodeEvidence = "sha256:ed3ba9a5647a978bb993920339bd7e474945aaab675a9495a83aa8b238e2a683";
  assert.deepEqual(
    passed.state.evidence.map((entry) => digest(JSON.stringify(entry))),
    [exitCodeEvidence, "sha256:32756a569182ef80e0a598ab9450de70e1fcd4d31a54697f77e641df695572c5"]
  );
  for (const [tests, recorded] of [
    [{ ...SUMMARY, passed: 29, skipped: 1 }, "sha256:1fb4e05885019aa7f16504b44b5045b05761c7ada24246fa2f29f098a1f3f59f"],
    [{ ...SUMMARY, passed: 29, todo: 1 }, "sha256:edf7f82560381260cf98b0381f35f96196921f42e412dcaf56403cfd9a2dd175"],
    [{ ...SUMMARY, total: 31 }, "sha256:ed428dde8205dbd70d979f3190a2e391cc9a662b81eb1e31b5042490212c4bba"]
  ]) {
    const { state, ports } = gatePorts(failing(tests));
    assert.equal((await coordinator(ports).execute(gateInput())).status, "GATE_FAILED");
    assert.deepEqual(
      state.evidence.map((entry) => digest(JSON.stringify(entry))),
      [exitCodeEvidence, recorded]
    );
    assert.equal(state.evidence.at(-1).verdict, "FAIL");
  }
});
