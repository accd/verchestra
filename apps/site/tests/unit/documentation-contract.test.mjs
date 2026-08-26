import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const siteRoot = resolve(import.meta.dirname, "../..");
const docsRoot = resolve(siteRoot, "src/content/docs/docs");

const requiredGuides = [
  "index.mdx",
  "why-verchestra.md",
  "current-qualification-status.md",
  "install-and-run.md",
  "develop-from-source.md",
  "workflows/first-project-discovery.md",
  "workflows/feature-delivery.md",
  "workflows/cross-environment-handoff.md",
  "workflows/human-review.md",
  "workflows/monorepo-operating-modes.md",
  "workflows/read-only-database-discovery.md",
  "concepts/execution-package.md",
  "concepts/policy-and-authority.md",
  "concepts/idempotency.md",
  "concepts/evidence-and-signatures.md",
  "concepts/independent-verification.md",
  "concepts/human-review.md",
  "concepts/hybrid-memory.md",
  "concepts/recovery-and-handoff.md",
  "integrations/claude-code.md",
  "integrations/codex.md",
  "integrations/opencode-qwen.md",
  "integrations/jira-and-confluence.md",
  "integrations/database-capability-matrix.md",
  "integrations/sap-ase-sybase.md",
  "integrations/postgresql.md",
  "integrations/mysql-mariadb.md",
  "integrations/sql-server.md",
  "integrations/oracle.md",
  "integrations/sqlite.md",
  "integrations/mongodb.md",
  "architecture/trust-boundaries.md",
  "architecture/workspace-placement.md",
  "architecture/drivers.md",
  "architecture/probes.md",
  "architecture/memory.md",
  "architecture/evidence.md",
  "architecture/distribution.md",
  "qualification/index.md",
  "qualification/runtime-and-driver-qualification.md",
  "qualification/security-and-isolation-evidence.md",
  "qualification/supply-chain-qualification.md",
  "community/contributing-with-agents.md"
];

test("publishes every approved site-specific guide with searchable metadata", async () => {
  for (const relativePath of requiredGuides) {
    const source = await readFile(resolve(docsRoot, relativePath), "utf8");
    assert.match(source, /^---\r?\n[\s\S]*?title:\s*.+\r?\n[\s\S]*?description:\s*.+\r?\n---/u, relativePath);
    assert.doesNotMatch(source, /pagefind:\s*false/u, relativePath);
  }
});

test("keeps canonical repository documents out of the site-specific content tree", async () => {
  const forbiddenCopies = ["README.md", "ROADMAP.md", "CONTRIBUTING.md", "SECURITY.md", "docs/architecture.md"];
  for (const relativePath of forbiddenCopies) {
    await assert.rejects(readFile(resolve(docsRoot, relativePath), "utf8"));
  }
});

// Policy changed by AD-017 (owner, 2026-08-09): SQLite leads as the only
// engine this repository live-qualifies itself; every other engine is
// contract-verified here and live-qualified at the edge. The old assertion
// pinned SAP ASE first — that primacy claim is exactly what AD-017 retired.
test("the public database matrix leads with the live-qualified engine and states the edge model", async () => {
  const matrix = await readFile(resolve(docsRoot, "integrations/database-capability-matrix.md"), "utf8");
  const sqlite = matrix.indexOf("| SQLite");
  const sap = matrix.indexOf("SAP ASE / Sybase");
  assert.ok(sqlite > -1 && sap > -1 && sqlite < sap, "SQLite must lead the matrix");
  assert.match(matrix, /Live-qualified.*SQLite only/u, "the matrix must scope the live claim to SQLite");
  assert.match(matrix, /qualifies \*\*at the edge\*\*/u, "the matrix must state the edge-qualification model");
  assert.doesNotMatch(matrix, /\*\*SAP ASE \/ Sybase\*\*/u, "no engine keeps bold primacy in the table");
});
