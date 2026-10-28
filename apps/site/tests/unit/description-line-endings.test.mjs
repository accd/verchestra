// SonarCloud S7781 (T8): the description extractor normalizes every CRLF with
// replaceAll, so a Windows checkout publishes the same metadata as a POSIX one.
import assert from "node:assert/strict";
import test from "node:test";

import { extractDescription } from "../../src/lib/repository-content.ts";

const lines = [
  "# Portable Handoff",
  "",
  "Transfer delivery work",
  "without transferring machine authority.",
  "",
  "## Details",
  "",
  "More context."
];

test("a CRLF document yields the same description as its LF original", () => {
  const expected = "Transfer delivery work without transferring machine authority.";

  assert.equal(extractDescription(lines.join("\n")), expected);
  assert.equal(extractDescription(lines.join("\r\n")), expected);
});

test("every CRLF is normalized, not only the first", () => {
  const description = extractDescription(lines.join("\r\n"));

  assert.doesNotMatch(description, /\r/u);
  assert.throws(
    () => extractDescription(["# Title", "", "", "## Next"].join("\r\n")),
    /missing a description paragraph/u
  );
});
