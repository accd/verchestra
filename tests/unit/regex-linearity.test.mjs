import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { withoutLeadingTitle } from "../../apps/site/src/lib/llm-content.ts";
import {
  extractTitle,
  repositoryContentSources,
  rewriteCanonicalLinks,
  roadmapEdges,
  withoutMarkdownLinks
} from "../../apps/site/src/lib/repository-content.ts";
import { isSensitiveClaimValue } from "../../packages/data-probe/src/database-knowledge.ts";
import { containsWriteKeyword } from "../../packages/data-probe/src/postgresql-adapter.ts";
import { hasUserinfoBeforeColon } from "../../packages/distribution/src/tuf-update-client.ts";
import { systemRoot } from "../../packages/platform-node/src/os-secret-backends/windows-credential-manager.ts";
import { normalizedRepositoryPath } from "../../packages/workspace/src/scanner/scanner-primitives.ts";
import { frontmatterField, markdownLinkTargets, parseRoadmapChain } from "../../scripts/agent-readiness.mjs";
import { importSpecifiers } from "../../scripts/build-vestra-launcher.mjs";
import { importsCanonicalizeJsonV2, signalsFor } from "../../scripts/canonical-json-census.mjs";
import { selectGates } from "../../scripts/gate-selection.mjs";
import { GROWTH_SCALE, LINEAR_GROWTH_LIMIT, growth } from "../helpers/linear-growth.mjs";

// T6/T7 of .specs/features/sonarcloud-quality: every regular expression
// SonarCloud flagged for super-linear backtracking (S8786) or complexity
// (S5843) was rewritten. Each rewrite is held here to two things: it answers
// exactly as the expression it replaced -- kept below as text, the reference
// oracle -- over an exhaustive small-alphabet corpus or the repository's own
// files, and its cost grows linearly on the input that made the old one
// backtrack (TST-005: judged by a growth ratio, never a wall-clock bound).

const root = fileURLToPath(new URL("../..", import.meta.url));
const legacy = (source, flags) => new RegExp(source, flags);

function* strings(alphabet, maxLength) {
  let layer = [""];
  yield "";
  for (let length = 1; length <= maxLength; length += 1) {
    layer = layer.flatMap((prefix) => alphabet.map((character) => prefix + character));
    yield* layer;
  }
}

