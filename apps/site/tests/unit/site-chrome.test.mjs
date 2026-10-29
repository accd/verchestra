import assert from "node:assert/strict";
import test from "node:test";

import { productFooterLinks, productNavigation, withBase } from "../../src/lib/site-chrome.ts";

const base = "/verchestra/";

test("joins paths under the base without doubling the slash", () => {
  assert.equal(withBase(base, "docs/"), "/verchestra/docs/");
  assert.equal(withBase(base, "/docs/"), "/verchestra/docs/");
  assert.equal(withBase(base, ""), "/verchestra/");
});

test("marks the documentation section current on every page below docs/", () => {
  for (const pathname of ["/verchestra/docs/", "/verchestra/docs/community/contributing/"]) {
    assert.deepEqual(
      productNavigation(base, pathname).map(({ label, current }) => [label, current]),
      [
        ["Docs", true],
        ["Roadmap", false],
        ["Community", false]
      ],
      pathname
    );
  }
});

test("marks the roadmap current on the roadmap alone", () => {
  assert.deepEqual(
    productNavigation(base, "/verchestra/roadmap/").map(({ label, current }) => [label, current]),
    [
      ["Docs", false],
      ["Roadmap", true],
      ["Community", false]
    ]
  );
  assert.deepEqual(
    productNavigation(base, "/verchestra/").map(({ current }) => current),
    [false, false, false]
  );
});

test("targets the same product routes as the product layout", () => {
  assert.deepEqual(
    productNavigation(base, "/verchestra/docs/").map(({ href }) => href),
    ["/verchestra/docs/", "/verchestra/roadmap/", "/verchestra/community/"]
  );
  assert.deepEqual(
    productFooterLinks(base).map(({ label, href }) => [label, href]),
    [
      ["Documentation", "/verchestra/docs/"],
      ["Agent guide", "/verchestra/docs/community/contributing-with-agents/"],
      ["LLM summary", "/verchestra/llms.txt"],
      ["Discussions", "https://github.com/accd/verchestra/discussions"],
      ["Issues", "https://github.com/accd/verchestra/issues"]
    ]
  );
});
