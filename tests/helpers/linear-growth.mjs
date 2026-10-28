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

// why: the large input runs a quarter as many times as the small one, so for a
// linear cost both batches last about as long. On an oversubscribed runner the
// least of several batches finds an unpreempted window far more often for a
// short batch than a long one, so batches of equal count made a linear cost
// read as quadratic: on 16 cores loaded twice over, 6 of 12 linear trials
// crossed the limit. A quadratic cost runs its large batch longer, which can
// only push its ratio further over the limit. Calibration starts at
// `GROWTH_SCALE` repetitions, so the quarter stays a whole number, and judges
// the fastest of three batches: one preempted batch reached the length early
// under load, and batches of 32 microsecond-long runs then read as 0.3x or 56x.
function repetitionsFor(run, small, minimumBatchMs) {
  let repetitions = GROWTH_SCALE;
  const fastest = () => Math.min(...Array.from({ length: 3 }, () => batch(run, small, repetitions)));
  while (fastest() < minimumBatchMs && repetitions < 1 << 16) repetitions *= 2;
  return { small: repetitions, large: repetitions / GROWTH_SCALE };
}

// why: the two sizes are sampled alternately, so a pause or a noisy neighbour
// lands on both sides of the ratio rather than on one.
function ratioOnce(run, small, large, repetitions, samples) {
  let fastestSmall = Infinity;
  let fastestLarge = Infinity;
  for (let index = 0; index < samples; index += 1) {
    fastestSmall = Math.min(fastestSmall, batch(run, small, repetitions.small) / repetitions.small);
    fastestLarge = Math.min(fastestLarge, batch(run, large, repetitions.large) / repetitions.large);
  }
  return fastestLarge / fastestSmall;
}

// why: the median of the rounds, not the least. Keeping the least ratio
// suppresses a false alarm, but noise that slows the small side also pulls a
// quadratic ratio down, and one such round let a quadratic cost pass under
// load. A median moves only when most rounds agree, in either direction.
// `run(input)` does the work once; `make(size)` builds the input of a size.
export function growth(run, make, { base = 5_000, minimumBatchMs = 20, samples = 5, rounds = 3 } = {}) {
  const small = make(base);
  const large = make(base * GROWTH_SCALE);
  const repetitions = repetitionsFor(run, small, minimumBatchMs);
  const ratios = Array.from({ length: rounds }, () => ratioOnce(run, small, large, repetitions, samples));
  return ratios.sort((left, right) => left - right)[Math.floor(rounds / 2)];
}
