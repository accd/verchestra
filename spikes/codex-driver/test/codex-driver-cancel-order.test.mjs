// invariant: requalification of the Codex driver for the cancel order
// (ADP-3, ADP-4). The production CodexDriver reports how a stopped run ended
// before the terminal event, emits nothing after that event, and answers on
// close what the event said. The provider is the
// DETERMINISTIC FAKE `codex app-server` (fake-codex-app-server.mjs) in its
// `hang`, `error` and `garbled` modes. No model is invoked.
import { test } from "node:test";

import { CANCEL_ORDER_ROWS, cancelOrderSuite } from "../../../tests/helpers/driver-cancel-order-fixture.mjs";

cancelOrderSuite(test, "codex", CANCEL_ORDER_ROWS["codex"]);
