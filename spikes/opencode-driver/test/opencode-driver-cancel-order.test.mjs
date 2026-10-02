// invariant: requalification of the OpenCode driver for the cancel order
// (ADP-3, ADP-4). The production OpenCodeDriver reports how a stopped run ended
// before the terminal event, emits nothing after that event, and answers on
// close what the event said. The provider is the
// DETERMINISTIC FAKE SDK client of tests/helpers/opencode-driver-fixture.mjs
// in its `hang` and `error` modes, and the fake `opencode` executable answers
// the version probe. No model is invoked.
import { test } from "node:test";

import { CANCEL_ORDER_ROWS, cancelOrderSuite } from "../../../tests/helpers/driver-cancel-order-fixture.mjs";

cancelOrderSuite(test, "opencode", CANCEL_ORDER_ROWS["opencode"]);
