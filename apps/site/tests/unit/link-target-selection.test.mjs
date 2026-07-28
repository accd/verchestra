import assert from "node:assert/strict";
import test from "node:test";

import { checkableLinkTarget } from "../../scripts/link-targets.mjs";

const page = new URL("https://accd.github.io/verchestra/docs/");

test("selects the http and https targets the built site publishes", () => {
  assert.equal(checkableLinkTarget("/verchestra/roadmap/", page).href, "https://accd.github.io/verchestra/roadmap/");
  assert.equal(checkableLinkTarget("architecture/", page).href, "https://accd.github.io/verchestra/docs/architecture/");
  assert.equal(checkableLinkTarget("http://example.com/x", page).protocol, "http:");
});

test("skips every other scheme, including ones no deny-list would name", () => {
  for (const value of [
    "#section",
    "data:image/png;base64,AAAA",
    "mailto:security@example.com",
    "tel:+15550100",
    "javascript:alert(1)",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "ftp://example.com/archive",
    "ws://example.com/socket"
  ]) {
    assert.equal(checkableLinkTarget(value, page), null, `${value} must not be selected`);
  }
});

test("resolves scheme-relative targets against the page scheme", () => {
  assert.equal(checkableLinkTarget("//accd.github.io/verchestra/", page).protocol, "https:");
});
