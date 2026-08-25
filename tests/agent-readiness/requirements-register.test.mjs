import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { collectReferences, evaluateRegister, isClosed, isConsistent } from "../../scripts/requirements-trace.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const registerPath = new URL("../../docs/requirements-register.json", import.meta.url);

async function evaluation() {
  const register = JSON.parse(await readFile(registerPath, "utf8"));
  return { register, result: evaluateRegister(register, await collectReferences(ROOT)) };
}

test("every referenced requirement is registered and every registered requirement is referenced", async () => {
  const { result } = await evaluation();
  assert.deepEqual(result.unregistered, []);
  assert.deepEqual(result.unreferenced, []);
  assert.deepEqual(result.duplicates, []);
});

test("a requirement without test or report evidence fails unless it is a declared gap", async () => {
  const { result } = await evaluation();
  assert.deepEqual(result.withoutEvidence, []);
  assert.equal(isConsistent(result), true);
});

test("every declared gap names a reason and is retired once evidence appears", async () => {
  const { register, result } = await evaluation();
  assert.deepEqual(result.gapsWithoutReason, []);
  assert.deepEqual(result.staleGaps, []);
  for (const gap of register.openGaps) assert.match(gap.id, /^VES-[A-Z]{3}-[0-9]{3}$/u);
});

test("T77 closure is met only when no requirement is still waiting for evidence", async () => {
  const { register, result } = await evaluation();
  assert.equal(isClosed(result), register.openGaps.length === 0);
});

test("an unevidenced requirement outside the declared gaps is reported", async () => {
  const references = await collectReferences(ROOT);
  const register = JSON.parse(await readFile(registerPath, "utf8"));
  const withoutGaps = { ...register, openGaps: [] };
  const result = evaluateRegister(withoutGaps, references);
  assert.equal(result.withoutEvidence.length, register.openGaps.length);
  assert.equal(isConsistent(result), false);
});
