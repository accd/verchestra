import { createHash } from "node:crypto";

const CLASSIFICATIONS = ["public", "internal", "confidential", "restricted", "secret"] as const;
const DATABASE = /^[a-z][a-z0-9_-]{0,62}$/u;
const COLLECTION = /^[a-z][a-z0-9_-]{0,126}$/u;
const FIELD = /^(?:_id|[a-z][a-z0-9_]*)(?:\.(?:_id|[a-z][a-z0-9_]*))*$/u;
const READ_KINDS = new Set(["find", "aggregate", "explain", "introspect"]);
const WRITE_KINDS = new Set(["insert", "update", "delete", "replace", "findAndModify", "bulkWrite"]);
const COMPARISON_OPERATORS = new Set(["$eq", "$ne", "$gt", "$gte", "$lt", "$lte", "$in"]);
type UnknownRecord = Readonly<Record<string, unknown>>;
type Classification = (typeof CLASSIFICATIONS)[number];

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as UnknownRecord)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
}
function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}
export class MongoDbProbeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "MongoDbProbeError";
    this.code = code;
  }
}
function fail(code: string, message: string): never {
  throw new MongoDbProbeError(code, message);
}
function record(value: unknown, code = "VES_MONGODB_COMMAND_INVALID"): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail(code, "MongoDB command shape is invalid");
  return value as UnknownRecord;
}
function exactKeys(value: UnknownRecord, keys: readonly string[]) {
  if (Object.keys(value).sort().join(",") !== [...keys].sort().join(","))
    fail("VES_MONGODB_COMMAND_INVALID", "MongoDB command shape is invalid");
}
function preflight(value: unknown, depth = 0, state = { nodes: 0 }): void {
  state.nodes += 1;
  if (depth > 16 || state.nodes > 512) fail("VES_MONGODB_COMMAND_INVALID", "MongoDB command exceeds structural bounds");
  if (Array.isArray(value)) {
    if (value.length > 128) fail("VES_MONGODB_COMMAND_INVALID", "MongoDB command exceeds structural bounds");
    for (const item of value) preflight(item, depth + 1, state);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, item] of Object.entries(value as UnknownRecord)) {
    if (key === "$out" || key === "$merge") fail("VES_MONGODB_WRITE_DENIED", "MongoDB write stages are not permitted");
    if (key === "$where" || key === "$function" || key === "$accumulator")
      fail("VES_MONGODB_SERVER_EXECUTION_DENIED", "MongoDB server execution is not permitted");
    preflight(item, depth + 1, state);
  }
}

