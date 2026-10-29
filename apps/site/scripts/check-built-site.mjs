import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, posix, relative, resolve } from "node:path";

import { checkableLinkTarget } from "./link-targets.mjs";

const siteRoot = resolve(import.meta.dirname, "..");
const distRoot = resolve(siteRoot, "dist");
const basePath = "/verchestra/";
const productionOrigin = "https://accd.github.io";

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
};

const files = await walk(distRoot);
const htmlFiles = files.filter((file) => file.endsWith(".html"));
assert.ok(htmlFiles.length >= 119, `Expected at least 119 public pages, found ${htmlFiles.length}`);

const outputPaths = new Set(files.map((file) => relative(distRoot, file).replaceAll("\\", "/")));
const titles = new Map();
const descriptions = new Map();
const brokenLinks = [];
const unsafeOutput = [];

const routeForFile = (file) => {
  const relativePath = relative(distRoot, file).replaceAll("\\", "/");
  if (relativePath === "index.html") return basePath;
  if (relativePath === "404.html") return `${basePath}404.html`;
  return `${basePath}${relativePath.replace(/index\.html$/u, "")}`;
};

const outputForUrl = (url) => {
  const parsed = new URL(url, productionOrigin);
  if (!parsed.pathname.startsWith(basePath)) return null;
  const path = decodeURIComponent(parsed.pathname.slice(basePath.length));
  if (path === "") return "index.html";
  if (path.endsWith("/")) return `${path}index.html`;
  if (extname(path)) return path;
  return `${path}/index.html`;
};

for (const file of htmlFiles) {
  const html = await readFile(file, "utf8");
  const route = routeForFile(file);
  const title = html.match(/<title>(.*?)<\/title>/u)?.[1];
  const description = html.match(/<meta name="description" content="([^"]+)"/u)?.[1];
  assert.ok(title, `${route} is missing a title`);
  assert.ok(description, `${route} is missing a description`);
  if (route !== `${basePath}404.html`) {
    assert.ok(!titles.has(title), `${route} duplicates title from ${titles.get(title)}`);
    assert.ok(!descriptions.has(description), `${route} duplicates description from ${descriptions.get(description)}`);
  }
  titles.set(title, route);
  descriptions.set(description, route);
  // Starlight renders the title as the h1, so a projected Markdown page that
  // kept its own h1 rendered two; every page has exactly one.
  assert.equal((html.match(/<h1[\s>]/gu) ?? []).length, 1, `${route} must render exactly one h1`);

  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/u)?.[1];
  assert.ok(canonical?.startsWith(`${productionOrigin}${basePath}`), `${route} has an invalid canonical URL`);
  assert.match(html, /<meta property="og:image" content="https:\/\/accd\.github\.io\/verchestra\/social-card\.png"/u);
  assert.match(html, /<meta name="twitter:(?:card|image)"/u);
  if (route === `${basePath}roadmap/` || route.startsWith(`${basePath}docs/`)) {
    const alternate = html.match(/<link rel="alternate" type="text\/markdown" href="([^"]+)"/u)?.[1];
    assert.equal(alternate, `${productionOrigin}${route}index.html.md`, `${route} has an invalid Markdown alternate`);
  }

  if (/C:\\Users\\|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY|ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}/u.test(html)) {
    unsafeOutput.push(route);
  }

  for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/gu)) {
    const target = checkableLinkTarget(match[1], new URL(route, productionOrigin));
    if (target === null) continue;
    if (target.origin !== productionOrigin) continue;
    if (!target.pathname.startsWith(basePath)) {
      brokenLinks.push(`${route} → ${target.pathname} (outside base path)`);
      continue;
    }
    const output = outputForUrl(target);
    if (output && !outputPaths.has(output)) brokenLinks.push(`${route} → ${target.pathname}`);
  }
}

assert.deepEqual(unsafeOutput, [], `Unsafe machine-local or credential material found in: ${unsafeOutput.join(", ")}`);
assert.deepEqual(brokenLinks, [], `Broken internal links:\n${brokenLinks.join("\n")}`);

for (const required of [
  "index.html",
  "community/index.html",
  "roadmap/index.html",
  "404.html",
  "docs/index.html",
  "docs/workflows/feature-delivery/index.html",
  "docs/integrations/sap-ase-sybase/index.html",
  "docs/qualification/t68-validation/index.html",
  "robots.txt",
  "sitemap-index.xml",
  "pagefind/pagefind.js",
  "llms.txt",
  "llms-full.txt"
]) {
  assert.ok(outputPaths.has(required), `Missing required output: ${required}`);
}

