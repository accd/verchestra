import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

const qualificationEvidenceItems = Array.from({ length: 68 }, (_, index) => {
  const task = String(index + 1).padStart(2, "0");
  return { label: `T${task} validation`, slug: `docs/qualification/t${task}-validation` };
});

export default defineConfig({
  site: "https://accd.github.io",
  base: "/verchestra",
  output: "static",
  trailingSlash: "always",
  integrations: [
    sitemap(),
    starlight({
      title: "Verchestra",
      description: "Verified AI software delivery that survives the model, the machine, and the handoff.",
      customCss: ["./src/styles/global.css"],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/accd/verchestra"
        }
      ],
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Overview", slug: "docs" },
            { label: "Why Verchestra", slug: "docs/why-verchestra" },
            { label: "Current qualification status", slug: "docs/current-qualification-status" },
            { label: "Develop from source", slug: "docs/develop-from-source" }
          ]
        },
        {
          label: "Workflows",
          items: [
            { label: "First project discovery", slug: "docs/workflows/first-project-discovery" },
            { label: "Feature delivery", slug: "docs/workflows/feature-delivery" },
            { label: "Cross-environment handoff", slug: "docs/workflows/cross-environment-handoff" },
            { label: "Human review", slug: "docs/workflows/human-review" },
            { label: "Monorepo operating modes", slug: "docs/workflows/monorepo-operating-modes" },
            { label: "Read-only database discovery", slug: "docs/workflows/read-only-database-discovery" }
          ]
        },
        {
          label: "Concepts",
          collapsed: true,
          items: [
            { label: "Execution Package", slug: "docs/concepts/execution-package" },
            { label: "Policy and authority", slug: "docs/concepts/policy-and-authority" },
            { label: "Idempotency", slug: "docs/concepts/idempotency" },
            { label: "Evidence and signatures", slug: "docs/concepts/evidence-and-signatures" },
            { label: "Independent verification", slug: "docs/concepts/independent-verification" },
            { label: "Human review", slug: "docs/concepts/human-review" },
            { label: "Hybrid memory", slug: "docs/concepts/hybrid-memory" },
            { label: "Recovery and handoff", slug: "docs/concepts/recovery-and-handoff" }
          ]
        },
        {
          label: "Integrations",
          collapsed: true,
          items: [
            { label: "Claude Code", slug: "docs/integrations/claude-code" },
            { label: "Codex", slug: "docs/integrations/codex" },
            { label: "OpenCode and Qwen", slug: "docs/integrations/opencode-qwen" },
            { label: "Jira and Confluence", slug: "docs/integrations/jira-and-confluence" },
            { label: "Database capability matrix", slug: "docs/integrations/database-capability-matrix" },
            { label: "SAP ASE and Sybase", slug: "docs/integrations/sap-ase-sybase" },
            { label: "PostgreSQL", slug: "docs/integrations/postgresql" },
            { label: "MySQL and MariaDB", slug: "docs/integrations/mysql-mariadb" },
            { label: "SQL Server", slug: "docs/integrations/sql-server" },
            { label: "Oracle", slug: "docs/integrations/oracle" },
            { label: "SQLite", slug: "docs/integrations/sqlite" },
            { label: "MongoDB", slug: "docs/integrations/mongodb" }
          ]
        },
        {
          label: "Architecture",
          collapsed: true,
          items: [
            { label: "System overview", slug: "docs/architecture/system-overview" },
            { label: "Trust boundaries", slug: "docs/architecture/trust-boundaries" },
            { label: "Workspace placement", slug: "docs/architecture/workspace-placement" },
            { label: "Drivers", slug: "docs/architecture/drivers" },
            { label: "Probes", slug: "docs/architecture/probes" },
            { label: "Memory", slug: "docs/architecture/memory" },
            { label: "Evidence", slug: "docs/architecture/evidence" },
            { label: "Distribution", slug: "docs/architecture/distribution" }
          ]
        },
        {
          label: "Qualification",
          collapsed: true,
          items: [
            { label: "Qualification overview", slug: "docs/qualification" },
            {
              label: "T01–T68 evidence",
              collapsed: true,
              items: qualificationEvidenceItems
            },
            {
              label: "Runtime and drivers",
              slug: "docs/qualification/runtime-and-driver-qualification"
            },
            {
              label: "Security and isolation",
              slug: "docs/qualification/security-and-isolation-evidence"
            },
            {
              label: "Supply chain",
              slug: "docs/qualification/supply-chain-qualification"
            }
          ]
        },
        {
          label: "Community",
          collapsed: true,
          items: [{ autogenerate: { directory: "docs/community", collapsed: true } }]
        }
      ]
    })
  ]
});
