import { readdir, readFile } from "node:fs/promises";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";

function contractError(code: string, schema: string, message: string): Error {
  return Object.assign(new Error(message), { code, schema });
}

export class SchemaRegistry {
  readonly #validators = new Map<string, ValidateFunction>();

  static async load(root: URL): Promise<SchemaRegistry> {
    const registry = new SchemaRegistry();
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    const schemas: object[] = [];
    for (const directory of await readdir(root, { withFileTypes: true })) {
      if (!directory.isDirectory()) continue;
      for (const file of await readdir(new URL(`${directory.name}/`, root))) {
        if (file.endsWith(".schema.json"))
          schemas.push(JSON.parse(await readFile(new URL(`${directory.name}/${file}`, root), "utf8")) as object);
      }
    }
    for (const schema of schemas) ajv.addSchema(schema);
    for (const schema of schemas) {
      const id = (schema as { $id: string }).$id;
      const key = id.slice("ves://".length).replace("/", "@");
      const validator = ajv.getSchema(id);
      if (!validator) throw contractError("VES_SCHEMA_COMPILE_FAILED", key, "declared schema did not compile");
      registry.#validators.set(key, validator);
    }
    return registry;
  }

  list(): string[] {
    return [...this.#validators.keys()].sort();
  }

  validate<T>(name: string, version: string, value: T): T {
    const key = `${name}@${version}`;
    const validator = this.#validators.get(key);
    if (!validator) {
      const hasName = this.list().some((entry) => entry.startsWith(`${name}@`));
      throw contractError(
        hasName ? "VES_SCHEMA_VERSION_UNSUPPORTED" : "VES_SCHEMA_UNKNOWN",
        key,
        "schema is not registered"
      );
    }
    if (!validator(value))
      throw contractError("VES_SCHEMA_VALIDATION_FAILED", key, "value does not match canonical schema");
    return value;
  }

  negotiate(name: string, offered: string[]): string {
    const supported = this.list()
      .filter((entry) => entry.startsWith(`${name}@`))
      .map((entry) => entry.split("@")[1]);
    const selected = offered.filter((version) => supported.includes(version)).sort((a, b) => Number(b) - Number(a))[0];
    if (!selected) throw contractError("VES_SCHEMA_NEGOTIATION_FAILED", name, "no mutually supported schema version");
    return selected;
  }
}
