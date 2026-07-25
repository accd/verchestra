import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface RepositoryContentSource {
  id: string;
  sourcePath: string;
  route: string;
  title?: string;
  description?: string;
  section: string;
  order: number;
  search: boolean;
}

export interface QualificationStatus {
  currentVersion: string;
  highestVerifiedTask: number;
  nextTask: number;
  reportCount: number;
}

export const repositoryContentSources: readonly RepositoryContentSource[] = [
  {
    id: "architecture",
    sourcePath: "docs/architecture.md",
    route: "docs/architecture/system-overview",
    description: "The Verchestra system boundaries, trust model, and delivery control plane.",
    section: "Architecture",
    order: 1,
    search: true
  },
  {
    id: "roadmap",
    sourcePath: "ROADMAP.md",
    route: "roadmap",
    description: "The evidence-driven path from qualification foundations to the 1.0 release decision.",
    section: "Project",
    order: 2,
    search: true
  },
  {
    id: "contributing",
    sourcePath: "CONTRIBUTING.md",
    route: "docs/community/contributing",
    section: "Community",
    order: 1,
    search: true
  },
  {
    id: "security",
    sourcePath: "SECURITY.md",
    route: "docs/community/security",
    section: "Community",
    order: 2,
    search: true
  },
  {
    id: "support",
    sourcePath: "SUPPORT.md",
    route: "docs/community/support",
    section: "Community",
    order: 3,
    search: true
  },
  {
    id: "versioning",
    sourcePath: "VERSIONING.md",
    route: "docs/community/versioning",
    section: "Community",
    order: 4,
    search: true
  },
  {
    id: "code-of-conduct",
    sourcePath: "CODE_OF_CONDUCT.md",
    route: "docs/community/code-of-conduct",
    section: "Community",
    order: 5,
    search: true
  }
];

export function resolveRepositoryPath(repositoryRoot: URL | string, sourcePath: string): string {
  const root = resolve(typeof repositoryRoot === "string" ? repositoryRoot : fileURLToPath(repositoryRoot));
  const candidate = resolve(root, sourcePath);
  const pathFromRoot = relative(root, candidate);
  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error(`repository source is outside repository: ${sourcePath}`);
  }
  return candidate;
}

export function isCanonicalSourcePath(repositoryRoot: URL | string, changedPath: string): boolean {
  const root = resolve(typeof repositoryRoot === "string" ? repositoryRoot : fileURLToPath(repositoryRoot));
  const normalized = relative(root, resolve(changedPath)).replaceAll("\\", "/");
  if (normalized.startsWith("../") || isAbsolute(normalized)) return false;
  return (
    repositoryContentSources.some(({ sourcePath }) => sourcePath === normalized) ||
    /^docs\/qualification\/t\d{2}-validation\.md$/i.test(normalized)
  );
}

export function validateUniqueRoutes(sources: ReadonlyArray<Pick<RepositoryContentSource, "id" | "route">>): void {
  const routes = new Set<string>();
  for (const source of sources) {
    if (routes.has(source.route)) throw new Error(`duplicate route ${source.route}`);
    routes.add(source.route);
  }
}

export function extractTitle(markdown: string): string {
  const title = markdown.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim();
  if (!title) throw new Error("canonical Markdown is missing an H1 title");
  return title;
}

export function extractDescription(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let paragraph = "";
  let afterTitle = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!afterTitle) {
      if (line.startsWith("# ")) afterTitle = true;
      continue;
    }
    if (!line) {
      if (paragraph) break;
      continue;
    }
    if (line.startsWith("#") || line.startsWith("```") || line.startsWith("|") || line.startsWith("<")) continue;
    paragraph += `${paragraph ? " " : ""}${line.replace(/^>\s*/, "")}`;
  }
  if (!paragraph) throw new Error("canonical Markdown is missing a description paragraph");
  return paragraph.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`]/g, "");
}

export async function compileQualificationStatus(repositoryRoot: URL | string): Promise<QualificationStatus> {
  const root = typeof repositoryRoot === "string" ? pathToFileURL(`${resolve(repositoryRoot)}/`) : repositoryRoot;
  const packageMetadata = JSON.parse(await readFile(new URL("package.json", root), "utf8")) as { version?: unknown };
  if (typeof packageMetadata.version !== "string") throw new Error("package version is missing");

  const qualificationDirectory = new URL("docs/qualification/", root);
  const entries = await readdir(qualificationDirectory);
  const taskNumbers = entries
    .map((entry) => /^t(\d{2})-validation\.md$/i.exec(entry)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number)
    .sort((left, right) => left - right);

  const highestVerifiedTask = taskNumbers.at(-1) ?? 0;
  for (let task = 1; task <= highestVerifiedTask; task += 1) {
    if (!taskNumbers.includes(task)) {
      throw new Error(`missing qualification report T${String(task).padStart(2, "0")}`);
    }
  }

  return {
    currentVersion: packageMetadata.version,
    highestVerifiedTask,
    nextTask: highestVerifiedTask + 1,
    reportCount: taskNumbers.length
  };
}

export async function assertProjectStatus(repositoryRoot: URL | string, status: QualificationStatus): Promise<void> {
  const root = typeof repositoryRoot === "string" ? pathToFileURL(`${resolve(repositoryRoot)}/`) : repositoryRoot;
  const [readme, roadmap] = await Promise.all([
    readFile(new URL("README.md", root), "utf8"),
    readFile(new URL("ROADMAP.md", root), "utf8")
  ]);

  if (!readme.includes(status.currentVersion) || !roadmap.includes(status.currentVersion)) {
    throw new Error(`public documents do not agree on version ${status.currentVersion}`);
  }
  if (!new RegExp(`\\bT${status.highestVerifiedTask}\\b`).test(roadmap)) {
    throw new Error(`roadmap does not identify T${status.highestVerifiedTask} as the completed foundation`);
  }
  if (!new RegExp(`\\bT${status.nextTask}\\b`).test(roadmap)) {
    throw new Error(`roadmap does not identify T${status.nextTask} as the next qualification task`);
  }
}
