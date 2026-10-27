// Merges the per-scope LCOV reports `test-scope.mjs` writes under
// VES_COVERAGE_DIR into the single report SonarCloud imports.
//
// invariant: a line or function counts as covered when any scope covered it,
// so its hits are summed per file across every report. Paths are normalised to
// forward slashes because SonarCloud resolves them against the repository on
// Linux, and a Windows run writes backslashes.
//
// Branches cannot be matched across reports: Node numbers the block of each
// `BRDA:line,block,branch,taken` in the order that run met its V8 ranges, and
// V8 splits a line into more ranges the more of it ran, so one branch carries
// a different key in every scope. Keying on it counted each branch once per
// scope (the conditions to cover doubled when a third scope was added). A line
// therefore keeps the most conditions any one report gave it and the most of
// them any one report covered: never more than were measured, at the price of
// under-counting a line whose branches different scopes covered.

const add = (map, key, count) => map.set(key, (map.get(key) ?? 0) + count);
const byCodeUnit = (left, right) => Number(left > right) - Number(left < right);
const covered = (counts) => [...counts].filter((count) => count > 0).length;

function splitFirst(value) {
  const comma = value.indexOf(",");
  return [value.slice(0, comma), value.slice(comma + 1)];
}

// Each handler folds one LCOV entry into the current file's record.
const ENTRIES = Object.freeze({
  DA(file, value) {
    const [line, count] = value.split(",");
    add(file.lines, Number(line), Number(count));
  },
  BRDA(file, value, record) {
    const [line, , , taken] = value.split(",");
    const counts = record.get(Number(line)) ?? { conditions: 0, covered: 0 };
    counts.conditions += 1;
    if (taken !== "-" && Number(taken) > 0) counts.covered += 1;
    record.set(Number(line), counts);
  },
  FN(file, value) {
    const [line, name] = splitFirst(value);
    file.functions.set(name, Number(line));
  },
  FNDA(file, value) {
    const [count, name] = splitFirst(value);
    add(file.hits, name, Number(count));
  }
});

// One record's per-line branch counts join the file's by keeping the larger of
// each, never their sum.
function foldBranches(file, record) {
  for (const [line, { conditions, covered: hit }] of record) {
    const merged = file.branches.get(line) ?? { conditions: 0, covered: 0 };
    file.branches.set(line, {
      conditions: Math.max(merged.conditions, conditions),
      covered: Math.max(merged.covered, hit)
    });
  }
}

function parse(report, files) {
  let file;
  let record = new Map();
  const close = () => {
    if (file) foldBranches(file, record);
    file = undefined;
    record = new Map();
  };
  for (const raw of report.split(/\r?\n/u)) {
    const separator = raw.indexOf(":");
    const tag = separator === -1 ? raw.trim() : raw.slice(0, separator);
    const value = raw.slice(separator + 1);
    if (tag === "SF") {
      close();
      const path = value.replaceAll("\\", "/");
      if (!files.has(path))
        files.set(path, { lines: new Map(), branches: new Map(), functions: new Map(), hits: new Map() });
      file = files.get(path);
    } else if (tag === "end_of_record") close();
    else if (file && Object.hasOwn(ENTRIES, tag)) ENTRIES[tag](file, value, record);
  }
  close();
}

function renderBranches(branches) {
  const lines = [...branches.keys()].sort((a, b) => a - b);
  return lines.flatMap((line) => {
    const { conditions, covered: hit } = branches.get(line);
    return Array.from({ length: conditions }, (_, index) => `BRDA:${line},0,${index},${index < hit ? 1 : 0}`);
  });
}

const sum = (values) => values.reduce((total, value) => total + value, 0);

function render(path, { lines, branches, functions, hits }) {
  const names = [...functions.keys()];
  return [
    "TN:",
    `SF:${path}`,
    ...names.map((name) => `FN:${functions.get(name)},${name}`),
    ...names.map((name) => `FNDA:${hits.get(name) ?? 0},${name}`),
    `FNF:${names.length}`,
    `FNH:${covered(names.map((name) => hits.get(name) ?? 0))}`,
    ...renderBranches(branches),
    `BRF:${sum([...branches.values()].map((counts) => counts.conditions))}`,
    `BRH:${sum([...branches.values()].map((counts) => counts.covered))}`,
    ...[...lines.keys()].sort((a, b) => a - b).map((line) => `DA:${line},${lines.get(line)}`),
    `LF:${lines.size}`,
    `LH:${covered(lines.values())}`,
    "end_of_record"
  ];
}

export function mergeLcov(reports) {
  const files = new Map();
  for (const report of reports) parse(report, files);
  const output = [...files.keys()].sort(byCodeUnit).flatMap((path) => render(path, files.get(path)));
  return output.length === 0 ? "" : `${output.join("\n")}\n`;
}
