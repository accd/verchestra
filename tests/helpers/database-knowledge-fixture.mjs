export const workspaceId = "workspace_018f0b6d-7b1a-7abc-8def-0123456789ab";
export const databaseId = "orders-production";

export function schemaSource(kind = "ddl", overrides = {}) {
  return {
    schemaVersion: 1,
    sourceId: `${kind}-orders-v1`,
    kind,
    databaseId,
    revision: "rev-001",
    capturedAt: "2026-07-13T12:00:00.000Z",
    logicalRef: `repo:db/${kind}/orders-v1`,
    coverage: "complete",
    entities: [
      {
        schema: "public",
        name: "orders",
        type: "table",
        columns: [
          { name: "id", dataType: "uuid", nullable: false, primaryKey: true, unique: true },
          { name: "status", dataType: "varchar", nullable: false, primaryKey: false, unique: false },
          { name: "note", dataType: "varchar", nullable: true, primaryKey: false, unique: false }
        ]
      }
    ],
    ...overrides
  };
}

export function probePromotion(overrides = {}) {
  return {
    schemaVersion: 1,
    result: {
      schemaVersion: 1,
      status: "complete",
      workspaceId,
      databaseId,
      registrationDigest: `sha256:${"1".repeat(64)}`,
      planDigest: `sha256:${"2".repeat(64)}`,
      queryFingerprint: `sha256:${"3".repeat(64)}`,
      grantRef: "capability-grant-001",
      purpose: "schema-discovery",
      classification: "confidential",
      parameterClassifications: ["internal"],
      bounds: { timeoutMs: 2000, rowLimit: 100, byteLimit: 100000, concurrencyLimit: 1 },
      rowCount: 3,
      byteCount: 256,
      protectedResultRef: "protected-result:0000000000000001",
      resultDigest: `sha256:${"4".repeat(64)}`,
      principalFingerprint: `sha256:${"5".repeat(64)}`,
      identityReadOnly: true,
      sessionReadOnly: true,
      producedAt: "2026-07-13T12:30:00.000Z"
    },
    schemaIdentity: { version: "migration-042", fingerprint: `sha256:${"6".repeat(64)}` },
    producingRunId: "run-018f0b6d-7b1a-7abc-8def-0123456789ab",
    redaction: {
      policyRef: "policy.database.orders",
      method: "allowlist",
      removedFields: ["customer_email"],
      humanReviewRef: "human-review-probe-001"
    },
    sanitizedClaims: [
      { factKey: "public.orders.column.status.data_type", value: "varchar", classification: "internal" }
    ],
    ...overrides
  };
}

export function seedInput(knowledgePackage, sanitizedEvidence = [], overrides = {}) {
  return {
    schemaVersion: 1,
    workspaceId,
    databaseId,
    knowledgePackage,
    acceptanceCriteria: [
      {
        requirementId: "VES-ORD-001",
        criterionId: "AC-ORD-001",
        when: "a valid order is submitted",
        then: "the order is persisted",
        shall: "preserve required and unique constraints",
        targets: ["public.orders"]
      }
    ],
    factories: [
      {
        factoryRef: "factory.orders.v1",
        entity: "public.orders",
        origin: "synthetic",
        generators: { id: "uuid", status: "enum", note: "words" }
      }
    ],
    fixtures: [
      {
        fixtureRef: "fixture.orders.boundary.v1",
        entity: "public.orders",
        origin: "synthetic",
        containsProductionData: false,
        digest: `sha256:${"7".repeat(64)}`
      }
    ],
    sanitizedEvidence,
    policy: {
      allowSanitizedEvidence: sanitizedEvidence.length > 0,
      allowedEvidenceDigests: sanitizedEvidence.map((item) => item.evidenceDigest)
    },
    ...overrides
  };
}
