// invariant: S6 of .specs/features/sqlite-probe-worker/checks.md (AC 13 to
// AC 15). The probe quick start walks the journey in the order a tester runs
// it, every `vestra` line it gives is one the release command manifest parses
// as a command, and the site's database pages link it. The command lines are
// read from the guide's `bash` blocks as a shell would split them.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { parseCliArguments } from "../../apps/vestra-cli/src/cli.ts";
import { installedReleaseManifest } from "../../apps/vestra-cli/src/release-manifest.ts";

const GUIDE = new URL("../../docs/probe-quick-start.md", import.meta.url);
const GUIDE_URL = "https://github.com/accd/verchestra/blob/main/docs/probe-quick-start.md";
const SITE_PAGES = [
  "../../apps/site/src/content/docs/docs/workflows/read-only-database-discovery.md",
  "../../apps/site/src/content/docs/docs/integrations/sqlite.md"
];
const JOURNEY = [
  "vestra init",
  "vestra database add",
  "vestra probe worker",
  "git commit",
  "vestra extension add",
  "vestra extension approve",
  "vestra extension check",
  "vestra probe run"
];

// why: the body of every fenced block in the given language, in order.
function codeBlocks(markdown, language) {
  return [...markdown.matchAll(/^```(\w*)\n([\s\S]*?)^```$/gmu)]
    .filter((match) => match[1] === language)
    .map((match) => match[2]);
}

// why: a shell's word splitting, as far as the guide uses it: single and
// double quotes group, a backslash outside quotes escapes the next character.
function words(line) {
  const result = [];
  let word = "";
  let started = false;
  let quote;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      else word += character;
    } else if (character === "'" || character === '"') {
      quote = character;
      started = true;
    } else if (character === "\\") {
      index += 1;
      word += line[index] ?? "";
      started = true;
    } else if (/\s/u.test(character)) {
      if (started) result.push(word);
      word = "";
      started = false;
    } else {
      word += character;
      started = true;
    }
  }
  assert.equal(quote, undefined, `an unterminated quote in: ${line}`);
  if (started) result.push(word);
  return result;
}

// invariant: a command line is a logical line of a `bash` block, with its
// trailing-backslash continuations joined.
function commandLines(markdown) {
  return codeBlocks(markdown, "bash").flatMap((block) =>
    block
      .replace(/\\\n\s*/gu, " ")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
  );
}

function step(argv) {
  if (argv[0] === "git") return `git ${argv[1]}`;
  if (argv[0] !== "vestra") return undefined;
  const parsed = parseCliArguments(argv.slice(1), installedReleaseManifest);
  return parsed.mode === "command" ? `vestra ${parsed.command.name}` : `vestra --${parsed.mode}`;
}

const normalized = (text) => text.replace(/\s+/gu, " ");

test("the probe quick start walks the journey in order", async () => {
  const guide = await readFile(GUIDE, "utf8");
  const lines = commandLines(guide).map(words);
  const steps = lines.map(step);
  const positions = JOURNEY.map((name) => steps.indexOf(name));
  for (const [index, name] of JOURNEY.entries()) assert.ok(positions[index] >= 0, `the guide never runs ${name}`);
  assert.deepEqual(
    [...positions].sort((left, right) => left - right),
    positions,
    `the journey runs out of order: ${JOURNEY.map((name, index) => `${name}@${positions[index]}`).join(", ")}`
  );
  const approve = lines[positions[JOURNEY.indexOf("vestra extension approve")]];
  const environment = approve.flatMap((word, index) => (approve[index - 1] === "--env" ? [word.split("=")[0]] : []));
  assert.deepEqual(environment.sort(), ["PROBE_COMPONENT_ID", "PROBE_SQLITE_PATH"]);
  // why: the guide ends at the envelope the run prints.
  const run = guide.lastIndexOf("vestra probe run --database");
  const envelope = guide.indexOf("## 10. Read the envelope");
  assert.ok(run >= 0 && envelope > run, "the guide reads the envelope after the run");
  const text = normalized(guide);
  for (const statement of [
    "`vestra probe run` runs on Linux and macOS only",
    "SQLite is the only engine",
    "Verchestra delivers no database credential"
  ])
    assert.ok(text.includes(statement), `the guide does not state: ${statement}`);
});

test("every command in the probe quick start is one the release declares", async () => {
  const lines = commandLines(await readFile(GUIDE, "utf8"))
    .map(words)
    .filter((argv) => argv[0] === "vestra");
  assert.ok(lines.length >= JOURNEY.length - 1, `the guide gives only ${lines.length} vestra lines`);
  for (const argv of lines) {
    const label = argv.join(" ");
    let parsed;
    assert.doesNotThrow(() => {
      parsed = parseCliArguments(argv.slice(1), installedReleaseManifest);
    }, label);
    assert.equal(parsed.mode, "command", `${label} is not a command the release declares`);
    const declared = installedReleaseManifest.commands.find((command) => command.name === parsed.command.name);
    const options = argv.filter((word) => word.startsWith("--")).map((word) => word.slice(2));
    for (const option of options)
      assert.ok(
        option === "output" || declared.options.some((entry) => entry.name === option),
        `${label} names --${option}, which ${declared.name} does not declare`
      );
  }
  // why: the scan itself must refuse what the manifest does not declare, or a
  // pass above would prove nothing.
  for (const line of [
    "vestra probe worker --engine sqlite --output-file probe/sqlite-worker.mjs",
    "vestra probe install --engine sqlite",
    "vestra extension approve --approval-ref orders-sqlite --database orders"
  ])
    assert.throws(() => parseCliArguments(words(line).slice(1), installedReleaseManifest), line);
  assert.deepEqual(words(`vestra init --name "My repository" --workspace-id "workspace_$(node -e 'x()')"`), [
    "vestra",
    "init",
    "--name",
    "My repository",
    "--workspace-id",
    "workspace_$(node -e 'x()')"
  ]);
});

test("the site links the probe quick start", async () => {
  for (const page of SITE_PAGES) {
    const markdown = await readFile(new URL(page, import.meta.url), "utf8");
    assert.ok(markdown.includes(`](${GUIDE_URL})`), `${page} does not link the probe quick start`);
  }
});
