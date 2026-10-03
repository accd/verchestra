import assert from "node:assert/strict";
import { test } from "node:test";

import * as application from "../../packages/application/src/index.ts";
import { authorityFixture, intent } from "../helpers/authority-fixture.mjs";

const { ApprovalRecorder, ApprovalRequester, ApprovalRevoker, ApprovalVerifier } = application;
const approver = { kind: "human", id: "reviewer@example.test" };
const ordered = (values) => [...values].sort((left, right) => Number(left > right) - Number(left < right));
const pick = (source, names) => Object.fromEntries(names.map((name) => [name, source[name]]));

// why: a port the operation reads but the caller does not supply surfaces as
// its bare name, so an undeclared read fails the equality instead of hiding.
// A port that is a function (the id source) is recorded when it is called.
function recording(ports) {
  const read = new Set();
  const port = (name, target) =>
    typeof target === "function"
      ? new Proxy(target, {
          apply(callee, receiver, args) {
            read.add(name);
            return Reflect.apply(callee, receiver, args);
          }
        })
      : new Proxy(target, {
          get(members, member) {
            read.add(`${name}.${String(member)}`);
            const value = Reflect.get(members, member);
            return typeof value === "function" ? value.bind(members) : value;
          }
        });
  const recorded = new Proxy(ports, {
    get(target, name) {
      if (!Object.hasOwn(target, name)) {
        read.add(String(name));
        return undefined;
      }
      return port(String(name), target[name]);
    }
  });
  return { read, ports: recorded };
}

async function recordedApproval() {
  const fixture = authorityFixture();
  const request = new ApprovalRequester(fixture).request(intent());
  return { fixture, approval: await new ApprovalRecorder(fixture).record(request, approver) };
}

test("a request reads only the digest, the clock and the id source", () => {
  const { read, ports } = recording(pick(authorityFixture(), ["digest", "clock", "uuid"]));
  const request = new ApprovalRequester(ports).request(intent());
  assert.equal(request.approvalId, "approval_018f0000-0000-7000-8000-000000000001");
  assert.deepEqual(ordered(read), ["clock.now", "digest.sha256", "uuid"]);
});

test("recording reads only the digest, the clock, the seal and the approval store's save", async () => {
  const fixture = authorityFixture();
  const request = new ApprovalRequester(fixture).request(intent());
  const { read, ports } = recording(pick(fixture, ["store", "digest", "clock", "artifacts"]));
  const approval = await new ApprovalRecorder(ports).record(request, approver);
  assert.equal(fixture.store.approvals.get(request.approvalId).bindingDigest, approval.bindingDigest);
  assert.deepEqual(ordered(read), ["artifacts.seal", "clock.now", "digest.sha256", "store.saveApproval"]);
});

test("verification reads only the digest, the clock, the signature check and the approval store's load", async () => {
  const { fixture, approval } = await recordedApproval();
  const { read, ports } = recording(pick(fixture, ["store", "digest", "clock", "artifacts"]));
  const verdict = await new ApprovalVerifier(ports).verify(approval.approvalId, approval.binding);
  assert.equal(verdict.valid, true);
  assert.deepEqual(ordered(read), ["artifacts.verify", "clock.now", "digest.sha256", "store.loadApproval"]);
});

test("revocation reads only the clock and the approval store's revoke", async () => {
  const { fixture, approval } = await recordedApproval();
  const { read, ports } = recording(pick(fixture, ["store", "clock"]));
  assert.equal(await new ApprovalRevoker(ports).revoke(approval.approvalId, "scope-withdrawn"), true);
  assert.deepEqual(ordered(read), ["clock.now", "store.revokeApproval"]);
});

test("each approval class carries its own operation and no other", () => {
  const fixture = authorityFixture();
  const operations = ["request", "record", "verify", "revoke"];
  for (const [instance, operation] of [
    [new ApprovalRequester(fixture), "request"],
    [new ApprovalRecorder(fixture), "record"],
    [new ApprovalVerifier(fixture), "verify"],
    [new ApprovalRevoker(fixture), "revoke"]
  ])
    for (const other of operations)
      assert.equal(
        typeof instance[other],
        other === operation ? "function" : "undefined",
        `${instance.constructor.name}.${other}`
      );
  assert.equal(application.ApprovalService, undefined, "the combined approval class is gone");
});
