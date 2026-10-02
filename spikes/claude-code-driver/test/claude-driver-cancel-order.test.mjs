// invariant: requalification of the Claude Code driver for the cancel order
// (ADP-3, ADP-4). The production ClaudeCodeDriver reports how a stopped run ended
// before the terminal event, emits nothing after that event, and answers on
// close what the event said. The provider is the
// DETERMINISTIC FAKE `claude` executable (fake-claude.mjs) in its `hang`,
// `error` and `garbled` modes. No model is invoked.
import { test } from "node:test";

import { CANCEL_ORDER_ROWS, cancelOrderSuite } from "../../../tests/helpers/driver-cancel-order-fixture.mjs";

cancelOrderSuite(test, "claude-code", CANCEL_ORDER_ROWS["claude-code"]);
