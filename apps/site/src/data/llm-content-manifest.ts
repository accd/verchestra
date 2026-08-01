export interface LlmRepositorySource {
  sourcePath: string;
  route: string | null;
  section: string;
  order: number;
}

export const llmRepositorySources: readonly LlmRepositorySource[] = [
  { sourcePath: "README.md", route: null, section: "Project", order: 1 },
  { sourcePath: "ROADMAP.md", route: "roadmap", section: "Project", order: 2 },
  { sourcePath: "docs/architecture.md", route: "docs/architecture/system-overview", section: "Architecture", order: 1 },
  {
    sourcePath: "docs/proof/execution-package.md",
    route: "docs/proof/execution-package",
    section: "Proof",
    order: 1
  },
  { sourcePath: "docs/repository-map.md", route: null, section: "Architecture", order: 2 },
  { sourcePath: "CONTRIBUTING.md", route: "docs/community/contributing", section: "Community", order: 1 },
  { sourcePath: "docs/contributing-with-agents.md", route: null, section: "Community", order: 2 },
  { sourcePath: "SECURITY.md", route: "docs/community/security", section: "Community", order: 3 },
  { sourcePath: "SUPPORT.md", route: "docs/community/support", section: "Community", order: 4 },
  { sourcePath: "VERSIONING.md", route: "docs/community/versioning", section: "Community", order: 5 },
  {
    sourcePath: "CODE_OF_CONDUCT.md",
    route: "docs/community/code-of-conduct",
    section: "Community",
    order: 6
  },
  { sourcePath: "AGENTS.md", route: null, section: "Agent instructions", order: 1 },
  { sourcePath: "packages/AGENTS.md", route: null, section: "Agent instructions", order: 2 },
  { sourcePath: "apps/site/AGENTS.md", route: null, section: "Agent instructions", order: 3 },
  { sourcePath: "tests/AGENTS.md", route: null, section: "Agent instructions", order: 4 },
  { sourcePath: "schemas/AGENTS.md", route: null, section: "Agent instructions", order: 5 },
  { sourcePath: ".specs/AGENTS.md", route: null, section: "Agent instructions", order: 6 },
  { sourcePath: "docs/AGENTS.md", route: null, section: "Agent instructions", order: 7 },
  { sourcePath: "spikes/AGENTS.md", route: null, section: "Agent instructions", order: 8 },
  {
    sourcePath: ".specs/features/agent-ready-repository/spec.md",
    route: null,
    section: "Active feature",
    order: 1
  },
  {
    sourcePath: ".specs/features/agent-ready-repository/design.md",
    route: null,
    section: "Active feature",
    order: 2
  },
  {
    sourcePath: ".specs/features/agent-ready-repository/tasks.md",
    route: null,
    section: "Active feature",
    order: 3
  },
  {
    sourcePath: ".specs/features/agent-ready-repository/handoff.md",
    route: null,
    section: "Active feature",
    order: 4
  }
];

export const llmSiteGuideRoot = "apps/site/src/content/docs/docs";
