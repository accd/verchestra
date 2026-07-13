export const digest = "sha256:" + "a".repeat(64);
export const now = "2026-07-13T20:00:00.000Z";

export function intake(overrides = {}) {
  const sections = Object.fromEntries(
    [
      "stack",
      "applications",
      "buildCommands",
      "testCommands",
      "architectureSources",
      "projectBoundaries",
      "trackers",
      "knowledgeSources",
      "databaseRegistrations",
      "aiArtifacts"
    ].map((name) => [
      name,
      { value: [`${name}-value`], provenance: [{ sourceId: "repo-source", revision: "rev-1", digest }] }
    ])
  );
  return {
    projectId: "project_app",
    projectClass: "typescript-service",
    documentation: { present: true, reliable: true, stale: false },
    sections,
    ...overrides
  };
}

export function request(overrides = {}) {
  return {
    projectId: "project_app",
    projectClass: "typescript-service",
    documentation: { present: true, reliable: true, stale: false },
    policy: { reversaAllowed: true, codeNaviAllowed: true },
    evaluatedAt: now,
    ...overrides
  };
}

export function qualification(strategy, overrides = {}) {
  return {
    strategy,
    status: "qualified",
    projectClasses: ["typescript-service"],
    benefit: "positive",
    evidenceDigest: digest,
    expiresAt: "2026-08-13T20:00:00.000Z",
    ...overrides
  };
}

export function output(overrides = {}) {
  return {
    strategy: "reversa",
    generatedAt: now,
    capabilities: ["read", "search"],
    lifecycleOwners: [],
    persistentPaths: [],
    anchors: [
      {
        id: "anchor_src",
        projectId: "project_app",
        logicalPath: "src/app.ts",
        startLine: 1,
        endLine: 10,
        contentDigest: digest
      }
    ],
    evidence: [
      {
        id: "evidence_repo",
        content: "untrusted repository content",
        anchorIds: ["anchor_src"],
        source: {
          identity: "repo-source",
          revision: "rev-1",
          retrievedAt: now,
          classification: "internal",
          contentDigest: digest
        }
      }
    ],
    findings: [{ id: "finding_one", status: "available", detail: "explicit evidence", sourceIds: ["evidence_repo"] }],
    ...overrides
  };
}
