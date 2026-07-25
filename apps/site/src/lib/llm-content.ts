import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { llmRepositorySources, llmSiteGuideRoot } from "../data/llm-content-manifest.ts";
import {
  compileQualificationStatus,
  extractDescription,
  extractTitle,
  resolveRepositoryPath,
  type QualificationStatus
} from "./repository-content.ts";

const ORIGIN = "https://accd.github.io/verchestra";
const MAXIMUM_BYTES = 1024 * 1024;
const SECTION_ORDER = [
  "Project",
  "Agent instructions",
  "Architecture",
  "Workflows",
  "Concepts",
  "Integrations",
  "Community",
  "Qualification",
  "Active feature"
];

export interface LlmDocument {
  sourcePath: string;
  sourceUrl: string;
  route: string | null;
  title: string;
  description: string;
  section: string;
  order: number;
  digest: string;
  markdown: string;
}

function digest(content: string) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function normalize(content: string) {
  return `${content.replaceAll("\r\n", "\n").trim()}\n`;
}

function parseFrontmatter(content: string) {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/u.exec(content.replaceAll("\r\n", "\n"));
  if (!match) return null;
  const header = match[1] ?? "";
  const body = match[2] ?? "";
  const value = (name: string) => {
    const field = new RegExp(`^${name}:\\s*(.+)$`, "mu").exec(header)?.[1]?.trim();
    return field?.replace(/^(['"])(.*)\1$/u, "$2") ?? null;
  };
  return { title: value("title"), description: value("description"), body };
}

export function validateLlmHeadings(markdown: string, sourcePath: string, hasSyntheticTitle: boolean) {
  const levels = [...markdown.matchAll(/^(#{1,6})\s+\S.+$/gmu)].map((match) => match[1]?.length ?? 0);
  let previous = hasSyntheticTitle ? 1 : levels.shift();
  if (!previous) throw new Error(`${sourcePath}: malformed headings`);
  for (const level of levels) {
    if (level > previous + 1) throw new Error(`${sourcePath}: malformed heading jump`);
    previous = level;
  }
}

async function filesBelow(directory: string): Promise<string[]> {
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name, "en")
  )) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(path)));
    else if (new Set([".md", ".mdx"]).has(extname(entry.name))) files.push(path);
  }
  return files;
}

function guideRoute(relativePath: string) {
  const withoutExtension = relativePath.replace(/\.(?:md|mdx)$/u, "");
  if (withoutExtension === "index") return "";
  return posix.basename(withoutExtension) === "index" ? posix.dirname(withoutExtension) : withoutExtension;
}

function guideSection(route: string) {
  const first = route.split("/")[0] ?? "";
  return (
    {
      workflows: "Workflows",
      concepts: "Concepts",
      integrations: "Integrations",
      architecture: "Architecture",
      qualification: "Qualification"
    }[first] ?? "Project"
  );
}

function sourceUrl(sourcePath: string) {
  return `https://github.com/accd/verchestra/blob/main/${sourcePath}`;
}

export async function collectLlmDocuments(repositoryRoot: URL | string): Promise<LlmDocument[]> {
  const root = typeof repositoryRoot === "string" ? repositoryRoot : fileURLToPath(repositoryRoot);
  const documents: LlmDocument[] = [];
  for (const source of llmRepositorySources) {
    const content = normalize(await readFile(resolveRepositoryPath(root, source.sourcePath), "utf8"));
    const frontmatter = parseFrontmatter(content);
    const markdown = normalize(frontmatter?.body ?? content);
    const title = frontmatter?.title ?? extractTitle(markdown);
    const description = frontmatter?.description ?? extractDescription(markdown);
    validateLlmHeadings(markdown, source.sourcePath, frontmatter !== null);
    documents.push({
      ...source,
      sourceUrl: sourceUrl(source.sourcePath),
      title,
      description,
      digest: digest(markdown),
      markdown
    });
  }

  const qualificationDirectory = resolveRepositoryPath(root, "docs/qualification");
  for (const entry of (await readdir(qualificationDirectory))
    .filter((name) => /^t\d{2}-validation\.md$/u.test(name))
    .sort()) {
    const sourcePath = `docs/qualification/${entry}`;
    const markdown = normalize(await readFile(resolveRepositoryPath(root, sourcePath), "utf8"));
    validateLlmHeadings(markdown, sourcePath, false);
    const task = Number(/^t(\d{2})/u.exec(entry)?.[1]);
    documents.push({
      sourcePath,
      sourceUrl: sourceUrl(sourcePath),
      route: `docs/qualification/${entry.replace(/\.md$/u, "")}`,
      title: extractTitle(markdown),
      description: extractDescription(markdown),
      section: "Qualification",
      order: task,
      digest: digest(markdown),
      markdown
    });
  }

  const guideRoot = resolveRepositoryPath(root, llmSiteGuideRoot);
  for (const path of await filesBelow(guideRoot)) {
    const sourcePath = relative(root, path).replaceAll("\\", "/");
    const relativePath = relative(guideRoot, path).replaceAll("\\", "/");
    const route = guideRoute(relativePath);
    const content = normalize(await readFile(path, "utf8"));
    const frontmatter = parseFrontmatter(content);
    if (!frontmatter?.title || !frontmatter.description) throw new Error(`${sourcePath}: missing guide metadata`);
    const markdown = normalize(frontmatter.body);
    validateLlmHeadings(markdown, sourcePath, true);
    documents.push({
      sourcePath,
      sourceUrl: `${ORIGIN}/docs/${route ? `${route}/` : ""}`,
      route: `docs${route ? `/${route}` : ""}`,
      title: frontmatter.title,
      description: frontmatter.description,
      section: guideSection(route),
      order: 1000 + documents.length,
      digest: digest(markdown),
      markdown
    });
  }

  validateLlmDocuments(documents);
  return documents.sort(
    (left, right) =>
      SECTION_ORDER.indexOf(left.section) - SECTION_ORDER.indexOf(right.section) ||
      left.order - right.order ||
      left.sourcePath.localeCompare(right.sourcePath, "en")
  );
}

