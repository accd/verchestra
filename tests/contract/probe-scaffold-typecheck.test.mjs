import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

import { ESLint } from "eslint";
import * as prettier from "prettier";

import { PROBE_SCAFFOLD_ENGINES } from "../../packages/workspace/src/index.ts";
import { writeProbeScaffolds } from "../helpers/probe-scaffold-fixture.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TSC = join(ROOT, "node_modules", "typescript", "bin", "tsc");
const FILES = ["conformance-kit.mts", "conformance.test.mts", "connection.mts", "contract.mts"];

// #234: the published type each vendored contract type must be identical to.
// Each name is declared under the same name by that engine's contract.mts.
const PUBLISHED_TYPES = Object.freeze({
  postgresql: [
    "PostgreSqlConnectionPort",
    "PostgreSqlPlan",
    "PostgreSqlPrincipalObservation",
    "PostgreSqlReadOperation"
  ],
  mysql: ["FamilyConnectionPort", "FamilyPlan", "MySqlFamilyPrincipalObservation", "MySqlFamilyOperation"],
  mariadb: ["FamilyConnectionPort", "FamilyPlan", "MySqlFamilyPrincipalObservation", "MySqlFamilyOperation"],
  sqlserver: ["SqlServerConnectionPort", "SqlServerConnectionPlan", "SqlServerObservation", "SqlServerOperation"],
  "sap-ase": ["SapAseConnectionPort", "SapAsePlan", "SapAsePrincipalObservation", "SapAseOperation"],
  oracle: ["OracleConnectionPort", "OracleConnectionPlan", "OracleObservation", "OracleOperation"],
  sqlite: [
    "SqliteConnectionPort",
    "SqliteConnectionPlan",
    "SqliteObservation",
    "SqliteSessionObservation",
    "SqliteOperation",
    "SqliteObject"
  ],
  mongodb: [
    "MongoDbConnectionPort",
    "MongoDbConnectionPlan",
    "MongoDbObservation",
    "MongoDbSessionObservation",
    "MongoDbOperation",
    "MongoDbRole"
  ]
});

// Mirrors the repository's own strictness, with NodeNext resolution so the
// .mts files are checked as the ES modules Node runs them as.
function tsconfig() {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2024",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        allowImportingTsExtensions: true,
        erasableSyntaxOnly: true,
        types: ["node"],
        typeRoots: [join(ROOT, "node_modules", "@types")],
        strict: true,
        noEmit: true,
        isolatedModules: true,
        verbatimModuleSyntax: true,
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        noImplicitOverride: true,
        noPropertyAccessFromIndexSignature: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        skipLibCheck: false
      },
      include: [".verchestra/**/*.mts", "contract-identity.mts"]
    },
    null,
    2
  )}\n`;
}

function identityFile() {
  const published = join(ROOT, "packages", "data-probe", "src", "index.ts");
  const lines = [
    `import type * as Published from ${JSON.stringify(published)};`,
    ...PROBE_SCAFFOLD_ENGINES.map(
      (engine, index) => `import type * as Engine${index} from "./.verchestra/probes/${engine}/contract.mts";`
    ),
    "type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;",
    "type Identical<T extends true> = T;",
    "export type Checks = ["
  ];
  PROBE_SCAFFOLD_ENGINES.forEach((engine, index) => {
    for (const name of PUBLISHED_TYPES[engine])
      lines.push(`  Identical<Equals<Published.${name}, Engine${index}.${name}>>,`);
  });
  lines.push("];", "");
  return lines.join("\n");
}

function typecheck(root) {
  const result = spawnSync(process.execPath, [TSC, "-p", join(root, "tsconfig.json"), "--pretty", "false"], {
    cwd: root,
    encoding: "utf8"
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

let scaffolds;
before(async () => {
  scaffolds = await writeProbeScaffolds();
  await writeFile(join(scaffolds.root, "tsconfig.json"), tsconfig(), "utf8");
  await writeFile(join(scaffolds.root, "contract-identity.mts"), identityFile(), "utf8");
});
after(async () => {
  await scaffolds?.cleanup();
});

test("every engine's scaffold typechecks as generated, and each vendored contract type is identical to the published one", () => {
  const { status, output } = typecheck(scaffolds.root);
  assert.equal(output, "");
  assert.equal(status, 0);
});

test("the contract identity check fails when a vendored contract drifts from the published port", async () => {
  const path = join(scaffolds.directory("postgresql"), "contract.mts");
  const original = await readFile(path, "utf8");
  const drifted = original.replace("readonly writePrivilegeCount: number;", "readonly writePrivilegeCount?: number;");
  assert.notEqual(drifted, original);
  await writeFile(path, drifted, "utf8");
  try {
    const { status, output } = typecheck(scaffolds.root);
    assert.notEqual(status, 0);
    assert.match(output, /contract-identity\.mts\(\d+,\d+\): error TS2344/u);
    assert.doesNotMatch(output, /\.verchestra\/probes/u);
  } finally {
    await writeFile(path, original, "utf8");
  }
});

test("every generated TypeScript file passes the repository's ESLint configuration", async () => {
  const eslint = new ESLint({ cwd: ROOT, overrideConfigFile: join(ROOT, "eslint.config.mjs") });
  const lint = async (text, name) => {
    const [result] = await eslint.lintText(text, {
      filePath: join(ROOT, "packages", "workspace", "src", "probe-scaffold-lint", name)
    });
    return result.messages.map((message) => `${name}:${message.line} ${message.ruleId} ${message.message}`);
  };
  // Proves the rules actually run on a generated .mts path, so an empty
  // result below is evidence rather than an unlinted file.
  assert.deepEqual(
    (await lint("export const value: any = 1;\n", "sensor.mts")).map((entry) => entry.split(" ")[1]),
    ["@typescript-eslint/no-explicit-any"]
  );
  const findings = [];
  for (const engine of PROBE_SCAFFOLD_ENGINES) {
    for (const file of FILES) {
      const text = await readFile(join(scaffolds.directory(engine), file), "utf8");
      findings.push(...(await lint(text, `${engine}/${file}`)));
    }
  }
  assert.deepEqual(findings, []);
});

test("every generated file is already in the repository's Prettier format", async () => {
  const config = await prettier.resolveConfig(join(ROOT, "package.json"));
  const unformatted = [];
  for (const engine of PROBE_SCAFFOLD_ENGINES) {
    for (const file of [...FILES, "README.md"]) {
      const path = join(scaffolds.directory(engine), file);
      const text = await readFile(path, "utf8");
      if (!(await prettier.check(text, { ...config, filepath: path })))
        unformatted.push(relative(scaffolds.root, path));
    }
  }
  assert.deepEqual(unformatted, []);
});
