import type { StatementSync } from "node:sqlite";

// why: runtime-store.ts and effect-repository.ts map SQLite failures onto the
// same public runtime codes. The mapping lives here, behind a type-only
// node:sqlite import, so the effect repository needs neither SQLite nor the
// store module loaded to share it.

export function runtimeError(code: string, message: string, cause?: unknown, recoverable = false): Error {
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code, recoverable });
}

export function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function mapSqliteError(error: unknown): Error {
  const code = errorCode(error);
  if (code === "SQLITE_BUSY" || /database is locked/iu.test(errorMessage(error))) {
    return runtimeError("VES_RUNTIME_BUSY", "Runtime database is busy", error, true);
  }
  if (code?.startsWith("SQLITE_CONSTRAINT") === true || /constraint failed/iu.test(errorMessage(error))) {
    return runtimeError("VES_RUNTIME_CONSTRAINT", "Runtime relational constraint failed", error);
  }
  return error instanceof Error ? error : new Error(String(error));
}

export function runStatement(statement: StatementSync, ...values: readonly (string | number | null)[]): number {
  return Number(statement.run(...values).changes);
}