const llms = await readFile(join(distRoot, "llms.txt"), "utf8");
const llmsFull = await readFile(join(distRoot, "llms-full.txt"), "utf8");
const sitemap = await readFile(join(distRoot, "sitemap-0.xml"), "utf8");
assert.match(llms, /0\.0\.0-qualification/u);
assert.match(llms, /T77 complete; the declared chain is fully verified/u);
assert.match(llms, /inference-time documentation aid/u);
assert.ok(Buffer.byteLength(llmsFull) < 1024 * 1024);
assert.match(llmsFull, /docs\/qualification\/t68-validation\.md/u);
assert.match(llmsFull, /Content digest: `sha256:[0-9a-f]{64}`/u);
assert.doesNotMatch(llmsFull, /C:\\Users\\|\/home\/[^/\s]+\//u);
assert.match(sitemap, /https:\/\/accd\.github\.io\/verchestra\/llms\.txt/u);
assert.match(sitemap, /https:\/\/accd\.github\.io\/verchestra\/llms-full\.txt/u);

for (const file of htmlFiles) {
  const route = routeForFile(file);
  if (route === `${basePath}roadmap/` || route.startsWith(`${basePath}docs/`)) {
    const alternatePath = `${relative(distRoot, file)
      .replaceAll("\\", "/")
      .replace(/index\.html$/u, "")}index.html.md`;
    assert.ok(outputPaths.has(alternatePath), `Missing Markdown alternate: ${alternatePath}`);
  }
}

const proofPage = await readFile(join(distRoot, "docs", "proof", "execution-package", "index.html"), "utf8");
assert.match(proofPage, /Fixture-generated, not a live run/u);
assert.match(proofPage, /proof:generate/u);
assert.match(proofPage, /artifactId/u);

const homepage = await readFile(join(distRoot, "index.html"), "utf8");
assert.match(homepage, /0\.0\.0-qualification/u);
assert.match(homepage, /T77 verified/u);
// The evidence link derives from the typed status, so a report that advances
// the counter cannot leave the public CTA pointing at an older milestone. The
// script cannot import TypeScript, so the typed status is read as source; the
// contract test asserts the same object structurally.
const productSource = await readFile(join(siteRoot, "src", "data", "product.ts"), "utf8");
const completedTask = /completedTask: "(T\d+[a-z]?)"/u.exec(productSource)?.[1];
assert.ok(completedTask, "product.ts must declare completedTask");
assert.match(homepage, new RegExp(`docs/qualification/${completedTask.toLowerCase()}-validation/`, "u"));
assert.match(homepage, new RegExp(`Inspect ${completedTask} evidence`, "u"));
// The built homepage must render the capability matrix and the exclusion list;
// a section that silently fails to render is a truth surface that vanished.
assert.match(homepage, /What works today/u);
assert.match(homepage, /Workspace initialization \(init preview and apply\)/u);
assert.match(homepage, /What Verchestra is not/u);
assert.match(homepage, /Install the beta build/u);
// The 1.0 decision is a signed hold on disk; a homepage that calls it pending
// or unmade contradicts the repository's own signed record.
assert.match(homepage, /1\.0 decision: signed hold/u);
assert.doesNotMatch(homepage, /1\.0 decision pending|has not been made/u);
assert.doesNotMatch(homepage, /npm (?:install|add).{0,40}verchestra/iu);
assert.doesNotMatch(homepage, /production[- ]ready/iu);
// The install block names the build the TUF publication ledger recorded last;
// a homepage that pins any other version advertises a build nobody would get.
const ledger = JSON.parse(
  await readFile(resolve(siteRoot, "../../docs/qualification/tuf-publication-ledger.json"), "utf8")
);
const ledgerLatest = ledger.entries
  .filter((entry) => entry.kind === "release")
  .reduce((best, entry) => (entry.sequence > best.sequence ? entry : best)).semanticVersion;
assert.ok(ledgerLatest, "the publication ledger must record a release");
assert.ok(homepage.includes(`npx verchestra@${ledgerLatest} --version`), `homepage must install ${ledgerLatest}`);
for (const pinned of homepage.matchAll(/npx verchestra@(\S+?)(?=[\s<])/gu)) {
  assert.equal(pinned[1], ledgerLatest, `homepage pins ${pinned[1]} instead of the ledger's ${ledgerLatest}`);
}
// Both diagrams are real drawings with a text equivalent, and the hero shows
// the delivery stages twice on purpose: as the drawing and as the list the
// narrow layout shows instead.
assert.equal((homepage.match(/class="diagram diagram--[a-z]+" role="img"/gu) ?? []).length, 2);
assert.match(homepage, /<title id="delivery-flow-diagram-title">/u);
assert.match(homepage, /<title id="architecture-diagram-title">/u);
assert.match(homepage, /Independent verification/u);
assert.match(homepage, /What travels\. What stays\./u);
assert.match(homepage, /public reports, one maturity each\./u);
assert.match(homepage, /Read the signed 1\.0 hold/u);

// The evidence sidebar group is labelled with the first and the last report that
// exist, so its range cannot fall behind an inserted or appended report.
const reportIds = (await readdir(resolve(siteRoot, "../../docs/qualification")))
  .map((entry) => /^(t\d+[a-z]?)-validation\.md$/iu.exec(entry)?.[1])
  .filter(Boolean)
  .sort()
  .map((id) => id.toUpperCase());
assert.ok(reportIds.length > 1, "docs/qualification must hold more than one report");
const docsIndex = await readFile(join(distRoot, "docs", "index.html"), "utf8");
assert.match(docsIndex, new RegExp(`${reportIds[0]}–${reportIds.at(-1)} evidence`, "u"));

const assetUrls = new Set(
  [...homepage.matchAll(/\b(?:href|src)="([^"]+)"/gu)]
    .map((match) => outputForUrl(match[1]))
    .filter((path) => path && !path.endsWith(".html") && path !== "social-card.png")
);
let compressedTransfer = gzipSync(homepage).byteLength;
let compressedJavaScript = 0;
for (const assetPath of assetUrls) {
  const file = join(distRoot, ...assetPath.split(posix.sep));
  const info = await stat(file);
  assert.ok(info.isFile(), `Homepage asset is missing: ${assetPath}`);
  const compressed = gzipSync(await readFile(file)).byteLength;
  compressedTransfer += compressed;
  if (assetPath.endsWith(".js")) compressedJavaScript += compressed;
}

assert.ok(compressedJavaScript < 75 * 1024, `Homepage JavaScript is ${compressedJavaScript} compressed bytes`);
assert.ok(compressedTransfer < 500 * 1024, `Homepage transfer is ${compressedTransfer} compressed bytes`);

console.log(
  JSON.stringify({
    pages: htmlFiles.length,
    compressedJavaScript,
    compressedTransfer,
    internalLinks: "valid",
    metadata: "valid"
  })
);
