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
  "qualification/supply-chain-qualification.md"
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

test("keeps SAP ASE first-class in the public database matrix", async () => {
  const matrix = await readFile(resolve(docsRoot, "integrations/database-capability-matrix.md"), "utf8");
  const sap = matrix.indexOf("SAP ASE / Sybase");
  const postgres = matrix.indexOf("PostgreSQL");
  assert.ok(sap > -1 && postgres > -1 && sap < postgres);
});
