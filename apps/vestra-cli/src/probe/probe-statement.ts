import { randomUUID } from "node:crypto";

import {
  SqliteProbeError,
  parseSqliteReadOperation,
  type DatabaseEngineAdapterPort,
  type DatabaseRegistration,
  type NormalizedReadOperation,
  type ProbeViolation,
  type SqliteOperation
} from "@verchestra/data-probe";
import { canonicalizeJsonV2 } from "@verchestra/domain";

import type { ProbeRequestFile } from "./probe-request.ts";

// invariant: the protected request a SQLite worker decodes holds at most this
// many parameters, each a string, a number, a boolean or null.
const MAXIMUM_PARAMETERS = 64;
type Parameter = string | number | boolean | null;

interface ParseOptions {
  readonly kind: "select";
  readonly protectedRequestRef: string;
  readonly parameterClassifications: readonly string[];
}

// why: what the planner and the worker receive for one request: the
// normalized operation SQLite's parser reads from the statement, the
// protected request the worker decodes (the statement and its parameters,
// which no output carries), and the engine adapter that holds the planner to
// that operation.
export interface SqliteStatement {
  readonly operation: SqliteOperation;
  readonly protectedRequest: Uint8Array;
  readonly adapter: DatabaseEngineAdapterPort;
}

function parametersOf(value: unknown): readonly Parameter[] {
  const scalar = (item: unknown) => item === null || ["string", "number", "boolean"].includes(typeof item);
  if (!Array.isArray(value) || value.length > MAXIMUM_PARAMETERS || !value.every(scalar))
    throw new SqliteProbeError("VES_SQLITE_PARAMETERS_INVALID", "SQLite parameters are invalid");
  return value as readonly Parameter[];
}

// invariant: the SQLite engine adapter the planner consults. It admits only the
// operation SQLite's own parser reads from this statement, every object of it
// in the `main` database, so a plan never names an operation other than the one
// the worker re-reads from the protected statement, and never another database.
export function sqliteEngineAdapter(sql: string, options: ParseOptions): DatabaseEngineAdapterPort {
  return Object.freeze({
    engine: "sqlite" as const,
    validateNormalizedOperation(
      operation: NormalizedReadOperation,
      registration: DatabaseRegistration
    ): readonly ProbeViolation[] {
      const violations: ProbeViolation[] = [];
      if (registration.engine !== "sqlite")
        violations.push({ code: "VES_PROBE_ENGINE_UNAVAILABLE", message: "The registration is not a SQLite one" });
      if (operation.objects.some((object) => object.schema !== "main"))
        violations.push({
          code: "VES_SQLITE_DATABASE_CONTROL_DENIED",
          message: "Only the SQLite main database is read"
        });
      if (canonicalizeJsonV2(parseSqliteReadOperation(sql, options)) !== canonicalizeJsonV2(operation))
        violations.push({ code: "VES_SQLITE_PLAN_MISMATCH", message: "The operation is not the statement's own" });
      return Object.freeze(violations);
    }
  });
}

// invariant: door 4. A request's statement is read as one SQLite select, each
// parameter classified as the database is, under a protected request reference
// of its own; the parser's refusal is the refusal (AC 10).
export function sqliteStatement(request: ProbeRequestFile, registration: DatabaseRegistration): SqliteStatement {
  const parameters = parametersOf(request.parameters);
  const options: ParseOptions = {
    kind: "select",
    protectedRequestRef: `protected-request:${randomUUID()}`,
    parameterClassifications: parameters.map(() => registration.classification)
  };
  const operation = parseSqliteReadOperation(request.sql, options);
  const sql = request.sql as string;
  return Object.freeze({
    operation,
    protectedRequest: new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, sql, parameters })),
    adapter: sqliteEngineAdapter(sql, options)
  });
}
