import { readdirSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, posix, relative, resolve } from "node:path";
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
  highestVerifiedTask: string;
  nextTask: string | null;
  reportCount: number;
}

export const rewriteCanonicalLinks = (
  markdown: string,
  source: RepositoryContentSource,
  sources: readonly RepositoryContentSource[],
  base: string
) =>
  markdown.replace(/(?<!!)\]\((?![#a-z]+:|\/\/)([^)\s]+)(#[^)\s]+)?\)/giu, (_match, target, fragment = "") => {
    const sourcePath = posix.normalize(posix.join(posix.dirname(source.sourcePath), target));
    const siteTarget = sources.find((candidate) => candidate.sourcePath === sourcePath);
    if (siteTarget) return `](${base}/${siteTarget.route}/${fragment})`.replaceAll("//", "/");
    return `](https://github.com/accd/verchestra/blob/main/${sourcePath}${fragment})`;
  });

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
    id: "execution-package-proof",
    sourcePath: "docs/proof/execution-package.md",
    route: "docs/proof/execution-package",
    description: "A real, signed, fixture-generated Execution Package you can inspect and regenerate.",
    section: "Proof",
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

// One convention for what a qualification report file is called. It was written
// out three times on this side alone, each fixed at two digits, so an inserted
// task like T68a was invisible to the loader, to the llms projection, and to the
// canonical-path check at once.
export const QUALIFICATION_REPORT_FILE = /^t(\d+[a-z]?)-validation\.md$/iu;

// The navigation entry for every report that exists, derived rather than
// counted. A fixed range silently omits inserted tasks, so a report could be
// published and still be unreachable from the list that is supposed to show it.
export function qualificationSidebarItems(repositoryRoot: URL | string): { label: string; slug: string }[] {
  const directory = resolveRepositoryPath(repositoryRoot, "docs/qualification");
  return readdirSync(directory)
    .filter((entry) => QUALIFICATION_REPORT_FILE.test(entry))
    .map((entry) => entry.replace(/\.md$/iu, ""))
    .sort()
    .map((slug) => ({
      label: `${slug.replace(/-validation$/u, "").toUpperCase()} validation`,
      slug: `docs/qualification/${slug}`
    }));
}

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
    QUALIFICATION_REPORT_FILE.test(normalized.replace(/^docs\/qualification\//u, ""))
  );
}

export function canonicalContentFilePath(route: string): string {
  if (!/^[a-z0-9]+(?:[/-][a-z0-9]+)*$/u.test(route)) {
    throw new Error(`unsafe canonical content route: ${route}`);
  }
  return `src/content/docs/${route}.md`;
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
  const taskIds = entries
    .map((entry) => QUALIFICATION_REPORT_FILE.exec(entry)?.[1])
    .filter((value): value is string => value !== undefined);
  const taskNumbers = taskIds
    .filter((id) => /^\d+$/.test(id))
    .map(Number)
    .sort((left, right) => left - right);

  const highestNumericTask = taskNumbers.at(-1) ?? 0;
  for (let task = 1; task <= highestNumericTask; task += 1) {
    if (!taskNumbers.includes(task)) {
      throw new Error(`missing qualification report T${String(task).padStart(2, "0")}`);
    }
  }

  // Task identifiers stopped being integers when T68a-T68d were inserted ahead of
  // T69 (AD-008), so both how far the chain is verified and what comes next are
  // resolved by walking the roadmap chain. ROADMAP.md is the ordering authority.
  const roadmap = await readFile(new URL("ROADMAP.md", root), "utf8");
  const verified = new Set(taskIds.map((id) => `T${id}`));
  const { highestVerifiedTask, nextTask, errors } = resolveQualification(roadmap, verified);
  if (errors.length > 0) throw new Error(`roadmap chain is not usable: ${errors.join("; ")}`);
  if (highestVerifiedTask === null) {
    throw new Error("roadmap does not declare a verified qualification chain");
  }

  return {
    currentVersion: packageMetadata.version,
    highestVerifiedTask,
    nextTask,
    reportCount: taskIds.length
  };
}

// An ordering authority that quietly normalizes an ambiguous graph is not an
// authority. A branch, a merge, a cycle, or a second disconnected component all
// fail closed with the conflicting task ids named, rather than being resolved by
// which edge happened to be written first.
export function validateRoadmapChain(roadmap: string): { chain: readonly string[]; errors: readonly string[] } {
  const edge = /^[^\S\n]*(T\d+[a-z]?)(?:\[[^\]]*\])?[^\S\n]*-->[^\S\n]*(T\d+[a-z]?)(?:\[[^\]]*\])?[^\S\n]*$/gmu;
  const errors: string[] = [];
  const successor = new Map<string, string>();
  const incoming = new Map<string, number>();
  for (const match of roadmap.matchAll(edge)) {
    const [from, to] = [match[1]!, match[2]!];
    if (from === to) errors.push(`${from} declares an edge to itself`);
    if (successor.has(from)) errors.push(`${from} declares more than one successor: ${successor.get(from)} and ${to}`);
    else successor.set(from, to);
    incoming.set(to, (incoming.get(to) ?? 0) + 1);
  }
  for (const [task, count] of incoming) if (count > 1) errors.push(`${task} has ${count} predecessors`);

  const nodes = new Set([...successor.keys(), ...incoming.keys()]);
  const roots = [...nodes].filter((task) => !incoming.has(task));
  const terminals = [...nodes].filter((task) => !successor.has(task));
  if (nodes.size === 0) errors.push("no roadmap chain is declared");
  else {
    if (roots.length !== 1) errors.push(`the chain needs exactly one start, found ${roots.length || "none"}`);
    if (terminals.length !== 1) errors.push(`the chain needs exactly one end, found ${terminals.length || "none"}`);
  }

  const chain: string[] = [];
  if (roots.length === 1) {
    const seen = new Set<string>();
    for (let task: string | undefined = roots[0]; task !== undefined; task = successor.get(task)) {
      if (seen.has(task)) {
        errors.push(`the chain revisits ${task}`);
        break;
      }
      seen.add(task);
      chain.push(task);
    }
    const unreachable = [...nodes].filter((task) => !seen.has(task)).sort();
    if (unreachable.length > 0) errors.push(`unreachable from the start: ${unreachable.join(", ")}`);
  }
  return { chain: errors.length === 0 ? chain : [], errors };
}

