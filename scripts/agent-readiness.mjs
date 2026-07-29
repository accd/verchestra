import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const REPOSITORY = "accd/verchestra";
export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const REQUIRED_READS = Object.freeze([
  "AGENTS.md",
  "docs/architecture.md",
  "docs/repository-map.md",
  "ROADMAP.md",
  ".specs/STATE.md"
]);
export const GATES = Object.freeze({
  quick: "pnpm gate:quick",
  full: "pnpm gate:full",
  build: "pnpm gate:build",
  security: "pnpm gate:security",
  release: "pnpm gate:release",
  agent: "pnpm agent:check",
  site: "pnpm site:test && pnpm site:build"
});
export const SCOPED_INSTRUCTIONS = Object.freeze([
  "packages/AGENTS.md",
  "apps/site/AGENTS.md",
  "tests/AGENTS.md",
  "schemas/AGENTS.md",
  ".specs/AGENTS.md",
  "docs/AGENTS.md",
  "spikes/AGENTS.md"
]);
export const HANDOFF_STATUSES = Object.freeze(["planned", "in_progress", "blocked", "verification", "complete"]);

// Task identifiers stopped being integers when T68a-T68d were inserted ahead of
// T69 (AD-008), so neither succession nor completion can be computed from a
// numeric maximum: `Math.max` cannot order T68a against T69, and T68a would
// never count at all. Both are resolved by walking the ROADMAP.md chain, which
// makes ROADMAP.md the single ordering authority for how far the chain is
// verified as well as for what follows what.
const ROADMAP_EDGE = /^[^\S\n]*(T\d+[a-z]?)(?:\[[^\]]*\])?[^\S\n]*-->[^\S\n]*(T\d+[a-z]?)(?:\[[^\]]*\])?[^\S\n]*$/gmu;

export function parseRoadmapChain(roadmap) {
  return [...roadmap.matchAll(ROADMAP_EDGE)].map((match) => [match[1], match[2]]);
}