interface ParseOptions {
  readonly protectedRequestRef: string;
  readonly parameterClassifications: readonly string[];
}
interface MongoDbOperation {
  readonly kind: "select" | "introspect";
  readonly statementCount: 1;
  readonly protectedRequestRef: string;
  readonly objects: readonly { readonly schema: string; readonly name: string; readonly type: "table" | "catalog" }[];
  readonly functions: readonly string[];
  readonly parameterClassifications: readonly Classification[];
}
interface ValidationState {
  readonly parameters: Set<number>;
  readonly functions: Set<string>;
}
function parameter(value: unknown, state: ValidationState) {
  const token = record(value, "VES_MONGODB_LITERAL_DENIED");
  if (
    Object.keys(token).join(",") !== "$param" ||
    !Number.isSafeInteger(token["$param"]) ||
    (token["$param"] as number) < 0 ||
    (token["$param"] as number) > 63
  )
    fail("VES_MONGODB_LITERAL_DENIED", "MongoDB data literals are not permitted");
  state.parameters.add(token["$param"] as number);
}
function filter(value: unknown, state: ValidationState, depth = 0): void {
  if (depth > 12) fail("VES_MONGODB_COMMAND_INVALID", "MongoDB filter exceeds structural bounds");
  const input = record(value);
  for (const [field, conditionValue] of Object.entries(input)) {
    if (field.startsWith("$")) {
      if (field !== "$and" && field !== "$or")
        fail("VES_MONGODB_OPERATOR_DENIED", "MongoDB query operator is not approved");
      if (!Array.isArray(conditionValue) || conditionValue.length === 0 || conditionValue.length > 32)
        fail("VES_MONGODB_COMMAND_INVALID", "MongoDB logical filter is invalid");
      state.functions.add(field.slice(1));
      for (const item of conditionValue) filter(item, state, depth + 1);
      continue;
    }
    if (!FIELD.test(field)) fail("VES_MONGODB_FIELD_DENIED", "MongoDB field is not approved");
    if (typeof conditionValue !== "object" || conditionValue === null || Array.isArray(conditionValue))
      fail("VES_MONGODB_LITERAL_DENIED", "MongoDB data literals are not permitted");
    const condition = conditionValue as UnknownRecord;
    if (Object.keys(condition).length === 0 || Object.keys(condition).length > 4)
      fail("VES_MONGODB_COMMAND_INVALID", "MongoDB field condition is invalid");
    for (const [operator, operand] of Object.entries(condition)) {
      if (operator === "$exists") {
        if (typeof operand !== "boolean") fail("VES_MONGODB_LITERAL_DENIED", "MongoDB exists control is invalid");
      } else {
        if (!COMPARISON_OPERATORS.has(operator))
          fail("VES_MONGODB_OPERATOR_DENIED", "MongoDB query operator is not approved");
        parameter(operand, state);
      }
      state.functions.add(operator.slice(1));
    }
  }
}
function projection(value: unknown) {
  const input = record(value);
  if (Object.keys(input).length === 0 || Object.keys(input).length > 128)
    fail("VES_MONGODB_COMMAND_INVALID", "MongoDB projection is invalid");
  for (const [field, included] of Object.entries(input))
    if (!FIELD.test(field) || (included !== 0 && included !== 1))
      fail("VES_MONGODB_COMMAND_INVALID", "MongoDB projection is invalid");
}
function sort(value: unknown) {
  const input = record(value);
  if (Object.keys(input).length === 0 || Object.keys(input).length > 32)
    fail("VES_MONGODB_COMMAND_INVALID", "MongoDB sort is invalid");
  for (const [field, direction] of Object.entries(input))
    if (!FIELD.test(field) || (direction !== 1 && direction !== -1))
      fail("VES_MONGODB_COMMAND_INVALID", "MongoDB sort is invalid");
}
function pipeline(value: unknown, state: ValidationState) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32)
    fail("VES_MONGODB_COMMAND_INVALID", "MongoDB pipeline is invalid");
  for (const rawStage of value) {
    const stage = record(rawStage);
    if (Object.keys(stage).length !== 1) fail("VES_MONGODB_COMMAND_INVALID", "MongoDB pipeline stage is invalid");
    const [name, body] = Object.entries(stage)[0] as [string, unknown];
    if (name === "$match") filter(body, state);
    else if (name === "$project") projection(body);
    else if (name === "$sort") sort(body);
    else if (name === "$limit") {
      if (!Number.isSafeInteger(body) || (body as number) < 1 || (body as number) > 10_000)
        fail("VES_MONGODB_COMMAND_INVALID", "MongoDB pipeline limit is invalid");
    } else fail("VES_MONGODB_STAGE_DENIED", "MongoDB aggregation stage is not approved");
    state.functions.add(name.slice(1));
  }
}

export function parseMongoDbReadOperation(command: unknown, options: ParseOptions): MongoDbOperation {
  preflight(command);
  const input = record(command);
  const kind = input["kind"];
  if (kind === "mapReduce") fail("VES_MONGODB_SERVER_EXECUTION_DENIED", "MongoDB server execution is not permitted");
  if (typeof kind === "string" && WRITE_KINDS.has(kind))
    fail("VES_MONGODB_WRITE_DENIED", "MongoDB write commands are not permitted");
  if (typeof kind !== "string" || !READ_KINDS.has(kind))
    fail("VES_MONGODB_COMMAND_INVALID", "MongoDB command kind is invalid");
  const database = input["database"];
  const collection = input["collection"];
  if (typeof database !== "string" || !DATABASE.test(database) || ["admin", "config", "local"].includes(database))
    fail("VES_MONGODB_DATABASE_DENIED", "MongoDB database is not approved");
  if (typeof collection !== "string" || !COLLECTION.test(collection) || collection.startsWith("system"))
    fail("VES_MONGODB_COLLECTION_DENIED", "MongoDB collection is not approved");
  if (!/^protected-request:[a-z0-9-]{16,128}$/u.test(options.protectedRequestRef))
    fail("VES_MONGODB_REQUEST_INVALID", "Protected MongoDB request reference is invalid");
  if (
    !Array.isArray(options.parameterClassifications) ||
    options.parameterClassifications.length > 64 ||
    options.parameterClassifications.some((item) => !CLASSIFICATIONS.includes(item as Classification))
  )
    fail("VES_MONGODB_PARAMETERS_INVALID", "MongoDB parameter classifications are invalid");
  const state: ValidationState = { parameters: new Set(), functions: new Set() };
  if (kind === "find") {
    exactKeys(input, ["kind", "database", "collection", "filter", "projection", "sort"]);
    filter(input["filter"], state);
    projection(input["projection"]);
    sort(input["sort"]);
  } else if (kind === "explain") {
    exactKeys(input, ["kind", "database", "collection", "filter", "projection", "sort", "verbosity"]);
    if (input["verbosity"] !== "queryPlanner")
      fail("VES_MONGODB_COMMAND_INVALID", "MongoDB explain verbosity is invalid");
    filter(input["filter"], state);
    projection(input["projection"]);
    sort(input["sort"]);
    state.functions.add("explain");
  } else if (kind === "aggregate") {
    exactKeys(input, ["kind", "database", "collection", "pipeline"]);
    pipeline(input["pipeline"], state);
  } else {
    exactKeys(input, ["kind", "database", "collection"]);
    if (collection !== "collections_catalog")
      fail("VES_MONGODB_COLLECTION_DENIED", "MongoDB introspection collection is not approved");
  }
  const parameters = [...state.parameters].sort((a, b) => a - b);
  if (
    parameters.length !== options.parameterClassifications.length ||
    parameters.some((value, index) => value !== index)
  )
    fail("VES_MONGODB_PARAMETERS_INVALID", "MongoDB parameter references are invalid");
  const catalog = kind === "introspect";
  const objectType: "table" | "catalog" = catalog ? "catalog" : "table";
  return Object.freeze({
    kind: catalog ? "introspect" : "select",
    statementCount: 1,
    protectedRequestRef: options.protectedRequestRef,
    objects: Object.freeze([{ schema: database, name: collection, type: objectType }]),
    functions: Object.freeze([...state.functions].sort()),
    parameterClassifications: Object.freeze([...options.parameterClassifications].sort()) as readonly Classification[]
  });
}