export function resolveQualification(
  roadmap: string,
  verifiedTasks: ReadonlySet<string>
): { highestVerifiedTask: string | null; nextTask: string | null; errors: readonly string[] } {
  const { chain, errors } = validateRoadmapChain(roadmap);
  // A validation report whose task id carries a letter suffix only exists
  // because of an inserted task, so one that no roadmap node claims is evidence
  // for nothing and must not be silently ignored.
  const declared = new Set(chain);
  const stray = [...verifiedTasks].filter((task) => /[a-z]$/u.test(task) && !declared.has(task)).sort();
  const allErrors = [...errors, ...stray.map((task) => `${task} has a validation report but no roadmap node`)];
  if (allErrors.length > 0) return { highestVerifiedTask: null, nextTask: null, errors: allErrors };

  let highest: string | null = null;
  let index = 0;
  while (index < chain.length && verifiedTasks.has(chain[index]!)) highest = chain[index++]!;
  const outOfOrder = chain.slice(index + 1).filter((task) => verifiedTasks.has(task));
  return {
    highestVerifiedTask: highest,
    nextTask: highest === null ? (chain[0] ?? null) : (chain[index] ?? null),
    errors: outOfOrder.length === 0 ? [] : [`validation reports exist after the first gap: ${outOfOrder.join(", ")}`]
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
  if (!new RegExp(`\\b${status.highestVerifiedTask}\\b`).test(roadmap)) {
    throw new Error(`roadmap does not identify ${status.highestVerifiedTask} as the completed foundation`);
  }
  if (status.nextTask !== null && !new RegExp(`\\b${status.nextTask}\\b`).test(roadmap)) {
    throw new Error(`roadmap does not identify ${status.nextTask} as the next qualification task`);
  }
}
