import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

// why: SonarCloud's GitHub Actions rules (S131, S7679) read the inline shell of
// every workflow. These tests hold the two shapes it asks for, so a new script
// cannot bring the issues back unnoticed.

const WORKFLOWS = new URL("../../.github/workflows/", import.meta.url);
const workflows = readdirSync(WORKFLOWS)
  .filter((name) => /\.ya?ml$/u.test(name))
  .map((name) => ({ name, text: readFileSync(new URL(name, WORKFLOWS), "utf8") }));

// Every `case … in` up to its `esac`, nested ones included.
function caseBlocks(text) {
  const blocks = [];
  const open = [];
  for (const line of text.split(/\r?\n/u)) {
    if (/^\s*case\s.+\sin\s*$/u.test(line)) open.push([line]);
    for (const block of open) if (block.at(-1) !== line) block.push(line);
    if (/^\s*esac\b/u.test(line)) blocks.push(open.pop().join("\n"));
  }
  assert.equal(open.length, 0, "every case is closed by an esac");
  return blocks;
}

test("every shell case in a workflow has a default arm", () => {
  let seen = 0;
  for (const { name, text } of workflows) {
    for (const block of caseBlocks(text)) {
      seen += 1;
      assert.match(block, /^\s*\*\)/mu, `${name}: case without a default arm:\n${block}`);
    }
  }
  assert.ok(seen >= 3, "the scan found the workflows' case statements");
});

test("the live matrix's pointer helpers name the phase they are given", () => {
  const live = workflows.find(({ name }) => name === "live-activation-matrix.yml").text;
  for (const helper of ["record_pointer", "pointer_of"]) {
    const body = new RegExp(`${helper}\\(\\) \\{\\r?\\n([\\s\\S]*?)\\r?\\n\\s*\\}`, "u").exec(live);
    assert.ok(body, `${helper} is defined as a block`);
    assert.match(body[1], /^\s*local phase="\$1"$/mu, `${helper} binds its argument to a named local`);
    assert.doesNotMatch(body[1].replace(/local phase="\$1"/u, ""), /\$1\b/u, `${helper} reads $1 only once`);
  }
});
