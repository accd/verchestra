import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  buildDatabaseKnowledgePackage,
  importDdlSchemaSource,
  planSyntheticSeedScenarios,
  promoteProbeEvidence,
  resolveDatabaseContradiction
} from "../../packages/data-probe/src/database-knowledge.ts";
import {
  databaseId,
  probePromotion,
  schemaSource,
  seedInput,
  workspaceId
} from "../helpers/database-knowledge-fixture.mjs";

const knowledge = () =>
  buildDatabaseKnowledgePackage({
    schemaVersion: 1,
    workspaceId,
    databaseId,
    generation: 1,
    sources: [importDdlSchemaSource(schemaSource())]
  });

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
}

function promotedDigest(evidence) {
  const material = Object.fromEntries(Object.entries(evidence).filter(([key]) => key !== "evidenceDigest"));
  return `sha256:${createHash("sha256").update(canonical(material)).digest("hex")}`;
}
for (const [label, mutation, code] of [
  [
    "credential",
    (input) => {
      input.password = "secret";
    },
    "VES_DATABASE_SCHEMA_SOURCE_INVALID"
  ],
  [
    "raw rows",
    (input) => {
      input.rows = [{ customer: "Alice" }];
    },
    "VES_DATABASE_SCHEMA_SOURCE_INVALID"
  ],
  [
    "connection string",
    (input) => {
      input.connectionString = "mongodb://user:pass@host";
    },
    "VES_DATABASE_SCHEMA_SOURCE_INVALID"
  ],
  [
    "foreign database",
    (input) => {
      input.databaseId = "../other";
    },
    "VES_DATABASE_SCHEMA_SOURCE_INVALID"
  ],
  [
    "unsafe logical ref",
    (input) => {
      input.logicalRef = "https://user:pass@example.test/db";
    },
    "VES_DATABASE_SCHEMA_SOURCE_INVALID"
  ],
  [
    "unsafe entity",
    (input) => {
      input.entities[0].name = "orders;drop";
    },
    "VES_DATABASE_SCHEMA_SOURCE_INVALID"
  ],
  [
    "unsafe column",
    (input) => {
      input.entities[0].columns[0].name = "$where";
    },
    "VES_DATABASE_SCHEMA_SOURCE_INVALID"
  ]
])
  test(`schema importer rejects ${label}`, () => {
    const input = schemaSource();
    mutation(input);
    assert.throws(() => importDdlSchemaSource(input), { code });
  });

test("kind-specific importer rejects a forged source kind", () =>
  assert.throws(() => importDdlSchemaSource(schemaSource("orm")), { code: "VES_DATABASE_SCHEMA_SOURCE_KIND_INVALID" }));
test("knowledge package rejects duplicate source identity with different evidence", () => {
  const left = importDdlSchemaSource(schemaSource());
  const changed = schemaSource();
  changed.entities[0].columns[1].dataType = "text";
  const right = importDdlSchemaSource(changed);
  assert.throws(
    () =>
      buildDatabaseKnowledgePackage({
        schemaVersion: 1,
        workspaceId,
        databaseId,
        generation: 1,
        sources: [left, right]
      }),
    { code: "VES_DATABASE_SCHEMA_SOURCE_CONFLICT" }
  );
});
test("knowledge package rejects a forged source whose content no longer matches its digest", () => {
  const forged = structuredClone(importDdlSchemaSource(schemaSource()));
  forged.entities[0].columns[1].dataType = "text";
  assert.throws(
    () =>
      buildDatabaseKnowledgePackage({ schemaVersion: 1, workspaceId, databaseId, generation: 1, sources: [forged] }),
    { code: "VES_DATABASE_KNOWLEDGE_INVALID" }
  );
});
test("contradiction cannot resolve without human review", () => {
  const changed = schemaSource();
  changed.entities[0].columns[1].dataType = "text";
  changed.sourceId = "ddl-orders-v2";
  const unresolved = buildDatabaseKnowledgePackage({
    schemaVersion: 1,
    workspaceId,
    databaseId,
    generation: 1,
    sources: [importDdlSchemaSource(schemaSource()), importDdlSchemaSource(changed)]
  });
  const contradiction = unresolved.contradictions[0];
  assert.throws(
    () =>
      resolveDatabaseContradiction(unresolved, {
        contradictionId: contradiction.contradictionId,
        selectedValueDigest: contradiction.alternatives[0].valueDigest,
        humanReviewRef: "",
        resolvedAt: "2026-07-13T13:00:00.000Z"
      }),
    { code: "VES_DATABASE_CONTRADICTION_RESOLUTION_INVALID" }
  );
});

