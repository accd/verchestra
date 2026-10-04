// invariant: on Windows the subscription profile refuses a machine whose
// Claude Code policy lives in the managed settings directory, the machine
// policy key, or the user policy key (SSI-74), and a key it cannot read counts
// as present. Which sources a platform has, and how presence is decided, run
// here on every platform with fakes; the real registry reader is qualified in
// tests/unit/windows-registry.test.mjs on the Windows runner.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import {
  CLAUDE_WINDOWS_POLICY_DIRECTORY,
  CLAUDE_WINDOWS_POLICY_KEYS,
  ClaudeCodeDriver,
  documentedManagedPolicySources,
  managedPolicyPresent
} from "../../packages/drivers/src/index.ts";
import {
  cleanupMediatedFixtures,
  fakeMediatedClaude,
  mediatedErrors,
  mediatedFixture
} from "../helpers/claude-mediated-fixture.mjs";
import { WIN32_HOST, windowsMediationPath } from "../helpers/mediation-platform.mjs";

const SUBSCRIPTION = "mediated-mcp-subscription";
const HKLM = "HKLM\\SOFTWARE\\Policies\\ClaudeCode";
const HKCU = "HKCU\\SOFTWARE\\Policies\\ClaudeCode";
const roots = [];

afterEach(async () => {
  await cleanupMediatedFixtures();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// invariant: a DETERMINISTIC FAKE registry that records every key it is asked
// about and answers from a fixed set of present keys.
function fakeRegistry(present = []) {
  const asked = [];
  const registry = async (key) => {
    asked.push(key);
    return present.includes(key);
  };
  return { registry, asked };
}

async function policyRoot() {
  const root = await mkdtemp(join(tmpdir(), "verchestra-policy-"));
  roots.push(root);
  const empty = join(root, "empty");
  const populated = join(root, "populated");
  await mkdir(empty);
  await mkdir(populated);
  await writeFile(join(populated, "managed-settings.json"), "{}\n");
  return { absent: join(root, "absent"), empty, populated };
}

test("Windows names the managed settings directory and both policy keys, and nothing else", () => {
  assert.equal(CLAUDE_WINDOWS_POLICY_DIRECTORY, "C:\\Program Files\\ClaudeCode");
  assert.deepEqual(CLAUDE_WINDOWS_POLICY_KEYS, [HKLM, HKCU]);
  assert.deepEqual(documentedManagedPolicySources("win32"), {
    paths: ["C:\\Program Files\\ClaudeCode"],
    registryKeys: [HKLM, HKCU]
  });
  assert.deepEqual(documentedManagedPolicySources("linux"), { paths: ["/etc/claude-code"], registryKeys: [] });
  const darwin = documentedManagedPolicySources("darwin");
  assert.deepEqual(darwin.registryKeys, []);
  assert.deepEqual(darwin.paths.slice(0, 2), [
    "/Library/Application Support/ClaudeCode",
    "/Library/Managed Preferences/com.anthropic.claudecode.plist"
  ]);
});

for (const [present, expected] of [
  [[HKLM], true],
  [[HKCU], true],
  [[HKLM, HKCU], true],
  [[], false]
])
  test(`policy keys ${JSON.stringify(present)} make the Windows sources ${expected ? "present" : "absent"}`, async () => {
    const { absent } = await policyRoot();
    const { registry, asked } = fakeRegistry(present);
    assert.equal(
      await managedPolicyPresent({ paths: [absent], registryKeys: CLAUDE_WINDOWS_POLICY_KEYS }, registry),
      expected
    );
    assert.deepEqual(asked, present[0] === HKLM ? [HKLM] : [HKLM, HKCU], "keys are read in order until one is present");
  });

test("a key the registry reader cannot answer for counts as present", async () => {
  const { absent } = await policyRoot();
  const sources = { paths: [absent], registryKeys: [HKCU] };
  for (const registry of [
    async () => {
      throw new Error("reg.exe could not run");
    },
    async () => undefined,
    () => {
      throw new Error("synchronous failure");
    }
  ])
    assert.equal(await managedPolicyPresent(sources, registry), true);
});

test("a populated policy directory is present before any key is read, and an empty one is not", async () => {
  const { empty, populated } = await policyRoot();
  const { registry, asked } = fakeRegistry();
  assert.equal(await managedPolicyPresent({ paths: [populated], registryKeys: [HKLM, HKCU] }, registry), true);
  assert.deepEqual(asked, []);
  assert.equal(await managedPolicyPresent({ paths: [empty], registryKeys: [HKLM, HKCU] }, registry), false);
  assert.deepEqual(asked, [HKLM, HKCU]);
});

test("the subscription profile refuses a present policy key before any spawn", async (t) => {
  if (WIN32_HOST) return windowsMediationPath(t);
  const { absent } = await policyRoot();
  const { registry, asked } = fakeRegistry([HKCU]);
  const fixture = await mediatedFixture({
    kind: SUBSCRIPTION,
    profile: {
      managedPolicyPaths: [absent],
      managedPolicyRegistryKeys: CLAUDE_WINDOWS_POLICY_KEYS,
      managedPolicyRegistry: registry
    }
  });
  await assert.rejects(fixture.run(), { code: "VES_CLAUDE_MANAGED_POLICY_PRESENT" });
  assert.deepEqual(fixture.spawned, []);
  assert.deepEqual(asked, [HKLM, HKCU]);
});

test("without the composition's registry reader every policy key counts as present", async (t) => {
  if (WIN32_HOST) return windowsMediationPath(t);
  const { absent } = await policyRoot();
  const fixture = await mediatedFixture({
    kind: SUBSCRIPTION,
    profile: { managedPolicyPaths: [absent], managedPolicyRegistryKeys: [HKLM] }
  });
  await assert.rejects(fixture.run(), { code: "VES_CLAUDE_MANAGED_POLICY_PRESENT" });
  assert.deepEqual(fixture.spawned, []);
});

test("the subscription profile runs when the directory and both keys are proven absent", async (t) => {
  if (WIN32_HOST) return windowsMediationPath(t);
  const { absent } = await policyRoot();
  const { registry, asked } = fakeRegistry();
  const fixture = await mediatedFixture({
    kind: SUBSCRIPTION,
    profile: {
      managedPolicyPaths: [absent],
      managedPolicyRegistryKeys: CLAUDE_WINDOWS_POLICY_KEYS,
      managedPolicyRegistry: registry
    }
  });
  assert.deepEqual(mediatedErrors((await fixture.run()).events), []);
  assert.deepEqual(asked, [HKLM, HKCU]);
});

test("policy keys are validated, belong to the subscription profile, and the reader is never consulted without keys", async (t) => {
  if (WIN32_HOST) return windowsMediationPath(t);
  const resolveExecution = async () => assert.fail("not reached");
  const command = [process.execPath, fakeMediatedClaude];
  for (const key of [
    "HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\ClaudeCode",
    "HKU\\SOFTWARE\\Policies\\ClaudeCode",
    "HKLM\\SYSTEM\\Policies\\ClaudeCode",
    "HKLM\\SOFTWARE\\Policies\\ClaudeCode\\Sub",
    "HKLM\\SOFTWARE\\Policies\\Claude Code & calc",
    "HKLM\\SOFTWARE\\Policies\\"
  ])
    assert.throws(
      () =>
        new ClaudeCodeDriver({
          command,
          profile: { kind: SUBSCRIPTION, managedPolicyRegistryKeys: [key] },
          resolveExecution
        }),
      { code: "VES_CLAUDE_MEDIATION_INVALID" },
      key
    );
  assert.throws(
    () =>
      new ClaudeCodeDriver({
        command,
        profile: { kind: "mediated-mcp", managedPolicyRegistryKeys: [HKLM] },
        resolveExecution
      }),
    { code: "VES_CLAUDE_MEDIATION_INVALID" }
  );
  const { registry, asked } = fakeRegistry([HKLM, HKCU]);
  const fixture = await mediatedFixture({ kind: "mediated-mcp", profile: { managedPolicyRegistry: registry } });
  assert.deepEqual(mediatedErrors((await fixture.run()).events), []);
  assert.deepEqual(asked, [], "the API-key profile reads no policy source");
});