interface Plan {
  readonly databaseId: string;
  readonly planDigest: string;
  readonly operation: MongoDbOperation;
  readonly bounds: { readonly timeoutMs: number; readonly rowLimit: number };
}
interface Role {
  readonly role: string;
  readonly db: string;
}
interface Observation {
  readonly product: string;
  readonly version: string;
  readonly databaseId: string;
  readonly authorizationEnabled: boolean;
  readonly roles: readonly Role[];
  readonly writeActionCount: number;
  readonly adminActionCount: number;
  readonly serverExecutionActionCount: number;
}
interface SessionObservation {
  readonly typedReadSurface: boolean;
  readonly genericCommandDisabled: boolean;
  readonly readConcern: string;
  readonly maxTimeMS: number;
  readonly batchSize: number;
  readonly noCursorTimeout: boolean;
}
interface Connection {
  inspectPrincipal(plan: Plan): Promise<Observation>;
  configureReadOnly(plan: Plan): Promise<SessionObservation>;
  stream(command: UnknownRecord, signal: AbortSignal): AsyncIterable<UnknownRecord>;
  cancel(): Promise<void>;
  terminate(): Promise<void>;
}
function decode(bytes: Uint8Array) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("VES_MONGODB_REQUEST_INVALID", "Protected MongoDB request is invalid");
  }
  const input = record(parsed, "VES_MONGODB_REQUEST_INVALID");
  if (Object.keys(input).sort().join(",") !== "command,parameters,schemaVersion" || input["schemaVersion"] !== 1)
    fail("VES_MONGODB_REQUEST_INVALID", "Protected MongoDB request is invalid");
  if (
    !Array.isArray(input["parameters"]) ||
    input["parameters"].length > 64 ||
    input["parameters"].some(
      (item) => item !== null && !["string", "number", "boolean"].includes(typeof item) && !Array.isArray(item)
    )
  )
    fail("VES_MONGODB_PARAMETERS_INVALID", "Protected MongoDB parameters are invalid");
  return { command: input["command"], parameters: input["parameters"] };
}
function bind(value: unknown, parameters: readonly unknown[]): unknown {
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) return value.map((item) => bind(item, parameters));
  const input = value as UnknownRecord;
  if (Object.keys(input).join(",") === "$param") return structuredClone(parameters[input["$param"] as number]);
  return Object.fromEntries(Object.entries(input).map(([key, item]) => [key, bind(item, parameters)]));
}

