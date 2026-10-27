// invariant: TST-005 (#598). Whether a cost grows linearly with its input is
// judged by a ratio, never by a wall-clock bound. The input is timed at two
// sizes `GROWTH_SCALE` times apart, so a slow runner slows both alike. Each
// timing is a batch long enough to rise above timer noise, and the least of
// several batches is kept, since interference only ever adds time.
export const GROWTH_SCALE = 4;

// why: over a 4 times larger input a linear cost grows about 4 times and a
// quadratic one about 16; 8 is the geometric middle of the two.
export const LINEAR_GROWTH_LIMIT = 8;

function batch(run, input, repetitions) {
  const started = process.hrtime.bigint();
  for (let index = 0; index < repetitions; index += 1) run(input);
  return Number(process.hrtime.bigint() - started) / 1e6;
}

// `run(input)` does the work once; `make(size)` builds the input of a size.
export function growth(run, make, { base = 5_000, minimumBatchMs = 20, samples = 5 } = {}) {
  const small = make(base);
  const large = make(base * GROWTH_SCALE);
  let repetitions = 1;
  while (batch(run, small, repetitions) < minimumBatchMs && repetitions < 1 << 16) repetitions *= 2;
  const fastest = (input) => Math.min(...Array.from({ length: samples }, () => batch(run, input, repetitions)));
  return fastest(large) / fastest(small);
}