// An ordering authority that quietly normalizes an ambiguous graph is not an
// authority. A branch, a merge, a cycle, or a second disconnected component all
// fail closed with the conflicting task ids named, rather than being resolved by
// which edge happened to be written first.
export function validateRoadmapChain(roadmap) {
  const edges = parseRoadmapChain(roadmap);
  const errors = [];
  const successor = new Map();
  const incoming = new Map();
  for (const [from, to] of edges) {
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

  const chain = [];
  if (roots.length === 1) {
    const seen = new Set();
    for (let task = roots[0]; task !== undefined; task = successor.get(task)) {
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

export function resolveQualification(roadmap, validatedTasks) {
  const { chain, errors } = validateRoadmapChain(roadmap);
  // A validation report whose task id carries a letter suffix only exists
  // because of an inserted task, so one that no roadmap node claims is evidence
  // for nothing and must not be silently ignored.
  const declared = new Set(chain);
  const stray = [...validatedTasks].filter((task) => /[a-z]$/u.test(task) && !declared.has(task)).sort();
  const allErrors = [...errors, ...stray.map((task) => `${task} has a validation report but no roadmap node`)];
  if (allErrors.length > 0) return { highestVerifiedTask: null, nextTask: null, errors: allErrors };

  let highest = null;
  let index = 0;
  while (index < chain.length && validatedTasks.has(chain[index])) highest = chain[index++];
  const outOfOrder = chain.slice(index + 1).filter((task) => validatedTasks.has(task));
  return {
    highestVerifiedTask: highest,
    nextTask: highest === null ? (chain[0] ?? null) : (chain[index] ?? null),
    errors: outOfOrder.length === 0 ? [] : [`validation reports exist after the first gap: ${outOfOrder.join(", ")}`]
  };
}

export function qualificationStatusLine({ highestVerifiedTask, nextTask }) {
  if (nextTask === null) return `${highestVerifiedTask} complete; the declared chain is fully verified`;
  return `${highestVerifiedTask} complete; ${nextTask} next`;
}

export const QUALIFICATION_REPORT_SCHEMA = "verchestra-qualification-report/v1";
// T01-T68 were qualified before this contract existed. Their reports are
// immutable evidence, so they are admitted by declaration rather than rewritten
// to satisfy a rule written after the fact.
export const HISTORICAL_REPORTS_THROUGH = 68;

function isHistoricalReport(taskId) {
  const numeric = /^T(\d+)$/u.exec(taskId);
  return numeric !== null && Number(numeric[1]) <= HISTORICAL_REPORTS_THROUGH;
}

// A gate name is only meaningful if it is one of the declared gates. Any package
// script would let `format:check` alone stand in for a security surface.
export const DECLARED_GATES = Object.freeze(["gate:quick", "gate:full", "gate:build", "gate:security", "gate:release"]);
// `gate:quick` alone proves formatting and unit behavior. A qualification claim
// additionally needs one gate that runs the contract, architecture, security, or
// release stages, so the minimum profile is closed rather than open-ended.
const SUBSTANTIVE_GATES = Object.freeze(["gate:full", "gate:build", "gate:security", "gate:release"]);

// Closed formats, not "two numbers somewhere". `5 survived, 0 killed` must not
// be readable as five kills, and `7 missing, 7 total` must not be readable as
// seven of seven proven.
const CRITERIA = /^(\d+) of (\d+) acceptance criteria proven$/u;
const SENSOR = /^(\d+) killed, (\d+) survived$/u;

// A filename is not evidence, and neither is a well-formed string. A report only
// advances qualification when the revision it names is a commit this repository
// actually contains, the gates it claims are declared gates that cover a
// substantive surface, and its counts parse in a closed format that cannot be
// reversed by relabelling.
export function validateQualificationReport(source, taskId, { isRepositoryCommit } = {}) {
  if (isHistoricalReport(taskId)) return [];
  const errors = [];
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/u.exec(source);
  if (!match) return [`${taskId}: report is missing the qualification frontmatter`];
  const report = {};
  for (const line of match[1].split(/\r?\n/u)) {
    const field = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/u.exec(line);
    if (!field) return [`${taskId}: malformed frontmatter line`];
    report[field[1]] = field[2].trim();
  }

  if (report.schema !== QUALIFICATION_REPORT_SCHEMA) errors.push(`${taskId}: unsupported report schema`);
  if (report.task !== taskId) errors.push(`${taskId}: report claims task ${report.task ?? "nothing"}`);

  const revision = report.revision ?? "";
  if (!/^[0-9a-f]{40}$/u.test(revision)) errors.push(`${taskId}: revision is not a full commit id`);
  // A well-formed but invented SHA is the whole point of the check. The revision
  // has to be a commit this repository contains, which the report author cannot
  // fabricate.
  else if (isRepositoryCommit !== undefined && !isRepositoryCommit(revision))
    errors.push(`${taskId}: revision ${revision.slice(0, 12)} is not a commit in this repository`);
  if (report.gateRevision !== revision) errors.push(`${taskId}: gate evidence is not bound to the report revision`);

  const gates = (report.gates ?? "")
    .split(",")
    .map((gate) => gate.trim().replace(/^pnpm\s+/u, ""))
    .filter(Boolean);
  const results = (report.gateResults ?? "")
    .split(",")
    .map((result) => result.trim().toLowerCase())
    .filter(Boolean);
  for (const gate of gates)
    if (!DECLARED_GATES.includes(gate)) errors.push(`${taskId}: ${gate} is not a declared gate`);
  if (!gates.includes("gate:quick")) errors.push(`${taskId}: gate:quick was not recorded`);
  if (!gates.some((gate) => SUBSTANTIVE_GATES.includes(gate)))
    errors.push(`${taskId}: no gate covering a substantive surface was recorded`);
  if (gates.length !== results.length) errors.push(`${taskId}: every gate needs a recorded result`);
  else
    for (const [index, result] of results.entries()) {
      if (result !== "pass") errors.push(`${taskId}: gate ${gates[index]} did not pass`);
    }

  const criteria = CRITERIA.exec(report.criteriaEvidence ?? "");
  if (criteria === null) errors.push(`${taskId}: criteriaEvidence must read "<n> of <n> acceptance criteria proven"`);
  else if (Number(criteria[1]) < 1 || criteria[1] !== criteria[2])
    errors.push(`${taskId}: only ${criteria[1]} of ${criteria[2]} acceptance criteria are proven`);

  const sensor = SENSOR.exec(report.discriminationSensor ?? "");
  if (sensor === null) errors.push(`${taskId}: discriminationSensor must read "<n> killed, <n> survived"`);
  else if (Number(sensor[1]) < 1) errors.push(`${taskId}: the discrimination sensor killed nothing`);
  else if (Number(sensor[2]) !== 0) errors.push(`${taskId}: ${sensor[2]} mutants survived the discrimination sensor`);

  for (const field of ["skipped", "todo"]) {
    if (report[field] !== "0") errors.push(`${taskId}: ${field} must be 0, found ${report[field] ?? "nothing"}`);
  }

  // Independence and human review are deliberately NOT fields here. A string the
  // report author writes cannot establish that someone else reviewed the work,
  // and pretending otherwise is worse than not checking: it reads as enforcement
  // while enforcing nothing. That boundary belongs to branch protection on the
  // commit this report names, tracked by #60. `reviewedIn` records where to look
  // for it rather than asserting the verdict.
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/u.test(report.reviewedIn ?? ""))
    errors.push(`${taskId}: reviewedIn must name the pull request URL the evidence was reviewed in`);
  return errors;
}

export async function readQualificationReports(root) {
  const directory = join(root, "docs", "qualification");
  const tasks = new Set();
  const errors = [];
  if (!existsSync(directory)) return { tasks, errors };
  // Whether a revision exists is a fact about the repository, not a claim in the
  // file, so the report author cannot supply it.
  const known = new Map();
  const isRepositoryCommit = (revision) => {
    if (!known.has(revision)) known.set(revision, git(root, ["cat-file", "-e", `${revision}^{commit}`]) !== null);
    return known.get(revision);
  };
  for (const entry of (await readdir(directory)).sort()) {
    const task = /^t(\d+[a-z]?)-validation\.md$/u.exec(entry);
    if (!task) continue;
    const taskId = `T${task[1]}`;
    const problems = validateQualificationReport(await readFile(join(directory, entry), "utf8"), taskId, {
      isRepositoryCommit
    });
    if (problems.length === 0) tasks.add(taskId);
    else errors.push(...problems);
  }
  return { tasks, errors };
}

export async function validatedTasks(root) {
  return (await readQualificationReports(root)).tasks;
}

function git(root, args) {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}

export function normalizeRepositoryPath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\/+/u, "");
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === "null") return null;
  if (/^(?:0|[1-9]\d{0,14})$/u.test(trimmed)) return Number(trimmed);
  return trimmed.replace(/^(['"])(.*)\1$/u, "$2");
}

export function parseHandoff(source, path = "handoff.md") {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u.exec(source);
  if (!match) throw new Error(`${path}: missing YAML frontmatter`);
  const frontmatter = {};
  for (const line of match[1].split(/\r?\n/u)) {
    const field = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/u.exec(line);
    if (!field) throw new Error(`${path}: malformed frontmatter line`);
    frontmatter[field[1]] = parseScalar(field[2]);
  }
  const required = [
    "schema",
    "feature",
    "issue",
    "status",
    "branch",
    "baseRevision",
    "lastCompletedTask",
    "nextTask",
    "lastGate",
    "updatedAt"
  ];
  for (const field of required) {
    if (!Object.hasOwn(frontmatter, field)) throw new Error(`${path}: missing ${field}`);
  }
  if (frontmatter.schema !== "verchestra-feature-handoff/v1") throw new Error(`${path}: unsupported schema`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(frontmatter.feature)) throw new Error(`${path}: invalid feature`);
  if (frontmatter.issue !== null && (!Number.isInteger(frontmatter.issue) || frontmatter.issue < 1))
    throw new Error(`${path}: invalid issue`);
  if (!HANDOFF_STATUSES.includes(frontmatter.status)) throw new Error(`${path}: invalid status`);
  if (typeof frontmatter.branch !== "string" || frontmatter.branch.length === 0)
    throw new Error(`${path}: invalid branch`);
  if (!/^[0-9a-f]{40}$/u.test(frontmatter.baseRevision)) throw new Error(`${path}: invalid baseRevision`);
  if (frontmatter.lastCompletedTask !== null && !/^T\d+$/u.test(frontmatter.lastCompletedTask))
    throw new Error(`${path}: invalid lastCompletedTask`);
  if (typeof frontmatter.nextTask !== "string" || frontmatter.nextTask.length === 0)
    throw new Error(`${path}: invalid nextTask`);
  if (frontmatter.lastGate !== null && typeof frontmatter.lastGate !== "string")
    throw new Error(`${path}: invalid lastGate`);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/u.test(frontmatter.updatedAt))
    throw new Error(`${path}: updatedAt must be ISO-8601 UTC`);
  if (frontmatter.status === "blocked" && !/^# Blockers\r?$/mu.test(match[2]))
    throw new Error(`${path}: blocked handoff needs a Blockers section`);
  return { ...frontmatter, body: match[2] };
}

export function validateHandoffTransition(from, to) {
  if (from === to) return true;
  if (to === "blocked") return from !== "complete";
  if (from === "blocked") return new Set(["planned", "in_progress", "verification"]).has(to);
  return (
    new Map([
      ["planned", "in_progress"],
      ["in_progress", "verification"],
      ["verification", "complete"]
    ]).get(from) === to
  );
}

async function featureHandoffs(root) {
  const directory = join(root, ".specs", "features");
  if (!existsSync(directory)) return [];
  const features = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name, "en")
  )) {
    if (!entry.isDirectory()) continue;
    const path = join(directory, entry.name, "handoff.md");
    if (!existsSync(path)) continue;
    const handoff = parseHandoff(await readFile(path, "utf8"), normalizeRepositoryPath(relative(root, path)));
    if (handoff.status === "complete") continue;
    features.push({
      slug: handoff.feature,
      issue: handoff.issue,
      status: handoff.status,
      lastCompletedTask: handoff.lastCompletedTask,
      nextTask: handoff.nextTask,
      handoffPath: normalizeRepositoryPath(relative(root, path))
    });
  }
  return features;
}