async function repositoryFiles(directories, extension) {
  const files = [];
  for (const directory of directories) {
    for (const entry of await readdir(join(root, directory), { recursive: true, withFileTypes: true })) {
      const path = posix.join(entry.parentPath.replaceAll("\\", "/"), entry.name);
      if (entry.isFile() && path.endsWith(extension) && !/\/(?:node_modules|dist|\.astro)\//u.test(path))
        files.push(path);
    }
  }
  return files;
}

function assertLinear(label, run, make, options) {
  const ratio = growth(run, make, options);
  assert.ok(
    ratio < LINEAR_GROWTH_LIMIT,
    `${label}: a ${GROWTH_SCALE}x larger input took ${ratio.toFixed(1)}x as long; it is no longer linear`
  );
}

test(
  "markdown link targets answer exactly as the replaced expression and stay linear",
  { timeout: 60_000 },
  async () => {
    const old = legacy(String.raw`\[[^\]]+\]\(([^)]+)\)`, "gu");
    const oracle = (source) => [...source.matchAll(old)].map((match) => match[1]);
    for (const source of strings(["[", "]", "(", ")", "a"], 7))
      assert.deepEqual(markdownLinkTargets(source), oracle(source), JSON.stringify(source));
    for (const path of await repositoryFiles(["docs", ".specs"], ".md")) {
      const source = await readFile(path, "utf8");
      assert.deepEqual(markdownLinkTargets(source), oracle(source), path);
    }
    assertLinear("markdownLinkTargets", markdownLinkTargets, (size) => "[".repeat(size));
  }
);

test("site description links are stripped exactly as before and stay linear", { timeout: 60_000 }, () => {
  const old = legacy(String.raw`\[([^\]]+)\]\([^)]+\)`, "g");
  for (const text of strings(["[", "]", "(", ")", "a"], 7))
    assert.equal(withoutMarkdownLinks(text), text.replace(old, "$1"), JSON.stringify(text));
  assertLinear("withoutMarkdownLinks", withoutMarkdownLinks, (size) => "[".repeat(size));
});

test("frontmatter fields parse exactly as before and stay linear", { timeout: 60_000 }, () => {
  const old = legacy(String.raw`^([A-Za-z][A-Za-z0-9]*):\s*(.*)$`, "u");
  for (const line of strings(["a", "1", ":", " ", "\r", "\u2028"], 6)) {
    const match = old.exec(line);
    assert.deepEqual(frontmatterField(line), match ? [match[1], match[2]] : undefined, JSON.stringify(line));
  }
  assertLinear("frontmatterField", frontmatterField, (size) => `a:${" ".repeat(size)}\rx\r`);
});

// The one intended difference: the old label class `[^\]]*` also matched a
// newline, so a label could swallow the following line and join two lines into
// one edge -- the multi-line rescan that made it backtrack. Edges are one per
// line now; the oracle keeps every other part of the old expression.
test("roadmap edges parse as before in both readers and stay linear", { timeout: 60_000 }, async () => {
  const fullRoadmap = legacy(
    String.raw`^[^\S\n]*(T\d+[a-z]?)(?:\[[^\]]*\])?[^\S\n]*-->[^\S\n]*(T\d+[a-z]?)(?:\[[^\]]*\])?[^\S\n]*$`,
    "gmu"
  );
  const old = legacy(
    String.raw`^[^\S\n]*(T\d+[a-z]?)(?:\[[^\]\n]*\])?[^\S\n]*-->[^\S\n]*(T\d+[a-z]?)(?:\[[^\]\n]*\])?[^\S\n]*$`,
    "gmu"
  );
  const oracle = (roadmap) => [...roadmap.matchAll(old)].map((match) => [match[1], match[2]]);
  const roadmapSource = await readFile(join(root, "ROADMAP.md"), "utf8");
  assert.deepEqual(
    parseRoadmapChain(roadmapSource),
    [...roadmapSource.matchAll(fullRoadmap)].map((match) => [match[1], match[2]]),
    "ROADMAP.md must parse exactly as under the old expression"
  );
  assert.deepEqual(parseRoadmapChain("T1[x --> T2\nT1 [a] --> T2\n"), []);
  const lines = [
    "T1 --> T2",
    "  T1[a] --> T2[b label]  ",
    "T1-->T2",
    "T1 [a] --> T2",
    "T1 --> T2 --> T3",
    "%% T1 --> T2",
    "T68a --> T68b",
    "T1 --> T2\r",
    "T1[x --> T2",
    "T1[] --> T2[]",
    "t1 --> T2",
    "T1 --> T2 x",
    "\tT9 --> T10\t",
    "flowchart LR",
    ""
  ];
  const roadmaps = [roadmapSource];
  for (const first of lines) for (const second of lines) roadmaps.push(`${first}\n${second}\n`);
  for (const roadmap of roadmaps) {
    assert.deepEqual(parseRoadmapChain(roadmap), oracle(roadmap), JSON.stringify(roadmap));
    assert.deepEqual(roadmapEdges(roadmap), oracle(roadmap), JSON.stringify(roadmap));
  }
  assertLinear("parseRoadmapChain", parseRoadmapChain, (size) => "T1[\n".repeat(size));
  assertLinear("roadmapEdges", roadmapEdges, (size) => "T1[\n".repeat(size));
});

test("the LLM alternate drops the same title on every published document and stays linear", async () => {
  const old = legacy(String.raw`^#\s+.+\n+`, "u");
  const sources = await repositoryFiles(["docs"], ".md");
  for (const path of [...sources, join(root, "README.md")]) {
    const markdown = (await readFile(path, "utf8")).replaceAll("\r\n", "\n");
    assert.equal(withoutLeadingTitle(markdown), markdown.replace(old, ""), path);
  }
  assert.equal(withoutLeadingTitle("# Title\n\nBody\n"), "Body\n");
  assert.equal(withoutLeadingTitle("Body\n# Not first\n"), "Body\n# Not first\n");
  assertLinear("withoutLeadingTitle", withoutLeadingTitle, (size) => `#${" ".repeat(size)}x`);
});

test("site titles are extracted as before from every canonical source and stay linear", async () => {
  const old = legacy(String.raw`^#\s+(.+?)\s*$`, "m");
  const oracle = (markdown) => markdown.match(old)?.[1]?.trim();
  const paths = [
    ...repositoryContentSources.map((source) => join(root, source.sourcePath)),
    ...(await repositoryFiles(["docs/qualification"], ".md"))
  ];
  for (const path of paths) {
    const markdown = await readFile(path, "utf8");
    assert.equal(extractTitle(markdown), oracle(markdown), path);
  }
  assertLinear(
    "extractTitle",
    (markdown) => extractTitle(markdown),
    (size) => `# a${" ".repeat(size)}b`
  );
});

test("canonical links keep their fragment, bare anchors stay in page, and the rewrite stays linear", () => {
  const sources = [
    { sourcePath: "CONTRIBUTING.md", route: "docs/community/contributing" },
    { sourcePath: "CODE_OF_CONDUCT.md", route: "docs/community/code-of-conduct" }
  ];
  const rewrite = (markdown) => rewriteCanonicalLinks(markdown, sources[0], sources, "/verchestra");
  assert.equal(
    rewrite("[scope](CODE_OF_CONDUCT.md#scope) [top](#top) [lic](LICENSE#l1)"),
    "[scope](/verchestra/docs/community/code-of-conduct/#scope) [top](#top) [lic](https://github.com/accd/verchestra/blob/main/LICENSE#l1)"
  );
  assertLinear("rewriteCanonicalLinks", rewrite, (size) => `](${"a#".repeat(size)}`);
});

// The fragment fix changes no published page: on every site source the rewrite
// answers as the former expression did (the former callback, kept here, is the
// oracle), because no source links to a fragment of another source.
test("canonical link rewriting is unchanged on every published site source", async () => {
  const old = legacy(String.raw`(?<!!)\]\((?![#a-z]+:|\/\/)([^)\s]+)(#[^)\s]+)?\)`, "giu");
  const qualification = (await readdir(join(root, "docs/qualification")))
    .filter((entry) => entry.endsWith(".md"))
    .map((entry) => ({ sourcePath: `docs/qualification/${entry}`, route: `docs/qualification/${entry.slice(0, -3)}` }));
  const sources = [...repositoryContentSources, ...qualification];
  const oracle = (markdown, source) =>
    markdown.replace(old, (_match, target, fragment = "") => {
      const sourcePath = posix.normalize(posix.join(posix.dirname(source.sourcePath), target));
      const siteTarget = sources.find((candidate) => candidate.sourcePath === sourcePath);
      if (siteTarget) return `](/verchestra/${siteTarget.route}/${fragment})`.replaceAll("//", "/");
      return `](https://github.com/accd/verchestra/blob/main/${sourcePath}${fragment})`;
    });
  for (const source of sources) {
    const markdown = await readFile(join(root, source.sourcePath), "utf8");
    assert.equal(
      rewriteCanonicalLinks(markdown, source, sources, "/verchestra"),
      oracle(markdown, source),
      source.sourcePath
    );
  }
});

test("bundle import specifiers are found as before and the scan stays linear", { timeout: 60_000 }, () => {
  const old = legacy(String.raw`(?:^|[\s;}])import\s*(?:[^"';]*?from\s*)?["']([^"']+)["']`, "gu");
  const oracle = (source) => [...source.matchAll(old)].map((match) => match[1]);
  const statements = [
    'import "node:fs";',
    'import x from "node:fs"',
    "import {a, b} from 'node:path';",
    'import*as x from"y"',
    '}import "a"',
    'import from "q"',
    'importx from "y"',
    'x.import("y")',
    'import x from "a" from "b"',
    "import { from } from 'c'",
    "const s = 'import y'",
    "import\n  x\nfrom\n'z'"
  ];
  for (const first of statements)
    for (const second of statements)
      for (const separator of ["\n", ";", " ", ""]) {
        const source = `${first}${separator}${second}`;
        assert.deepEqual(importSpecifiers(source), oracle(source), JSON.stringify(source));
      }
  assertLinear("importSpecifiers", importSpecifiers, (size) => `import${" ".repeat(size)}x`);
});

test("census signals and the V2 import check answer as before on every source and stay linear", async () => {
  const oldImport = legacy(String.raw`^\s*import\s*\{[^}]*\bcanonicalizeJsonV2\b[^}]*\}\s*from\s*["'][^"']+["']`, "mu");
  const oldCanonicalizer = legacy(
    String.raw`canonicalizeJson|(?:async\s+)?function\s+canonicalize[A-Za-z0-9]*|(?:const|let)\s+canonicalize[A-Za-z0-9]*\s*=|canonicalJson|canonical\(`,
    "gu"
  );
  const files = [
    ...(await repositoryFiles(["packages", "apps", "scripts", "tests"], ".ts")),
    ...(await repositoryFiles(["packages", "apps", "scripts", "tests"], ".mjs"))
  ];
  let importing = 0;
  for (const path of files) {
    const source = await readFile(path, "utf8");
    assert.equal(importsCanonicalizeJsonV2(source), oldImport.test(source), path);
    assert.equal(signalsFor(source).canonicalizer, [...source.matchAll(oldCanonicalizer)].length, path);
    if (importsCanonicalizeJsonV2(source)) importing += 1;
  }
  assert.ok(importing > 0, "the corpus must exercise the positive case");
  for (const source of [
    "async function canonicalizeJsonX() {}",
    "async  function canonicalize(x)",
    "let canonicalizeA = canonicalJson; canonical(",
    'import {\n  a,\n  canonicalizeJsonV2\n} from "x";',
    '// import { canonicalizeJsonV2 } from "x"',
    'x import {\nimport { canonicalizeJsonV2 } from "y"',
    'import {\nimport { canonicalizeJsonV2 } from "y"',
    '\r\r import { canonicalizeJsonV2 } from "z"',
    '\uFEFFimport { canonicalizeJsonV2 } from "z"',
    '\n\n  import { canonicalizeJsonV2 as c } from "@verchestra/domain";'
  ]) {
    assert.equal(importsCanonicalizeJsonV2(source), oldImport.test(source), source);
    assert.equal(signalsFor(source).canonicalizer, [...source.matchAll(oldCanonicalizer)].length, source);
  }
  assertLinear("importsCanonicalizeJsonV2", importsCanonicalizeJsonV2, (size) => " \n".repeat(size));
  assertLinear("importsCanonicalizeJsonV2", importsCanonicalizeJsonV2, (size) => `${"\r".repeat(size)}x`);
  assertLinear("signalsFor", signalsFor, (size) => "async function ".repeat(size));
});

test("documentation gate selection answers as before and stays linear", () => {
  const old = legacy(
    String.raw`^(?:docs\/|\.specs\/|spikes\/|scripts\/|tests\/agent-readiness\/|tests\/agent-eval\/|\.github\/(?!workflows\/)|[^/]+\.(?:md|txt|json|yaml|yml)$|\.[^/]+$)`,
    "u"
  );
  for (const path of [
    "tests/agent-readiness/x.mjs",
    "tests/agent-eval/x.mjs",
    "tests/agent-other/x.mjs",
    "a.yaml",
    "a.yml",
    "a.ymml",
    "dir/a.yml",
    ".github/CODEOWNERS",
    ".github/workflows/ci.yml",
    ".editorconfig"
  ]) {
    const gates = selectGates([path]).gates;
    assert.equal(gates.length === 1 && gates[0] === "gate:quick", old.test(path), path);
  }
  assertLinear(
    "selectGates",
    (path) => selectGates([path]),
    (size) => `${"a".repeat(size)}.md`
  );
});

test("PostgreSQL write keywords match exactly the whole words the alternation did, linearly", () => {
  const old = legacy(
    String.raw`\b(?:ALTER|ANALYZE|CALL|CLUSTER|COMMENT|COPY|CREATE|DELETE|DO|DROP|GRANT|INSERT|LISTEN|LOAD|LOCK|MERGE|NOTIFY|REFRESH|REINDEX|REVOKE|SECURITY|SET|TRUNCATE|UNLISTEN|UPDATE|VACUUM)\b`,
    "iu"
  );
  const words = ["set", "SET", "Set", "_set", "set_", "1set", "reset", "sets", "do", "undo", "DO2", "select", "Vacuum"];
  for (const word of words)
    for (const separator of [" ", "(", ".", "\n", ""]) {
      const sql = `SELECT a${separator}${word}${separator}b`;
      assert.equal(containsWriteKeyword(sql), old.test(sql), sql);
    }
  assertLinear("containsWriteKeyword", containsWriteKeyword, (size) => "a ".repeat(size));
});

test("sensitive claim values are the union the single alternation tested, linearly", () => {
  const old = legacy(
    String.raw`(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:password|credential|secret|token|api[_-]?key)\b\s*[=:]|\bbearer\s+[a-z0-9._-]+|\b(?:gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|sk-[a-z0-9_-]{20,}|xox[baprs]-[a-z0-9-]{10,}|akia[a-z0-9]{16}|eyj[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,})\b|\b(?:postgres(?:ql)?|mysql|mongodb|mariadb|sqlserver|oracle):\/\/|:\/\/[^\s/]+@)`,
    "iu"
  );
  const token = "a1".repeat(12);
  const values = [
    "-----BEGIN RSA PRIVATE KEY-----",
    "-----BEGIN PUBLIC KEY-----",
    "password = x",
    "passwords: x",
    "API-KEY: x",
    "api_key=x",
    "Bearer abc.def",
    "bearer",
    `ghp_${token}`,
    `ghp_${token.slice(0, 18)}`,
    `github_pat_${token}`,
    `sk-${token}`,
    `xoxb-${token}`,
    "AKIA0123456789ABCDEF",
    "AKIA0123456789ABCDEFG",
    "eyJabcdefgh.abcdefgh.abcdefgh",
    "eyJabc.abcdefgh.abcdefgh",
    "postgresql://host",
    "mongodb:/host",
    "https://user@host",
    "https://host/a@b",
    "plain value",
    `x${`ghp_${token}`}`,
    `ghp_${token}_`
  ];
  for (const value of values) assert.equal(isSensitiveClaimValue(value), old.test(value), value);
  assertLinear("isSensitiveClaimValue", isSensitiveClaimValue, (size) => "token ".repeat(size));
});

test("distribution source userinfo is detected exactly as before and stays linear", { timeout: 60_000 }, () => {
  const old = legacy("@[^:]+:", "u");
  for (const sourceId of strings(["@", ":", "a"], 10))
    assert.equal(hasUserinfoBeforeColon(sourceId), old.test(sourceId), JSON.stringify(sourceId));
  assertLinear("hasUserinfoBeforeColon", hasUserinfoBeforeColon, (size) => "@".repeat(size));
});

test("the Windows system root loses its trailing backslashes exactly as before, linearly", () => {
  const original = process.env.SystemRoot;
  const resolve = (value) => {
    process.env.SystemRoot = value;
    return systemRoot();
  };
  try {
    for (const value of ["C:\\Windows", "C:\\Windows\\", "C:\\Windows\\\\\\", "C:\\", "C:\\a\\\\b\\", "relative", ""])
      assert.equal(
        resolve(value),
        /^[A-Za-z]:\\[A-Za-z0-9 ._()\\-]*$/u.test(value)
          ? value.replace(legacy(String.raw`\\+$`, "u"), "")
          : "C:\\Windows",
        JSON.stringify(value)
      );
    assertLinear("systemRoot", resolve, (size) => `C:\\${"\\".repeat(size)}a`);
  } finally {
    if (original === undefined) delete process.env.SystemRoot;
    else process.env.SystemRoot = original;
  }
});

test("repository paths lose trailing slashes exactly as before, linearly", { timeout: 60_000 }, () => {
  const oracle = (pathname) => {
    const decoded = decodeURIComponent(pathname)
      .replaceAll("\\", "/")
      .replace(legacy("/+$", "u"), "")
      .replace(/\.git$/u, "");
    if (decoded.length === 0 || decoded === "/") return "invalid";
    return decoded.startsWith("/") ? decoded : `/${decoded}`;
  };
  const attempt = (pathname) => {
    try {
      return normalizedRepositoryPath(pathname);
    } catch {
      return "invalid";
    }
  };
  for (const pathname of strings(["/", "\\", "a", ".git"], 5))
    assert.equal(attempt(pathname), oracle(pathname), JSON.stringify(pathname));
  assertLinear("normalizedRepositoryPath", attempt, (size) => `a${"/".repeat(size)}b`);
});
