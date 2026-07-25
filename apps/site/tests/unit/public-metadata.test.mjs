import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const siteRoot = resolve(import.meta.dirname, "../..");

const pngSize = (bytes) => ({
  width: bytes.readUInt32BE(16),
  height: bytes.readUInt32BE(20)
});

test("publishes deterministic raster brand assets at their declared sizes", async () => {
  const socialCard = await readFile(resolve(siteRoot, "public/social-card.png"));
  const favicon = await readFile(resolve(siteRoot, "public/favicon.png"));
  assert.deepEqual(pngSize(socialCard), { width: 1200, height: 630 });
  assert.deepEqual(pngSize(favicon), { width: 128, height: 128 });
});

test("publishes canonical, Open Graph, X, favicon, and structured metadata", async () => {
  const layout = await readFile(resolve(siteRoot, "src/layouts/ProductLayout.astro"), "utf8");
  const homepage = await readFile(resolve(siteRoot, "src/pages/index.astro"), "utf8");
  const starlightHead = await readFile(resolve(siteRoot, "src/components/StarlightHead.astro"), "utf8");
  for (const contract of [
    'rel="canonical"',
    'property="og:title"',
    'property="og:image"',
    'name="twitter:card"',
    'name="twitter:image"',
    'type="application/ld+json"'
  ]) {
    assert.match(layout, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
  assert.match(homepage, /"@type": "SoftwareSourceCode"/u);
  assert.match(homepage, /GPL-3\.0-only/u);
  assert.match(homepage, /llms\.txt/u);
  assert.match(homepage, /llms-full\.txt/u);
  assert.match(starlightHead, /"@type": "BreadcrumbList"/u);
  assert.match(starlightHead, /Verchestra LLM summary/u);
});

test("publishes production robots and a branded noindex recovery page", async () => {
  const robots = await readFile(resolve(siteRoot, "public/robots.txt"), "utf8");
  const notFound = await readFile(resolve(siteRoot, "src/pages/404.astro"), "utf8");
  assert.match(robots, /https:\/\/accd\.github\.io\/verchestra\/sitemap-index\.xml/u);
  assert.match(robots, /https:\/\/accd\.github\.io\/verchestra\/llms\.txt/u);
  assert.match(robots, /https:\/\/accd\.github\.io\/verchestra\/llms-full\.txt/u);
  assert.match(notFound, /robots="noindex, nofollow"/u);
  assert.match(notFound, /This delivery path does not exist\./u);
});
