import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import {
  DatabaseProbeError,
  normalizeDatabaseAccessPolicy,
  normalizeDatabaseRegistration
} from "@verchestra/data-probe";
import { codeUnitCompare } from "@verchestra/domain";
import { isValidLogicalSecretName } from "@verchestra/platform-node";

import { cliError } from "../cli-errors.ts";
import type { DatabaseRegistrationDocument } from "./database-registration-file.ts";

// invariant: door 3. A definition is at most 64 KiB of JSON with exactly these
// keys; the CLI supplies the Workspace id and the policy reference, so an
// owner never writes a derived value.
const MAXIMUM_DEFINITION_BYTES = 64 * 1024;
const keyList = (keys: readonly string[]): string => [...keys].sort(codeUnitCompare).join(",");
const DEFINITION_KEYS = keyList(["schemaVersion", "database", "policy"]);
const DATABASE_KEYS = keyList([
  "databaseId",
  "engine",
  "logicalEnvironment",
  "classification",
  "approvedSchemas",
  "schemaSourceRefs",
  "allowedPurposes",
  "logicalCredentialName",
  "production"
]);
const POLICY_KEYS = keyList([
  "allowedObjects",
  "allowedFunctions",
  "deniedFunctions",
  "allowCatalogAccess",
  "maxTimeoutMs",
  "maxRows",
  "maxBytes",
  "maxConcurrency"
]);

type Row = Readonly<Record<string, unknown>>;

// why: the definition as an owner wrote it, judged only for its shape; its
// values are judged by the registration and policy normalizers.
export interface DatabaseDefinition {
  readonly database: Row;
  readonly policy: Row;
}

function refused(message: string): never {
  throw cliError("VES_CLI_ARGUMENT_INVALID", { argument: "--definition" }, message);
}

function hasKeys(value: unknown, keys: string): value is Row {
  return value !== null && typeof value === "object" && !Array.isArray(value) && keyList(Object.keys(value)) === keys;
}

async function definitionText(controlRoot: string, path: string): Promise<string> {
  const target = isAbsolute(path) ? path : resolve(controlRoot, path);
  const metadata = await lstat(target).catch(() => undefined);
  if (metadata?.isFile() !== true || metadata.size > MAXIMUM_DEFINITION_BYTES)
    refused("--definition names no regular file of at most 64 KiB");
  return readFile(target, "utf8").catch(() => refused("--definition is unreadable"));
}

// invariant: AC 4. A file that is missing, larger than 64 KiB, not JSON, or
// not exactly a definition is an argument error (exit 2), refused before the
// Workspace is opened.
export async function readDefinition(controlRoot: string, path: string): Promise<DatabaseDefinition> {
  const text = await definitionText(controlRoot, path);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    refused("--definition is not JSON");
  }
  if (!hasKeys(value, DEFINITION_KEYS) || value["schemaVersion"] !== 1)
    refused("--definition is not a database definition");
  const database = value["database"];
  const policy = value["policy"];
  if (!hasKeys(database, DATABASE_KEYS) || !hasKeys(policy, POLICY_KEYS))
    refused("--definition is not a database definition");
  return Object.freeze({ database, policy });
}

// invariant: AC 1, AC 2, AC 3 and AC 5. The registration and its policy are
// normalized exactly as a probe plan normalizes them, with this Workspace's
// id and the database id as the policy reference, and the logical credential
// is a name `vestra secret set` accepts.
export function registrationDocument(
  definition: DatabaseDefinition,
  workspaceId: string,
  registeredAt: string
): DatabaseRegistrationDocument {
  const databaseId = definition.database["databaseId"];
  const registration = normalizeDatabaseRegistration({
    schemaVersion: 1,
    workspaceId,
    ...definition.database,
    policyRef: databaseId
  });
  if (!isValidLogicalSecretName(registration.logicalCredentialName))
    throw new DatabaseProbeError(
      "VES_DATABASE_REGISTRATION_INVALID",
      "Logical credential name is not a name vestra secret set accepts"
    );
  const policy = normalizeDatabaseAccessPolicy({ ...definition.policy, policyRef: databaseId });
  return Object.freeze({ registration, policy, registeredAt });
}
