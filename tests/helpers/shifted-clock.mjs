// DETERMINISTIC FIXTURE - a wall clock moved ahead for the whole `vestra`
// child it is preloaded into (`--import <this file>?offset=<ms>`), so a
// journey can let hours or days pass while a run waits suspended. Only the
// child's `Date` moves; the providers it starts are labelled fakes that read
// no time. No product code reads the offset.
const offset = Number(new URL(import.meta.url).searchParams.get("offset"));
if (!Number.isSafeInteger(offset) || offset <= 0) throw new Error("shifted-clock: the offset must be a positive count");

const SystemDate = Date;

class ShiftedDate extends SystemDate {
  constructor(...value) {
    if (value.length === 0) super(SystemDate.now() + offset);
    else super(...value);
  }

  static now() {
    return SystemDate.now() + offset;
  }
}

globalThis.Date = ShiftedDate;
