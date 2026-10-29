import { argumentRefused, hasKeys, keyList, readArgumentJson } from "../cli-options.ts";

// invariant: door 4 of .specs/features/probe-run/plan.md. A request file is at
// most 64 KiB of JSON with exactly these keys; the CLI supplies the Workspace,
// request and database ids, the protected request reference, the grant
// reference and the normalized operation, so an owner never writes a derived
// value, and the SQL and its parameters never reach a command line.
const MAXIMUM_REQUEST_BYTES = 64 * 1024;
const REQUEST_KEYS = keyList(["schemaVersion", "purpose", "sql", "parameters", "bounds"]);
const BOUNDS_KEYS = keyList(["timeoutMs", "rowLimit", "byteLimit", "concurrencyLimit"]);

// why: the request as an owner wrote it, judged here only for its shape; the
// SQLite parser judges the statement and its parameters, and the planner the
// purpose and the bounds.
export interface ProbeRequestFile {
  readonly purpose: unknown;
  readonly sql: unknown;
  readonly parameters: unknown;
  readonly bounds: Readonly<Record<string, unknown>>;
}

// invariant: AC 13. A file that is missing, larger than 64 KiB, not JSON, or
// not exactly a request is an argument error (exit 2), refused before the
// Workspace is opened.
export async function readProbeRequest(controlRoot: string, path: string): Promise<ProbeRequestFile> {
  const value = await readArgumentJson(controlRoot, path, "--request", MAXIMUM_REQUEST_BYTES);
  if (!hasKeys(value, REQUEST_KEYS) || value["schemaVersion"] !== 1 || !hasKeys(value["bounds"], BOUNDS_KEYS))
    argumentRefused("--request", "--request is not a probe request");
  return Object.freeze({
    purpose: value["purpose"],
    sql: value["sql"],
    parameters: value["parameters"],
    bounds: value["bounds"]
  });
}