export class MongoDbProbeAdapter {
  static readonly component = Object.freeze({ id: "probe-worker:mongodb", digest: `sha256:${"a".repeat(64)}` });
  readonly #connection: Connection;
  constructor(options: { readonly connection: Connection }) {
    this.#connection = options.connection;
  }
  async handshake() {
    return Object.freeze({
      protocol: "verchestra-probe/1",
      supportedSchemas: Object.freeze(["probe.plan/1", "probe.result/1"]),
      component: MongoDbProbeAdapter.component,
      capabilities: Object.freeze(["database-read"]),
      maximumMessageBytes: 65_536
    });
  }
  async verifyIdentity(plan: Plan) {
    const observation = await this.#connection.inspectPrincipal(plan);
    if (observation.product !== "mongodb") fail("VES_MONGODB_PRODUCT_INVALID", "Database product is not MongoDB");
    const database = plan.operation.objects[0]?.schema;
    const principalReadOnly =
      observation.authorizationEnabled &&
      observation.roles.length > 0 &&
      observation.roles.every((role) => role.role === "read" && role.db === database) &&
      observation.writeActionCount === 0 &&
      observation.adminActionCount === 0 &&
      observation.serverExecutionActionCount === 0;
    return Object.freeze({
      databaseId: observation.databaseId,
      product: observation.product,
      version: observation.version,
      principalReadOnly,
      principalFingerprint: digest(observation)
    });
  }
  async configureReadOnlySession(plan: Plan) {
    const observation = await this.#connection.configureReadOnly(plan);
    const readOnly =
      observation.typedReadSurface &&
      observation.genericCommandDisabled &&
      observation.readConcern === "majority" &&
      observation.maxTimeMS === plan.bounds.timeoutMs &&
      observation.batchSize > 0 &&
      observation.batchSize <= plan.bounds.rowLimit &&
      !observation.noCursorTimeout;
    return Object.freeze({ planDigest: plan.planDigest, sessionReadOnly: readOnly, transactionReadOnly: readOnly });
  }
  async *execute(plan: Plan, bytes: Uint8Array, signal: AbortSignal): AsyncIterable<readonly UnknownRecord[]> {
    const request = decode(bytes);
    const operation = parseMongoDbReadOperation(request.command, {
      protectedRequestRef: plan.operation.protectedRequestRef,
      parameterClassifications: plan.operation.parameterClassifications
    });
    if (canonical(operation) !== canonical(plan.operation))
      fail("VES_MONGODB_PLAN_MISMATCH", "Protected MongoDB request differs from the approved plan");
    const references = new Set<number>();
    const collect = (value: unknown): void => {
      if (typeof value !== "object" || value === null) return;
      if (Array.isArray(value)) {
        for (const item of value) collect(item);
        return;
      }
      const input = value as UnknownRecord;
      if (Object.keys(input).join(",") === "$param") references.add(input["$param"] as number);
      else for (const item of Object.values(input)) collect(item);
    };
    collect(request.command);
    if (request.parameters.length !== references.size)
      fail("VES_MONGODB_PARAMETERS_INVALID", "Protected MongoDB parameters do not match references");
    const command = bind(request.command, request.parameters) as UnknownRecord;
    for await (const row of this.#connection.stream(command, signal)) yield Object.freeze([row]);
  }
  async cancel() {
    await this.#connection.cancel();
  }
  async terminate() {
    await this.#connection.terminate();
  }
}

interface FixtureOptions extends Partial<Observation>, Partial<SessionObservation> {
  readonly rows?: readonly UnknownRecord[];
  readonly delayMs?: number;
}
export class MongoDbFixtureConnection implements Connection {
  readonly #options: FixtureOptions;
  controls: SessionObservation | undefined;
  lastCommand: UnknownRecord = {};
  streamCalls = 0;
  cancelled = false;
  terminated = false;
  constructor(options: FixtureOptions = {}) {
    this.#options = options;
  }
  async inspectPrincipal(plan: Plan): Promise<Observation> {
    return {
      product: this.#options.product ?? "mongodb",
      version: this.#options.version ?? "8.0",
      databaseId: this.#options.databaseId ?? plan.databaseId,
      authorizationEnabled: this.#options.authorizationEnabled ?? true,
      roles: this.#options.roles ?? [{ role: "read", db: plan.operation.objects[0]?.schema ?? "" }],
      writeActionCount: this.#options.writeActionCount ?? 0,
      adminActionCount: this.#options.adminActionCount ?? 0,
      serverExecutionActionCount: this.#options.serverExecutionActionCount ?? 0
    };
  }
  async configureReadOnly(plan: Plan): Promise<SessionObservation> {
    this.controls = {
      typedReadSurface: this.#options.typedReadSurface ?? true,
      genericCommandDisabled: this.#options.genericCommandDisabled ?? true,
      readConcern: this.#options.readConcern ?? "majority",
      maxTimeMS: this.#options.maxTimeMS ?? plan.bounds.timeoutMs,
      batchSize: this.#options.batchSize ?? plan.bounds.rowLimit,
      noCursorTimeout: this.#options.noCursorTimeout ?? false
    };
    return this.controls;
  }
  async *stream(command: UnknownRecord, signal: AbortSignal): AsyncIterable<UnknownRecord> {
    this.streamCalls += 1;
    this.lastCommand = structuredClone(command);
    if ((this.#options.delayMs ?? 0) > 0)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.#options.delayMs);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true }
        );
      });
    if (signal.aborted) return;
    for (const row of this.#options.rows ?? [{ id: 1 }]) yield structuredClone(row);
  }
  async cancel() {
    this.cancelled = true;
  }
  async terminate() {
    this.terminated = true;
  }
}
