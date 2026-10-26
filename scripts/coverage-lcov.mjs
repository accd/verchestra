// Merges the per-scope LCOV reports `test-scope.mjs` writes under
// VES_COVERAGE_DIR into the single report SonarCloud imports.
//
// invariant: a line, branch or function counts as covered when any scope
// covered it, so hits are summed per file across every report. Paths are
// normalised to forward slashes because SonarCloud resolves them against the
// repository on Linux, and a Windows run writes backslashes.

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
  BRDA(file, value) {
    const [line, block, branch, taken] = value.split(",");
    add(file.branches, `${line},${block},${branch}`, taken === "-" ? 0 : Number(taken));
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

function parse(report, files) {
  let file;
  for (const raw of report.split(/\r?\n/u)) {
    const separator = raw.indexOf(":");
    const tag = separator === -1 ? raw.trim() : raw.slice(0, separator);
    const value = raw.slice(separator + 1);
    if (tag === "SF") {
      const path = value.replaceAll("\\", "/");
      if (!files.has(path))
        files.set(path, { lines: new Map(), branches: new Map(), functions: new Map(), hits: new Map() });
      file = files.get(path);
    } else if (tag === "end_of_record") file = undefined;
    else if (file && Object.hasOwn(ENTRIES, tag)) ENTRIES[tag](file, value);
  }
}

function byBranchPosition(left, right) {
  const [a, b] = [left.split(",").map(Number), right.split(",").map(Number)];
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function render(path, { lines, branches, functions, hits }) {
  const names = [...functions.keys()];
  return [
    "TN:",
    `SF:${path}`,
    ...names.map((name) => `FN:${functions.get(name)},${name}`),
    ...names.map((name) => `FNDA:${hits.get(name) ?? 0},${name}`),
    `FNF:${names.length}`,
    `FNH:${covered(names.map((name) => hits.get(name) ?? 0))}`,
    ...[...branches.keys()].sort(byBranchPosition).map((key) => `BRDA:${key},${branches.get(key)}`),
    `BRF:${branches.size}`,
    `BRH:${covered(branches.values())}`,
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