export async function compileAgentContext(root = ROOT) {
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const revision = git(root, ["rev-parse", "HEAD"]) ?? "unknown";
  const symbolicBranch = git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const dirtyOutput = git(root, ["status", "--porcelain"]);
  const tasks = await validatedTasks(root);
  let highestNumeric = 0;
  for (const task of tasks) {
    const numeric = /^T(\d+)$/u.exec(task);
    if (numeric) highestNumeric = Math.max(highestNumeric, Number(numeric[1]));
  }
  const roadmapPath = join(root, "ROADMAP.md");
  const roadmap = existsSync(roadmapPath) ? await readFile(roadmapPath, "utf8") : "";
  // Without a declared chain the snapshot still has to be deterministic before
  // installation, so it degrades to the numeric successor. `checkRepository`
  // rejects that fallback whenever a roadmap exists, so it cannot persist.
  const resolved = resolveQualification(roadmap, tasks);
  const declared = resolved.highestVerifiedTask !== null || resolved.nextTask !== null;
  return {
    schemaVersion: 3,
    repository: REPOSITORY,
    version: manifest.version,
    revision,
    branch: symbolicBranch || null,
    dirty: dirtyOutput === null ? false : dirtyOutput.length > 0,
    qualification: {
      highestVerifiedTask: declared ? resolved.highestVerifiedTask : `T${highestNumeric}`,
      // null once every declared task is verified, which is a real terminal
      // state rather than a missing chain.
      nextTask: declared ? resolved.nextTask : `T${highestNumeric + 1}`
    },
    requiredReads: [...REQUIRED_READS],
    activeFeatures: await featureHandoffs(root),
    gates: { ...GATES }
  };
}

