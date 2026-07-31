import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import { llmArtifactsIntegration } from "./src/lib/llm-content.ts";
import { qualificationSidebarItems } from "./src/lib/repository-content.ts";

// Derived from the reports that actually exist, not from a count. A fixed 68
// silently omitted every inserted task, so a report could be published and
// loaded while being unreachable from the navigation that is supposed to list it.
const qualificationEvidenceItems = qualificationSidebarItems(new URL("../../", import.meta.url));

if (qualificationEvidenceItems.length === 0) throw new Error("no qualification reports found for the sidebar");
const qualificationEvidenceLabel = `${qualificationEvidenceItems[0]!.label.split(" ")[0]}–${qualificationEvidenceItems[qualificationEvidenceItems.length - 1]!.label.split(" ")[0]} evidence`;

export default defineConfig({
  site: "https://accd.github.io",
  base: "/verchestra",
  output: "static",
  build: {
    inlineStylesheets: "always"
  },
  trailingSlash: "always",
  vite: {
    build: {
      chunkSizeWarningLimit: 700
    }
  },
  integrations: [
    sitemap(),
    llmArtifactsIntegration(),
    starlight({
      title: "Verchestra",
      description: "Verified AI software delivery that survives the model, the machine, and the handoff.",
      favicon: "/favicon.png",
      disable404Route: true,
      customCss: ["./src/styles/global.css"],
      components: {
        Head: "./src/components/StarlightHead.astro"
      },
      head: [
        {
          tag: "meta",
          attrs: {
            property: "og:image",
            content: "https://accd.github.io/verchestra/social-card.png"
          }
        },
        {
          tag: "meta",
          attrs: {
            property: "og:image:width",
            content: "1200"
          }
        },
        {
          tag: "meta",
          attrs: {
            property: "og:image:height",
            content: "630"
          }
        },
        {
          tag: "meta",
          attrs: {
            property: "og:image:alt",
            content: "Verchestra verified AI software delivery workflow"
          }
        },
        {
          tag: "meta",
          attrs: {
            name: "twitter:image",
            content: "https://accd.github.io/verchestra/social-card.png"
          }
        }
      ],
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
              label: qualificationEvidenceLabel,
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
          items: [
            { label: "Contributing with agents", slug: "docs/community/contributing-with-agents" },
            { autogenerate: { directory: "docs/community", collapsed: true } }
          ]
        }
      ]
    })
  ]
});
