import { readFile, writeFile } from "node:fs/promises";

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`missing ${name}`);
  return process.argv[index + 1];
}

const corpus = JSON.parse(await readFile(argument("--corpus"), "utf8"));
const results = corpus.cases.map(({ id, expected }) => ({
  id,
  result:
    process.argv.includes("--invalid") && id === corpus.cases[0].id ? { ...expected, decision: "wrong" } : expected
}));
await writeFile(argument("--output"), `${JSON.stringify({ schemaVersion: 1, results }, null, 2)}\n`);
