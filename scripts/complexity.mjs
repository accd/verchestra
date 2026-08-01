// Deterministic cyclomatic-complexity measurement over the repository's own
// pinned ESLint. The analyzer calculates; nothing here estimates. Policy and
// interpretation live in docs/complexity.md.
//
//   node scripts/complexity.mjs report   distribution and hotspots, read-only
//   node scripts/complexity.mjs check    compare production hotspots to the
//                                        committed baseline; non-zero on drift
//   node scripts/complexity.mjs update   rewrite the baseline downward; raising
//                                        an entry requires --allow-increase
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { relative, resolve } from "node:path";
import { ESLint } from "eslint";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const BASELINE_PATH = resolve(ROOT, "complexity-baseline.json");
const POLICY = Object.freeze({ target: 10, variant: "classic" });
// The report sweep includes tests; the check sweep skips the repository test
// roots because the policy enforces production scopes only.
const REPORT_ROOTS = ["scripts", "tests", "apps", "packages"];
const CHECK_ROOTS = ["scripts", "apps", "packages"];
const PRODUCTION_SCOPES = new Set(["packages-src", "vestra-cli", "site-src", "scripts"]);

export function scopeOf(path) {
  if (/^packages\/[^/]+\/src\//.test(path)) return "packages-src";
  if (/^apps\/vestra-cli\/src\//.test(path)) return "vestra-cli";
  if (/^apps\/site\/src\//.test(path)) return "site-src";
  if (/^scripts\//.test(path)) return "scripts";
  if (/^apps\/site\/tests\//.test(path)) return "site-tests";
  if (/^tests\//.test(path) || /^packages\/[^/]+\/tests?\//.test(path)) return "tests";
  return "other";
}

export async function measure(roots) {
  const eslint = new ESLint({
    cwd: ROOT,
    overrideConfigFile: resolve(ROOT, "eslint.config.mjs"),
    overrideConfig: [{ rules: { complexity: ["warn", { max: 0, variant: POLICY.variant }] } }],
    warnIgnored: false
  });
  const results = await eslint.lintFiles(roots.map((root) => resolve(ROOT, root)));
  const entries = [];
  for (const result of results) {
    const file = relative(ROOT, result.filePath).replaceAll("\\", "/");
    for (const message of result.messages) {
      if (message.ruleId !== "complexity") continue;
      const parsed = message.message.match(/^(.*) has a complexity of (\d+)\./u);
      if (!parsed) throw new Error(`unrecognized complexity message: ${message.message}`);
      entries.push({ file, symbol: parsed[1], line: message.line, value: Number(parsed[2]), scope: scopeOf(file) });
    }
  }
  entries.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return entries;
}

// Hotspots are keyed by file and reported symbol text, never by line number,
// so formatting cannot move the baseline. Duplicate symbols in one file (for
// example two anonymous arrow functions) collapse into one key holding the
// sorted list of their values.
export function hotspotBaseline(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    if (!PRODUCTION_SCOPES.has(entry.scope) || entry.value <= POLICY.target) continue;
    const key = `${entry.file} :: ${entry.symbol}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(entry.value);
  }
  const hotspots = {};
  for (const key of [...grouped.keys()].sort()) hotspots[key] = grouped.get(key).sort((a, b) => a - b);
  return { target: POLICY.target, variant: POLICY.variant, hotspots };
}

async function readBaseline() {
  try {
    return JSON.parse(await readFile(BASELINE_PATH, "utf8"));
  } catch {
    return null;
  }
}

export function compareToBaseline(current, baseline) {
  const failures = [];
  const currentKeys = new Set(Object.keys(current.hotspots));
  for (const [key, values] of Object.entries(baseline.hotspots)) {
    const measured = current.hotspots[key];
    if (!measured) {
      failures.push(
        `${key}: baselined at [${values}] but no longer above ${baseline.target} — ratchet it out with \`corepack pnpm complexity:update\``
      );
      continue;
    }
    currentKeys.delete(key);
    if (measured.length === values.length && measured.every((value, index) => value === values[index])) continue;
    const grew = measured.length > values.length || measured.some((value, index) => value > (values[index] ?? 0));
    failures.push(
      grew
        ? `${key}: measured [${measured}] exceeds the baselined [${values}] — reduce it, or raise the baseline in a reviewed change with a linked issue`
        : `${key}: measured [${measured}] improved on the baselined [${values}] — lock it in with \`corepack pnpm complexity:update\``
    );
  }
  for (const key of [...currentKeys].sort()) {
    failures.push(
      `${key}: complexity [${current.hotspots[key]}] exceeds the new-code target of ${baseline.target} and has no baseline entry`
    );
  }
  return failures;
}

function quantile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function distribution(entries) {
  const byScope = new Map();
  for (const entry of entries) {
    if (!byScope.has(entry.scope)) byScope.set(entry.scope, []);
    byScope.get(entry.scope).push(entry.value);
  }
  const rows = [];
  for (const scope of [...byScope.keys()].sort()) {
    const values = byScope.get(scope).sort((a, b) => a - b);
    rows.push({
      scope,
      functions: values.length,
      median: quantile(values, 50),
      p90: quantile(values, 90),
      p95: quantile(values, 95),
      max: values[values.length - 1],
      above5: values.filter((value) => value > 5).length,
      above10: values.filter((value) => value > 10).length,
      above20: values.filter((value) => value > 20).length
    });
  }
  return rows;
}

async function runReport() {
  const entries = await measure(REPORT_ROOTS);
  console.log(`analyzer: eslint core \`complexity\`, variant ${POLICY.variant}; new-code target ${POLICY.target}`);
  console.table(distribution(entries));
  const production = entries.filter((entry) => PRODUCTION_SCOPES.has(entry.scope) && entry.value > POLICY.target);
  console.log(`production functions above ${POLICY.target}: ${production.length}`);
  for (const entry of production.sort((a, b) => b.value - a.value).slice(0, 25)) {
    console.log(`  ${String(entry.value).padStart(3)}  ${entry.file}:${entry.line}  ${entry.symbol}`);
  }
  return 0;
}

async function runCheck() {
  const baseline = await readBaseline();
  if (!baseline) {
    console.error(
      `complexity: missing ${relative(ROOT, BASELINE_PATH)} — generate it with \`corepack pnpm complexity:update\``
    );
    return 1;
  }
  const current = hotspotBaseline(await measure(CHECK_ROOTS));
  const failures = compareToBaseline(current, baseline);
  if (failures.length > 0) {
    console.error(`complexity: ${failures.length} violation(s) of the policy in docs/complexity.md`);
    for (const failure of failures) console.error(`  ${failure}`);
    return 1;
  }
  console.log(
    `complexity: PASS — ${Object.keys(baseline.hotspots).length} baselined hotspot keys, nothing above ${baseline.target} unaccounted`
  );
  return 0;
}

function raisedEntries(previous, next) {
  return Object.entries(next.hotspots).filter(([key, values]) => {
    const before = previous.hotspots[key];
    return before && (values.length > before.length || values.some((value, index) => value > (before[index] ?? 0)));
  });
}

async function runUpdate() {
  const previous = await readBaseline();
  const next = hotspotBaseline(await measure(CHECK_ROOTS));
  const raised = previous && !process.argv.includes("--allow-increase") ? raisedEntries(previous, next) : [];
  if (raised.length > 0) {
    console.error("complexity: refusing to raise baseline entries; the ratchet only moves down");
    for (const [key, values] of raised) console.error(`  ${key}: [${previous.hotspots[key]}] -> [${values}]`);
    console.error("  pass --allow-increase only inside a reviewed change that links its issue");
    return 1;
  }
  await writeFile(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`complexity: baseline written with ${Object.keys(next.hotspots).length} hotspot keys`);
  return 0;
}

const MODES = Object.freeze({ report: runReport, check: runCheck, update: runUpdate });

async function main() {
  const mode = MODES[process.argv[2] ?? "report"];
  if (!mode) {
    console.error(`usage: node scripts/complexity.mjs [report|check|update]`);
    return 2;
  }
  return mode();
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exitCode = await main();
