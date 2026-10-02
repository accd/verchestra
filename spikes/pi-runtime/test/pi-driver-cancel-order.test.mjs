// invariant: requalification of the Pi driver for the cancel order
// (ADP-3, ADP-4). The production PiDriver reports how a stopped run ended
// before the terminal event, emits nothing after that event, and answers on
// close what the event said. The provider is Pi's own
// DETERMINISTIC faux provider, with a stream that ends only when it is
// aborted, or with a response that fails. No model is invoked.
import { test } from "node:test";

import { CANCEL_ORDER_ROWS, cancelOrderSuite } from "../../../tests/helpers/driver-cancel-order-fixture.mjs";

cancelOrderSuite(test, "pi", CANCEL_ORDER_ROWS["pi"]);
