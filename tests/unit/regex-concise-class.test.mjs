import assert from "node:assert/strict";
import { test } from "node:test";

// SonarCloud S6353 (T8): `[0-9]` became `\d` and `[A-Za-z0-9_]` became `\w`.
// Every rewritten pattern carries the `u` flag and no `i` flag; in that mode
// the shorthand matches exactly the class it replaced, so no input changes
// its verdict. (With `iu` together, `\w` would also match U+017F and U+212A.)
// A requirement-shaped sample is assembled from parts so the requirements
// trace does not read it as a referenced requirement.

test("in unicode mode without ignoreCase, \\d and \\w are exactly the classes they replace", () => {
  const digit = /^\d$/u;
  const digitClass = /^[0-9]$/u;
  const word = /^\w$/u;
  const wordClass = /^[A-Za-z0-9_]$/u;
  for (let code = 0; code <= 0x10ffff; code += 1) {
    if (code >= 0xd800 && code <= 0xdfff) continue;
    const character = String.fromCodePoint(code);
    assert.equal(digit.test(character), digitClass.test(character), `\\d on U+${code.toString(16)}`);
    assert.equal(word.test(character), wordClass.test(character), `\\w on U+${code.toString(16)}`);
  }
});

const PAIRS = [
  [
    String.raw`^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$`,
    String.raw`^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$`,
    ["1.2.3", "0.0.0-qualification", "01.2.3", "1.2", "1.2.3-", "1.2.٣"]
  ],
  [
    String.raw`^VES-[A-Z]{3}-[0-9]{3}$`,
    String.raw`^VES-[A-Z]{3}-\d{3}$`,
    [["VES", "ABC", "001"].join("-"), "VES-ABC-01", "VES-ABC-٠٠١"]
  ],
  [
    String.raw`^VES-[A-Z0-9]{2,8}-[0-9]{3}$`,
    String.raw`^VES-[A-Z0-9]{2,8}-\d{3}$`,
    ["VES-AB12-123", "VES-A-123", "VES-ABCDEFGH-999"]
  ],
  [String.raw`^[0-9]+$`, String.raw`^\d+$`, ["0", "123", "", "1a", "١٢٣"]],
  [String.raw`^[0-9]{1,20}$`, String.raw`^\d{1,20}$`, ["1", "1".repeat(20), "1".repeat(21)]],
  [
    String.raw`^([1-9][0-9]*)\.targets\.json$`,
    String.raw`^([1-9]\d*)\.targets\.json$`,
    ["1.targets.json", "0.targets.json"]
  ],
  [String.raw`^[A-Za-z_][A-Za-z0-9_]*$`, String.raw`^[A-Za-z_]\w*$`, ["PATH", "_x1", "1x", "A-B", "ſ", "K"]]
];

test("each rewritten pattern gives the old verdict on its boundary inputs", () => {
  for (const [old, now, inputs] of PAIRS) {
    for (const input of inputs) {
      assert.equal(new RegExp(now, "u").test(input), new RegExp(old, "u").test(input), `${now} on ${input}`);
    }
  }
});