for (const [label, mutation, code] of [
  [
    "top-level rows",
    (input) => {
      input.rows = [{ email: "alice@example.test" }];
    },
    "VES_PROBE_PROMOTION_INVALID"
  ],
  [
    "nested result rows",
    (input) => {
      input.result.rows = [{ email: "alice@example.test" }];
    },
    "VES_PROBE_PROMOTION_INVALID"
  ],
  [
    "missing human review",
    (input) => {
      input.redaction.humanReviewRef = "";
    },
    "VES_PROBE_PROMOTION_INVALID"
  ],
  [
    "unsanitized method",
    (input) => {
      input.redaction.method = "none";
    },
    "VES_PROBE_PROMOTION_INVALID"
  ],
  [
    "secret claim",
    (input) => {
      input.sanitizedClaims[0].classification = "secret";
    },
    "VES_PROBE_PROMOTION_INVALID"
  ],
  [
    "credential claim key",
    (input) => {
      input.sanitizedClaims[0].factKey = "database.password";
    },
    "VES_PROBE_PROMOTION_INVALID"
  ],
  [
    "email claim value",
    (input) => {
      input.sanitizedClaims[0].value = "alice@example.test";
    },
    "VES_PROBE_PROMOTION_INVALID"
  ],
  [
    "adversarial email-shaped claim value",
    (input) => {
      input.sanitizedClaims[0].value = `${"a".repeat(200)}@example.test`;
    },
    "VES_PROBE_PROMOTION_INVALID"
  ],
  [
    "credential claim value",
    (input) => {
      input.sanitizedClaims[0].value = "password=not-portable";
    },
    "VES_PROBE_PROMOTION_INVALID"
  ],
  [
    "token claim value",
    (input) => {
      input.sanitizedClaims[0].value = "Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature";
    },
    "VES_PROBE_PROMOTION_INVALID"
  ],
  [
    "bare API token claim value",
    (input) => {
      input.sanitizedClaims[0].value = "ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCDE";
    },
    "VES_PROBE_PROMOTION_INVALID"
  ],
  [
    "connection string claim value",
    (input) => {
      input.sanitizedClaims[0].value = "postgresql://user:password@example.test/orders";
    },
    "VES_PROBE_PROMOTION_INVALID"
  ],
  [
    "private key claim value",
    (input) => {
      input.sanitizedClaims[0].value = "-----BEGIN PRIVATE KEY-----";
    },
    "VES_PROBE_PROMOTION_INVALID"
  ],
  [
    "oversized claim value",
    (input) => {
      input.sanitizedClaims[0].value = "a".repeat(513);
    },
    "VES_PROBE_PROMOTION_INVALID"
  ]
])
  test(`Probe promotion rejects ${label}`, () => {
    const input = probePromotion();
    mutation(input);
    assert.throws(() => promoteProbeEvidence(input), { code });
  });

for (const [label, mutate] of [
  [
    "raw production rows",
    (input) => {
      input.productionRows = [{ id: "real-customer" }];
    }
  ],
  [
    "production fixture",
    (input) => {
      input.fixtures[0].origin = "production";
      input.fixtures[0].containsProductionData = true;
    }
  ],
  [
    "literal factory value",
    (input) => {
      input.factories[0].generators.status = "literal:paid";
    }
  ],
  [
    "foreign factory entity",
    (input) => {
      input.factories[0].entity = "public.customers";
    }
  ],
  [
    "unapproved evidence",
    (input) => {
      input.policy.allowedEvidenceDigests = [];
    }
  ]
])
  test(`seed planner rejects ${label}`, () => {
    const evidence = promoteProbeEvidence(probePromotion());
    const input = seedInput(knowledge(), [evidence]);
    mutate(input);
    assert.throws(() => planSyntheticSeedScenarios(input), { code: "VES_SEED_PLAN_INVALID" });
  });
test("seed plan cannot serialize protected result references or raw production values", () => {
  const evidence = promoteProbeEvidence(probePromotion());
  const serialized = JSON.stringify(planSyntheticSeedScenarios(seedInput(knowledge(), [evidence])));
  assert.equal(serialized.includes("protected-result"), false);
  assert.equal(serialized.includes("alice@example.test"), false);
});
test("seed planner rejects sanitized evidence whose accepted content was altered", () => {
  const forged = structuredClone(promoteProbeEvidence(probePromotion()));
  forged.sanitizedClaims[0].valueDigest = `sha256:${"f".repeat(64)}`;
  const input = seedInput(knowledge(), [forged]);
  assert.throws(() => planSyntheticSeedScenarios(input), { code: "VES_SEED_PLAN_INVALID" });
});
test("seed planner rejects evidence that restores a raw claim field", () => {
  const forged = structuredClone(promoteProbeEvidence(probePromotion()));
  delete forged.sanitizedClaims[0].valueDigest;
  forged.sanitizedClaims[0].value = "alice@example.test";
  forged.evidenceDigest = promotedDigest(forged);
  const input = seedInput(knowledge(), [forged]);
  assert.throws(() => planSyntheticSeedScenarios(input), { code: "VES_SEED_PLAN_INVALID" });
});
test("seed planner rejects a recomputed legacy promoted-evidence version", () => {
  const forged = structuredClone(promoteProbeEvidence(probePromotion()));
  forged.schemaVersion = 1;
  forged.evidenceDigest = promotedDigest(forged);
  assert.throws(() => planSyntheticSeedScenarios(seedInput(knowledge(), [forged])), { code: "VES_SEED_PLAN_INVALID" });
});
