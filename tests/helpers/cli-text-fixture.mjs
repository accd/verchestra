// invariant: the CLI's text form prints one `member: value` line per member of
// a command's result, with a nested value as compact JSON. Reading it back
// lets a test compare it with the `--output json` form of the same command,
// member by member, by value rather than by formatting.
import assert from "node:assert/strict";

export function textMembers(stdout) {
  const members = new Map();
  for (const line of stdout.split("\n").filter(Boolean)) {
    const separator = line.indexOf(": ");
    assert.ok(separator > 0, `a text line is not a member: ${line}`);
    members.set(line.slice(0, separator), line.slice(separator + 2));
  }
  return members;
}

// why: two invocations of a command can differ in what each one creates (a
// run ID, a digest that binds it, an expiry); `perInvocation` names those
// members, which must still be printed, and every other member must agree.
export function assertTextAgrees(stdout, data, perInvocation = []) {
  const text = textMembers(stdout);
  const order = (left, right) => Number(left > right) - Number(left < right);
  assert.deepEqual([...text.keys()].sort(order), Object.keys(data).sort(order), "text and JSON name other members");
  for (const [member, value] of Object.entries(data)) {
    if (perInvocation.includes(member)) continue;
    if (value !== null && typeof value === "object") assert.deepEqual(JSON.parse(text.get(member)), value, member);
    else assert.equal(text.get(member), String(value), member);
  }
}
