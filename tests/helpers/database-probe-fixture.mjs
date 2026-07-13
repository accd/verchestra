export const workspaceId = "workspace_018f0b6d-7b1a-7abc-8def-0123456789ab";

export function registration(overrides = {}) {
  return {
    schemaVersion: 1,
    workspaceId,
    databaseId: "orders-production",
    engine: "postgresql",
    logicalEnvironment: "production",
    classification: "confidential",
    approvedSchemas: ["analytics", "public"],
    schemaSourceRefs: ["repo:db/migrations", "artifact:orders-er-v3"],
    allowedPurposes: ["incident-analysis", "schema-discovery"],
    logicalCredentialName: "database.orders.readonly",
    production: true,
    policyRef: "policy.database.orders",
    ...overrides
  };
}

export function operation(overrides = {}) {
  return {
    kind: "select",
    statementCount: 1,
    protectedRequestRef: "protected-request:018f0b6d-7b1a-7abc-8def-0123456789ab",
    objects: [{ schema: "public", name: "orders", type: "table" }],
    functions: ["count"],
    parameterClassifications: ["internal"],
    ...overrides
  };
}

export function policy(overrides = {}) {
  return {
    policyRef: "policy.database.orders",
    allowedObjects: ["public.orders", "analytics.order_totals"],
    allowedFunctions: ["avg", "count", "max", "min", "sum"],
    deniedFunctions: ["dblink_connect", "load_extension", "pg_read_file", "sleep"],
    allowCatalogAccess: false,
    maxTimeoutMs: 5_000,
    maxRows: 1_000,
    maxBytes: 1_000_000,
    maxConcurrency: 2,
    ...overrides
  };
}

export function request(overrides = {}) {
  return {
    schemaVersion: 1,
    workspaceId,
    requestId: "probe-request-001",
    databaseId: "orders-production",
    purpose: "schema-discovery",
    operation: operation(),
    bounds: { timeoutMs: 2_000, rowLimit: 100, byteLimit: 100_000, concurrencyLimit: 1 },
    grantRef: "capability-grant-001",
    ...overrides
  };
}

export function adapter(engine = "postgresql", violations = []) {
  return {
    engine,
    calls: 0,
    validateNormalizedOperation() {
      this.calls += 1;
      return violations;
    }
  };
}