async function trackedFiles(root) {
  const output = git(root, ["ls-files"]);
  return output ? output.split(/\r?\n/u).filter(Boolean).map(normalizeRepositoryPath) : [];
}

async function checkMarkdownLinks(root, files, errors) {
  for (const path of files) {
    if (!path.endsWith(".md") || !existsSync(join(root, path))) continue;
    const source = await readFile(join(root, path), "utf8");
    for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
      const target = match[1].trim().replace(/^<|>$/gu, "");
      if (/^(?:https?:|mailto:|#)/u.test(target)) continue;
      const clean = decodeURIComponent(target.split(/[?#]/u)[0]);
      if (!clean) continue;
      if (path.startsWith("apps/site/src/content/docs/docs/")) {
        const contentPrefix = "apps/site/src/content/docs/docs/";
        const sourceRelative = path.slice(contentPrefix.length);
        const sourceWithoutExtension = sourceRelative.replace(/\.(?:md|mdx)$/u, "");
        const routeBase =
          posix.basename(sourceWithoutExtension) === "index"
            ? posix.dirname(sourceWithoutExtension)
            : sourceWithoutExtension;
        let route;
        if (clean.startsWith("/verchestra/docs/")) route = clean.slice("/verchestra/docs/".length);
        else if (clean.startsWith("/verchestra/")) {
          const page = clean.slice("/verchestra/".length).replace(/\/$/u, "");
          if (
            page.length === 0 ||
            existsSync(join(root, "apps", "site", "src", "pages", `${page}.astro`)) ||
            existsSync(join(root, "apps", "site", "src", "pages", page, "index.astro")) ||
            (page === "roadmap" && existsSync(join(root, "ROADMAP.md")))
          )
            continue;
          errors.push(`${path}: broken or unsafe Markdown link ${target}`);
          continue;
        } else route = posix.normalize(posix.join(routeBase, clean));
        route = route.replace(/^\/|\/$/gu, "");
        if (
          existsSync(join(root, "apps", "site", "src", "content", "docs", "docs", `${route}.md`)) ||
          existsSync(join(root, "apps", "site", "src", "content", "docs", "docs", `${route}.mdx`)) ||
          existsSync(join(root, "apps", "site", "src", "content", "docs", "docs", route, "index.md")) ||
          existsSync(join(root, "apps", "site", "src", "content", "docs", "docs", route, "index.mdx")) ||
          (/^qualification\/t\d+-validation$/u.test(route) && existsSync(join(root, "docs", `${route}.md`)))
        )
          continue;
        errors.push(`${path}: broken or unsafe Markdown link ${target}`);
        continue;
      }
      const absolute = resolve(dirname(join(root, path)), clean);
      if (!absolute.startsWith(`${resolve(root)}${sep}`) || !existsSync(absolute))
        errors.push(`${path}: broken or unsafe Markdown link ${target}`);
    }
  }
}

function unsafeValue(source) {
  return (
    /(?:[A-Za-z]:\\(?:Users|Documents and Settings)\\|\/(?:Users|home)\/[^/\s]+\/)/u.test(source) ||
    /\b(?:ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{20,})\b/u.test(source) ||
    /\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)\s*=\s*\S+/u.test(source)
  );
}

export async function checkRepository(root = ROOT) {
  const errors = [];
  for (const path of [
    ...REQUIRED_READS,
    ...SCOPED_INSTRUCTIONS,
    "CLAUDE.md",
    "GEMINI.md",
    "llms.txt",
    "package.json"
  ]) {
    if (!existsSync(join(root, path))) errors.push(`missing required path: ${path}`);
  }
  if (existsSync(join(root, "CLAUDE.md")) && (await readFile(join(root, "CLAUDE.md"), "utf8")) !== "@AGENTS.md\n")
    errors.push("CLAUDE.md does not match generated pointer");
  if (existsSync(join(root, "GEMINI.md")) && (await readFile(join(root, "GEMINI.md"), "utf8")) !== "@./AGENTS.md\n")
    errors.push("GEMINI.md does not match generated pointer");

  if (existsSync(join(root, "AGENTS.md"))) {
    const rootInstructions = await readFile(join(root, "AGENTS.md"), "utf8");
    if (rootInstructions.split(/\r?\n/u).length >= 200) errors.push("AGENTS.md exceeds 199 lines");
  }
  for (const path of SCOPED_INSTRUCTIONS) {
    if (!existsSync(join(root, path))) continue;
    const source = await readFile(join(root, path), "utf8");
    if (source.split(/\r?\n/u).length > 120) errors.push(`${path} exceeds 120 lines`);
    if (/\b(?:ignore|override|relax)\s+(?:the\s+)?root\b/iu.test(source))
      errors.push(`${path} contradicts root instructions`);
  }

  const files = await trackedFiles(root);
  for (const prohibited of [
    ".cursorrules",
    ".windsurfrules",
    ".github/copilot-instructions.md",
    "CODEX.md",
    "OPENCODE.md"
  ]) {
    if (files.includes(prohibited)) errors.push(`prohibited provider instruction file: ${prohibited}`);
  }
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const licenseStatement = "Verchestra is licensed under the [Apache License 2.0](LICENSE).";
  const licenseDecision = "### AD-007 — Project license is Apache-2.0";
  if (manifest.license !== "Apache-2.0") errors.push("package.json: license must be Apache-2.0");
  for (const [path, requiredStatement] of [
    ["README.md", licenseStatement],
    [".specs/STATE.md", licenseDecision],
    ["LICENSE", "Apache License"]
  ]) {
    if (!existsSync(join(root, path)) || !(await readFile(join(root, path), "utf8")).includes(requiredStatement))
      errors.push(`${path}: license statement disagrees with Apache-2.0`);
  }
  const instructionFiles = ["AGENTS.md", ...SCOPED_INSTRUCTIONS].filter((path) => existsSync(join(root, path)));
  const contextFiles = [
    ...new Set([
      ...files.filter(
        (path) =>
          path.endsWith("AGENTS.md") ||
          path === "CLAUDE.md" ||
          path === "GEMINI.md" ||
          path === "llms.txt" ||
          path.startsWith(".specs/features/agent-ready-repository/") ||
          path === "docs/repository-map.md" ||
          path === "docs/contributing-with-agents.md"
      ),
      ...instructionFiles,
      "CLAUDE.md",
      "GEMINI.md",
      "docs/repository-map.md",
      "docs/contributing-with-agents.md",
      "llms.txt"
    ])
  ].filter((path) => existsSync(join(root, path)));
  for (const path of contextFiles) {
    const source = await readFile(join(root, path), "utf8");
    if (unsafeValue(source)) errors.push(`${path}: contains a secret-like value or machine-local path`);
  }

  for (const path of instructionFiles) {
    const source = await readFile(join(root, path), "utf8");
    for (const match of source.matchAll(/\bpnpm\s+([a-z][\w:-]*)/gu)) {
      const command = match[1];
      if (command !== "install" && !Object.hasOwn(manifest.scripts, command))
        errors.push(`${path}: referenced pnpm command does not exist: ${command}`);
    }
  }

  const context = await compileAgentContext(root);
  if (context.version !== "0.0.0-qualification") errors.push(`stale version: ${context.version}`);
  const { highestVerifiedTask, nextTask } = context.qualification;
  const statusLine = qualificationStatusLine(context.qualification);
  for (const path of [".specs/STATE.md", "ROADMAP.md"]) {
    if (!existsSync(join(root, path))) continue;
    const source = await readFile(join(root, path), "utf8");
    for (const task of [highestVerifiedTask, nextTask]) {
      if (task === null) continue;
      if (!new RegExp(String.raw`\b${task}\b`, "u").test(source)) errors.push(`${path}: missing ${task} status`);
    }
  }
  // The chain must be declared unambiguously by the roadmap, never inferred, so
  // a missing, branched, cyclic, or partially verified chain fails with the
  // conflicting task ids named instead of keeping the numeric fallback.
  const reports = await readQualificationReports(root);
  for (const problem of reports.errors) errors.push(`docs/qualification: ${problem}`);
  if (existsSync(join(root, "ROADMAP.md"))) {
    const roadmap = await readFile(join(root, "ROADMAP.md"), "utf8");
    const resolved = resolveQualification(roadmap, reports.tasks);
    for (const problem of resolved.errors) errors.push(`ROADMAP.md: ${problem}`);
    if (resolved.errors.length === 0 && resolved.highestVerifiedTask === null)
      errors.push("ROADMAP.md does not declare a verified qualification chain");
  }
  if (existsSync(join(root, "llms.txt"))) {
    const llms = await readFile(join(root, "llms.txt"), "utf8");
    if (!llms.includes(context.version) || !llms.includes(statusLine))
      errors.push("llms.txt disagrees with repository status");
  }

  const handoffDirectory = join(root, ".specs", "features");
  if (existsSync(handoffDirectory)) {
    for (const feature of await readdir(handoffDirectory, { withFileTypes: true })) {
      const handoff = join(handoffDirectory, feature.name, "handoff.md");
      if (feature.isDirectory() && existsSync(handoff)) {
        try {
          parseHandoff(await readFile(handoff, "utf8"), normalizeRepositoryPath(relative(root, handoff)));
        } catch (error) {
          errors.push(error.message);
        }
      }
    }
  }
  await checkMarkdownLinks(root, files, errors);
  return [...new Set(errors)].sort();
}

export async function assertFileSize(path, maximumBytes) {
  const result = await stat(path);
  if (result.size > maximumBytes) throw new Error(`${path} exceeds ${maximumBytes} bytes`);
}
