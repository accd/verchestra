import { readFile, readdir, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { compile } from "json-schema-to-typescript";
import { format } from "prettier";

const root = new URL("../schemas/", import.meta.url);
const output = new URL("../packages/contracts/src/generated.ts", import.meta.url);
let generated = "// Generated from canonical JSON Schemas. Do not edit.\n\n";
const SCHEMA_FILE = /^([1-9]\d{0,5})\.schema\.json$/u;

// invariant: a contract's versions compile in ascending order after one
// another, so adding version n+1 appends its type and leaves the output of
// every earlier version byte for byte where it was.
async function schemaVersions(name) {
  return (await readdir(new URL(`${name}/`, root)))
    .map((file) => SCHEMA_FILE.exec(file)?.[1])
    .filter((version) => version !== undefined)
    .map(Number)
    .sort((left, right) => left - right);
}

const schemas = [];
const previousVersion = new Map();
for (const directory of (await readdir(root, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .sort((a, b) => a.name.localeCompare(b.name))) {
  let previous;
  for (const version of await schemaVersions(directory.name)) {
    const schema = JSON.parse(await readFile(new URL(`${directory.name}/${version}.schema.json`, root), "utf8"));
    if (previous !== undefined) previousVersion.set(schema, previous);
    schemas.push(schema);
    previous = schema;
  }
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
// invariant: a member whose schema is identical to the same member of the
// previous version is typed as that version's member, so a later version
// restates only what it changes and the two types cannot drift apart.
function sharedWithPrevious(schema) {
  const previous = previousVersion.get(schema);
  if (previous === undefined) return schema;
  const properties = Object.fromEntries(
    Object.entries(schema.properties ?? {}).map(([key, member]) =>
      isDeepStrictEqual(member, previous.properties?.[key])
        ? [key, { tsType: `${previous.title}[${JSON.stringify(key)}]` }]
        : [key, member]
    )
  );
  return { ...schema, properties };
}
for (const schema of schemas) {
  generated += await compile(dereference(sharedWithPrevious(schema)), schema.title, {
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
