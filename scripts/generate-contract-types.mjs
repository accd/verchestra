import { readFile, readdir, writeFile } from "node:fs/promises";
import { compile } from "json-schema-to-typescript";
import { format } from "prettier";

const root = new URL("../schemas/", import.meta.url);
const output = new URL("../packages/contracts/src/generated.ts", import.meta.url);
let generated = "// Generated from canonical JSON Schemas. Do not edit.\n\n";
const schemas = [];
for (const directory of (await readdir(root, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .sort((a, b) => a.name.localeCompare(b.name))) {
  schemas.push(JSON.parse(await readFile(new URL(`${directory.name}/1.schema.json`, root), "utf8")));
}
const byId = new Map(schemas.map((schema) => [schema.$id, schema]));
function dereference(value) {
  if (Array.isArray(value)) return value.map(dereference);
  if (!value || typeof value !== "object") return value;
  if (typeof value.$ref === "string" && byId.has(value.$ref)) {
    const target = structuredClone(byId.get(value.$ref));
    delete target.$schema;
    delete target.$id;
    delete target.title;
    return dereference(target);
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, dereference(entry)]));
}
for (const schema of schemas) {
  generated += await compile(dereference(schema), schema.title, {
    bannerComment: "",
    format: true,
    style: { singleQuote: false },
    unknownAny: true
  });
  generated += "\n";
}
generated = await format(generated, {
  parser: "typescript",
  printWidth: 120,
  semi: true,
  singleQuote: false,
  trailingComma: "none"
});
if (process.argv.includes("--check")) {
  const current = await readFile(output, "utf8").catch(() => "");
  if (current !== generated) {
    process.stderr.write("generated contract drift detected\n");
    process.exit(1);
  }
  process.stdout.write("generated contracts are current\n");
} else {
  await writeFile(output, generated);
}
