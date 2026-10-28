import assert from "node:assert/strict";
import { test } from "node:test";

import { GROWTH_SCALE, LINEAR_GROWTH_LIMIT, growth } from "../helpers/linear-growth.mjs";

// The growth helper is the sensor behind every linearity assertion, so it must
// keep telling linear from quadratic work.

const linear = (text) => {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) if (text.charCodeAt(index) === 97) count += 1;
  return count;
};

const quadratic = (text) => {
  let count = 0;
  for (let left = 0; left < text.length; left += 1)
    for (let right = left; right < text.length; right += 1) if (text.charCodeAt(right) === 97) count += 1;
  return count;
};

const letters = (size) => "a".repeat(size);

test("linear work measures under the limit", () => {
  assert.ok(growth(linear, letters) < LINEAR_GROWTH_LIMIT);
});

test("quadratic work measures over the limit in every round", () => {
  assert.ok(growth(quadratic, letters, { base: 400 }) > LINEAR_GROWTH_LIMIT);
});

// why: runs of the same input in a row form one block, so the blocks show each
// batch the helper ran. Calibration and the first small batch merge into the
// first block, which is dropped.
function measuredBlocks(work, options) {
  const blocks = [];
  const recorded = (text) => {
    const last = blocks.at(-1);
    if (last?.length === text.length) last.count += 1;
    else blocks.push({ length: text.length, count: 1 });
    return work(text);
  };
  growth(recorded, letters, options);
  return blocks.slice(1);
}

// why: for a linear cost both batches must last about as long, or the least of
// several batches favours the short one on an oversubscribed runner.
test("each round runs the large input a quarter as many times as the small one, alternately", () => {
  const options = { base: 5_000, samples: 5, rounds: 3 };
  const measured = measuredBlocks(linear, options);
  assert.equal(measured.length, 2 * options.samples * options.rounds - 1);
  const small = measured[1].count;
  assert.ok(small >= GROWTH_SCALE && Number.isInteger(small / GROWTH_SCALE), `${small} small runs per batch`);
  measured.forEach((block, index) =>
    assert.deepEqual(
      block,
      index % 2 === 0
        ? { length: options.base * GROWTH_SCALE, count: small / GROWTH_SCALE }
        : { length: options.base, count: small },
      `batch ${index + 2}`
    )
  );
});

// why: a pause during calibration, as preemption makes on a loaded runner, must
// not leave the measured batches a few runs long; the first call stalls once.
test("a stall while calibrating does not shorten the measured batches", () => {
  let stalled = false;
  const stallingOnce = (text) => {
    if (!stalled) {
      stalled = true;
      const until = process.hrtime.bigint() + 25_000_000n;
      while (process.hrtime.bigint() < until);
    }
    return linear(text);
  };
  const [, small] = measuredBlocks(stallingOnce, { base: 5_000 });
  assert.ok(small.count >= 64, `a measured small batch ran ${small.count} times`);
});

// why: a cost that fills a batch in one run still compares whole runs:
// calibration starts at `GROWTH_SCALE` repetitions, so the large batch never
// runs a fraction of one and divides by it.
test("a cost that fills its batch in one run still compares whole runs", () => {
  assert.ok(growth(linear, letters, { base: 200_000, minimumBatchMs: 0 }) < LINEAR_GROWTH_LIMIT);
});

// why: every large batch of the first round runs `misread` instead of `work`,
// as noise on one side of the ratio would; the large batches are counted as
// they start after a small one.
function misreadingFirstRound(work, misread, samples) {
  let previous = 0;
  let largeBatches = 0;
  return (text) => {
    if (text.length > previous && previous !== 0) largeBatches += 1;
    previous = text.length;
    return largeBatches >= 1 && largeBatches <= samples ? misread(text) : work(text);
  };
}

test("a round that misreads a quadratic cost as linear does not decide the verdict", () => {
  const samples = 5;
  const run = misreadingFirstRound(quadratic, linear, samples);
  assert.ok(growth(run, letters, { base: 400, samples, rounds: 3 }) > LINEAR_GROWTH_LIMIT);
});

test("a round that misreads a linear cost as slow does not decide the verdict", () => {
  const samples = 5;
  const slow = (text) => {
    let count = 0;
    for (let pass = 0; pass < GROWTH_SCALE; pass += 1) count += linear(text);
    return count;
  };
  const run = misreadingFirstRound(linear, slow, samples);
  assert.ok(growth(run, letters, { samples, rounds: 3 }) < LINEAR_GROWTH_LIMIT);
});
