import { IsoInstant, type Clock } from "@verchestra/domain";

export class SystemClock implements Clock {
  now(): IsoInstant {
    return IsoInstant.fromDate(new Date());
  }
}
