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

// The register exists to fail closed on a requirement nothing proves, so that
// mechanism has to be demonstrated rather than assumed. It used to be shown by
// dropping the declared gaps: with gaps open, the same requirements reappeared
// as unevidenced and the register read INCONSISTENT. Now that every gap is
// retired there is no unevidenced requirement left in the repository to borrow,
// and a register with nothing to report is not evidence that it would report.
// The subject is synthesized instead — an evidenced requirement stripped of its
// evidence — which exercises the same audit and keeps holding whether or not a
// future gap is declared.
test("an unevidenced requirement outside the declared gaps is reported", async () => {
  const references = await collectReferences(ROOT);
  const register = JSON.parse(await readFile(registerPath, "utf8"));
  const withoutGaps = { ...register, openGaps: [] };
  // Whatever is currently declared as a gap is unevidenced without that
  // declaration; with no gaps declared, nothing is.
  assert.equal(evaluateRegister(withoutGaps, references).withoutEvidence.length, register.openGaps.length);

  const evidenced = [...references].find(([, entry]) => entry.test.length > 0 || entry.qualificationReport.length > 0);
  assert.ok(evidenced, "the repository has at least one evidenced requirement to strip");
  const [id, entry] = evidenced;
  const stripped = new Map(references);
  stripped.set(id, { ...entry, test: [], qualificationReport: [] });
  const result = evaluateRegister(withoutGaps, stripped);
  assert.deepEqual(result.withoutEvidence, [id]);
  assert.equal(isConsistent(result), false);
});
