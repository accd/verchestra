// invariant: the model catalog lists what an account offers on a subscription
// beside what is priced. A subscription-only model has no price and is listed
// once, by the driver that runs it; a price is never invented for it.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isKnownModel,
  isPricedModel,
  isSubscriptionOnlyModel,
  modelPriceTable
} from "../../packages/application/src/execution/model-price-table.ts";
import { normalizeTaskRequest } from "../../packages/application/src/index.ts";
import { validTaskRequest } from "../helpers/task-request-fixture.mjs";

const DRIVERS = ["claude-code", "codex"];

test("the table's version names the October 2026 revision of the subscription models", () => {
  assert.equal(modelPriceTable.version, "2026.10.0");
});

test("the Codex models the pilot account offers are subscription-only, with no price", () => {
  for (const model of [
    "gpt-5.5",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-6-sol",
    "gpt-6-astra",
    "gpt-6-luna",
    "gpt-6.1-sol"
  ]) {
    assert.equal(isSubscriptionOnlyModel("codex", model), true, model);
    assert.equal(isPricedModel(model), false, model);
    assert.equal(modelPriceTable.models[model], undefined, `${model} has no price`);
  }
  for (const model of ["gpt-reserve", "codex-auto-review"])
    assert.equal(isKnownModel("codex", model), false, `${model} is no model a task may name`);
});

test("a subscription-only model is listed once, by one driver, and is never a priced model", () => {
  const listed = DRIVERS.flatMap((driver) => modelPriceTable.subscriptionModels[driver]);
  assert.equal(new Set(listed).size, listed.length, "a model is listed by two drivers or twice");
  for (const model of listed) assert.equal(isPricedModel(model), false, `${model} is priced and listed twice`);
  for (const model of modelPriceTable.subscriptionModels["claude-code"])
    assert.equal(isSubscriptionOnlyModel("codex", model), false, `${model} is no Codex model`);
  for (const model of modelPriceTable.subscriptionModels.codex)
    assert.equal(isSubscriptionOnlyModel("claude-code", model), false, `${model} is no Claude model`);
});

test("a priced model stays priced, and a name the table does not list is known to no driver", () => {
  for (const model of Object.keys(modelPriceTable.models)) assert.equal(isPricedModel(model), true, model);
  for (const driver of DRIVERS) {
    assert.equal(isKnownModel(driver, "claude-sonnet-5"), true);
    assert.equal(isKnownModel(driver, "gpt-5.2-codex"), true);
    assert.equal(isKnownModel(driver, "unlisted-model-9"), false);
    assert.equal(isKnownModel(driver, "toString"), false);
  }
});

test("every listed model is a name a task request's driver and verifier bindings admit", () => {
  const request = validTaskRequest();
  for (const model of modelPriceTable.subscriptionModels["claude-code"]) {
    const normalized = normalizeTaskRequest({ ...request, driver: { ...request.driver, model } });
    assert.equal(normalized.driver.model, model);
  }
  for (const model of modelPriceTable.subscriptionModels.codex) {
    const normalized = normalizeTaskRequest({ ...request, verifier: { ...request.verifier, model } });
    assert.equal(normalized.verifier.model, model);
  }
});

test("a model the table lists for one driver is refused for the other", () => {
  const request = validTaskRequest();
  assert.throws(
    () => normalizeTaskRequest({ ...request, verifier: { ...request.verifier, model: "claude-sonnet-5-5" } }),
    { code: "VES_TASK_REQUEST_DRIVER_UNSUPPORTED" }
  );
  assert.throws(() => normalizeTaskRequest({ ...request, driver: { ...request.driver, model: "gpt-5.5" } }), {
    code: "VES_TASK_REQUEST_DRIVER_UNSUPPORTED"
  });
});