export function validateLlmDocuments(documents: readonly LlmDocument[]) {
  const routes = new Set<string>();
  for (const document of documents) {
    if (
      document.sourcePath.startsWith("/") ||
      document.sourcePath.includes("\\") ||
      document.sourcePath.split("/").includes("..")
    )
      throw new Error(`unsafe LLM source path ${document.sourcePath}`);
    if (document.route && routes.has(document.route)) throw new Error(`duplicate LLM route ${document.route}`);
    if (document.route) routes.add(document.route);
  }
}

export function compileLlmTxt(status: QualificationStatus) {
  return `# Verchestra

> Verified AI software delivery that survives the model, the machine, and the handoff.

- Version: ${status.currentVersion}
- Qualification: T${status.highestVerifiedTask} complete; T${status.nextTask} next
- Repository: https://github.com/accd/verchestra

Verchestra is in source qualification. It has no public installer and is not production-ready.
\`llms.txt\` is an inference-time documentation aid; it does not guarantee indexing, SEO ranking, training inclusion, or crawler behavior.

## Documentation

- [Documentation portal](${ORIGIN}/docs/): Architecture, workflows, integrations, and qualification evidence.
- [Full LLM context](${ORIGIN}/llms-full.txt): Allowlisted Markdown with source attribution and digests.
- [Architecture](${ORIGIN}/docs/architecture/system-overview/): System boundaries and trust model.
- [Roadmap](${ORIGIN}/roadmap/): T68 complete, T69 next, and the evidence-driven path to 1.0.
- [Contributing with agents](https://github.com/accd/verchestra/blob/main/docs/contributing-with-agents.md): Provider-neutral clean-clone workflow and safety model.
`;
}

export function compileLlmFull(status: QualificationStatus, documents: readonly LlmDocument[]) {
  const sections = documents.map(
    (document) => `## ${document.title}

- Source: ${document.sourceUrl}
- Repository path: \`${document.sourcePath}\`
- Section: ${document.section}
- Order: ${document.order}
- Content digest: \`${document.digest}\`

${document.markdown.trim()}
`
  );
  const output = `# Verchestra Full LLM Context

- Version: ${status.currentVersion}
- Qualification: T${status.highestVerifiedTask} complete; T${status.nextTask} next
- Reports: ${status.reportCount}

This deterministic context is an inference-time documentation aid. It does not guarantee indexing, SEO ranking, training inclusion, crawler behavior, public installation, or production readiness.

${sections.join("\n")}
`;
  if (Buffer.byteLength(output) >= MAXIMUM_BYTES) throw new Error("llms-full.txt exceeds 1 MiB");
  if (/(?:[A-Za-z]:\\(?:Users|Documents and Settings)\\|\/(?:Users|home)\/[^/\s]+\/)/u.test(output))
    throw new Error("LLM output contains a machine-local path");
  return output;
}

function alternateMarkdown(document: LlmDocument) {
  const body = document.markdown.replace(/^#\s+.+\n+/u, "");
  return `# ${document.title}

> ${document.description}

Source: ${document.sourceUrl}
Content digest: \`${document.digest}\`

${body.trim()}
`;
}

export async function writeLlmBuildArtifacts(repositoryRoot: URL | string, outputRoot: URL | string) {
  const root = typeof repositoryRoot === "string" ? repositoryRoot : fileURLToPath(repositoryRoot);
  const output = typeof outputRoot === "string" ? outputRoot : fileURLToPath(outputRoot);
  const status = await compileQualificationStatus(root);
  const documents = await collectLlmDocuments(root);
  const concise = compileLlmTxt(status);
  const full = compileLlmFull(status, documents);
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "llms.txt"), concise);
  await writeFile(join(output, "llms-full.txt"), full);
  for (const document of documents) {
    if (document.route === null) continue;
    const destination = join(output, ...document.route.split("/"), "index.html.md");
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, alternateMarkdown(document));
  }
  return { status, documents, concise, full };
}

export function llmArtifactsIntegration() {
  let repositoryRoot: URL;
  return {
    name: "verchestra-llm-artifacts",
    hooks: {
      "astro:config:done": ({ config }: { config: { root: URL } }) => {
        repositoryRoot = new URL("../../", config.root);
      },
      "astro:build:done": async ({ dir }: { dir: URL }) => {
        if (!existsSync(repositoryRoot)) throw new Error("repository root unavailable");
        await writeLlmBuildArtifacts(repositoryRoot, dir);
      }
    }
  };
}
