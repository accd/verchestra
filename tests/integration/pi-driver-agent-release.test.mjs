import assert from "node:assert/strict";
import { test } from "node:test";
import { Agent } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { PiDriver } from "../../packages/drivers/src/pi-driver.ts";
import { piAbortableFixture, piFixture } from "../helpers/pi-driver-fixture.mjs";

// why: the Pi driver gives its session ledger a release hook that unsubscribes
// from the agent and resets it. Once a session has ended, nothing in the Driver
// interface reaches that agent, so the release is observed on the agent itself.
// The driver builds the agent from the installed package; recording `subscribe`
// on the prototype yields that instance and changes nothing it does.
function agentOf(t) {
  const subscribe = t.mock.method(Agent.prototype, "subscribe");
  return () => {
    assert.equal(subscribe.mock.calls.length, 1, "the driver subscribes to exactly one agent per session");
    return subscribe.mock.calls[0].this;
  };
}

// invariant: a reset keeps the leading system message that declares the tools.
function conversation(agent) {
  return agent.state.messages.map((message) => message.role).filter((role) => role !== "system");
}

// invariant: released means both halves of the hook ran. The transcript is
// empty, and a prompt given to the agent afterwards really runs but reaches the
// session's sink with nothing.
async function assertReleased(agent, events) {
  assert.deepEqual(conversation(agent), [], "the agent's transcript must be reset when its session ends");
  const delivered = events.length;
  await agent.prompt("after the session ended");
  assert.deepEqual(conversation(agent), ["user", "assistant"], "the late prompt must really run");
  assert.equal(events.length, delivered, "an agent that is still subscribed reaches the sink after its session ended");
}

function started(fixture, sink) {
  const driver = new PiDriver(fixture.dependencies());
  return { driver, run: driver.start(fixture.request(), sink, new AbortController().signal) };
}

const LATE = fauxAssistantMessage("late");

test("Pi Driver releases its agent when a completed session is closed", async (t) => {
  const agent = agentOf(t);
  const events = [];
  const { driver, run } = started(piFixture([fauxAssistantMessage("first"), LATE]), (event) => events.push(event));
  const session = await run;
  assert.deepEqual(conversation(agent()), ["user", "assistant"], "an open session keeps its transcript");
  await driver.close(session);
  await assertReleased(agent(), events);
});

test("Pi Driver releases its agent when a session is cancelled after its run", async (t) => {
  const agent = agentOf(t);
  const events = [];
  const { driver, run } = started(piFixture([fauxAssistantMessage("first"), LATE]), (event) => events.push(event));
  const session = await run;
  await driver.cancel(session, "user-request");
  await assertReleased(agent(), events);
});

test("Pi Driver releases its agent when a running session is cancelled", async (t) => {
  const agent = agentOf(t);
  const events = [];
  const fixture = piAbortableFixture([LATE]);
  const { driver, run } = started(fixture, (event) => events.push(event));
  await fixture.running;
  assert.deepEqual(conversation(agent()), ["user"], "the run is under way when it is cancelled");
  await driver.cancel({ sessionId: events[0].sessionId }, "user-request");
  assert.deepEqual(conversation(agent()), [], "the cancel itself releases the agent, before any close");
  await run;
  await assertReleased(agent(), events);
});

test("Pi Driver releases its agent when a session whose run failed is closed", async (t) => {
  const agent = agentOf(t);
  const events = [];
  const failure = fauxAssistantMessage("", { stopReason: "error", errorMessage: "provider failed" });
  const { driver, run } = started(piFixture([failure, LATE]), (event) => events.push(event));
  const session = await run;
  assert.equal(events.at(-1).code, "VES_PI_PROVIDER_ERROR");
  assert.equal((await driver.close(session)).outcome, "failed");
  await assertReleased(agent(), events);
});

test("Pi Driver releases its agent when a start that failed after subscribing is closed", async (t) => {
  // hazard: the only start that rejects once the agent is subscribed is one
  // whose sink throws. The caller holds no session reference then, only the
  // identifier `session.started` announced, and that must still end the session.
  const agent = agentOf(t);
  const events = [];
  const refusing = (event) => {
    if (event.type === "usage.updated" || event.type === "error") throw new Error("sink refused");
    events.push(event);
  };
  const { driver, run } = started(piFixture([fauxAssistantMessage("first"), LATE]), refusing);
  await assert.rejects(run, /sink refused/u);
  await driver.close({ sessionId: events[0].sessionId });
  assert.equal(events.at(-1).type, "session.closed");
  await assertReleased(agent(), events);
});
