export const productHeadline = "AI delivery that survives the model, the machine, and the handoff.";

export const productDefinition =
  "Verchestra is a verified AI software-delivery harness. It turns discovery, planning, implementation, validation, and human approval into portable, signed, and reviewable delivery work.";

export const productScenario =
  "A developer can begin with one AI environment and hand the next developer an executable contract, verified evidence, and the exact next action — without transferring credentials or relying on chat history.";

export const productStatus = {
  version: "0.0.0-qualification",
  completedTask: "T74",
  nextTask: "T75",
  installable: false
} as const;

export const deliveryStages = [
  {
    name: "Request",
    description: "A developer brings a real delivery outcome, not a provider-specific prompt."
  },
  {
    name: "Discovery",
    description: "Repositories, approved documentation, and read-only data context become source-bound evidence."
  },
  {
    name: "Execution Package",
    description: "Requirements, decisions, tasks, authority, and completion gates are sealed into a portable contract."
  },
  {
    name: "Qualified driver",
    description: "Claude Code, Codex, or OpenCode/Qwen receives the same bounded delivery contract."
  },
  {
    name: "Evidence",
    description: "Tests, digests, signed reports, and handoff state prove what happened."
  },
  {
    name: "Human review",
    description: "An accountable reviewer accepts or rejects evidence after independent verification."
  }
] as const;

export const guarantees = [
  {
    title: "Portable execution",
    description: "Move work between qualified environments without transferring credentials or machine authority.",
    tone: "violet"
  },
  {
    title: "Policy before effects",
    description: "Capabilities, approvals, leases, and egress rules are evaluated before external actions.",
    tone: "cyan"
  },
  {
    title: "Read-only discovery",
    description: "Bounded database probes expose approved context without creating a hidden writer.",
    tone: "cyan"
  },
  {
    title: "Evidence, not assertions",
    description: "Packages, runs, reports, and release inputs bind their source state by digest and signature.",
    tone: "violet"
  },
  {
    title: "Human control",
    description: "Independent verification and human acceptance remain explicit workflow states.",
    tone: "amber"
  },
  {
    title: "Safe repetition",
    description: "Initialization, effects, Git operations, recovery, and handoff converge idempotently.",
    tone: "amber"
  }
] as const;

export const drivers = ["Claude Code", "Codex", "OpenCode / Qwen"] as const;

// SQLite leads because it is the only engine this repository live-qualifies
// itself (real driver through the supervisor bounds); the rest are
// contract-verified here and live-qualified at the edge per AD-017.
export const databases = [
  "SQLite",
  "MongoDB",
  "MySQL / MariaDB",
  "Oracle",
  "PostgreSQL",
  "SAP ASE / Sybase",
  "SQL Server"
] as const;

// One typed source for what actually works, so the homepage, the README, and
// any future surface describe the same reality. A capability appears here with
// exactly one maturity, and a drift test compares the README table against
// this array - status must never be hand-duplicated.
export type CapabilityMaturity = "available" | "qualified" | "implemented" | "experimental" | "planned";

export const maturityDefinitions: Readonly<Record<CapabilityMaturity, string>> = {
  available: "Runnable today from a source checkout of the local alpha.",
  qualified: "Backed by a public validation report; not yet composed into the CLI surface.",
  implemented: "Merged on main with tests, but its qualification report is not published yet.",
  experimental: "Present in the tree for evaluation; interfaces and evidence may change.",
  planned: "Roadmap work with a declared task; no code is claimed."
} as const;

export interface CapabilityEntry {
  readonly capability: string;
  readonly maturity: CapabilityMaturity;
  // Internal task ids stay secondary: human-readable first, traceability second.
  readonly reference: string;
  readonly evidenceRoute: string;
}

export const capabilityMatrix: readonly CapabilityEntry[] = [
  {
    capability: "Workspace initialization (init preview and apply)",
    maturity: "available",
    reference: "issue #64 slice A/B",
    evidenceRoute: "docs/develop-from-source"
  },
  {
    capability: "Evidence signing-key lifecycle (persist, rotate, revoke)",
    maturity: "qualified",
    reference: "T68a",
    evidenceRoute: "docs/qualification/t68a-validation"
  },
  {
    capability: "Cost and duration budget enforcement",
    maturity: "qualified",
    reference: "T68b",
    evidenceRoute: "docs/qualification/t68b-validation"
  },
  {
    capability: "Declared gate repair loop with human escalation",
    maturity: "qualified",
    reference: "T68c",
    evidenceRoute: "docs/qualification/t68c-validation"
  },
  {
    capability: "Policy boundary: declarative tests and signed bundles",
    maturity: "qualified",
    reference: "T68d",
    evidenceRoute: "docs/qualification/t68d-validation"
  },
  {
    capability: "AI driver adapters (Claude Code, Codex, OpenCode/Qwen)",
    maturity: "qualified",
    reference: "driver qualification",
    evidenceRoute: "docs/qualification/runtime-and-driver-qualification"
  },
  {
    capability: "Read-only database probes (7 engines, fixture-qualified)",
    maturity: "qualified",
    reference: "database matrix",
    evidenceRoute: "docs/integrations/database-capability-matrix"
  },
  {
    capability: "Signed distribution, activation, and rollback (TUF)",
    maturity: "qualified",
    reference: "T66-T68",
    evidenceRoute: "docs/qualification/supply-chain-qualification"
  },
  {
    capability: "Self-Test trust domain and doctor --deep",
    maturity: "qualified",
    reference: "T69-T72",
    evidenceRoute: "docs/qualification/t72-validation"
  },
  {
    capability: "Public regression campaigns and sealed-holdout promotion",
    maturity: "qualified",
    reference: "T73-T74",
    evidenceRoute: "docs/qualification/t74-validation"
  },
  {
    capability: "Platform matrix, release candidate, and the 1.0 decision",
    maturity: "planned",
    reference: "T75-T77",
    evidenceRoute: "roadmap"
  }
] as const;

// Trust is built as much by what is ruled out as by what is promised. Every
// line here is a present-tense fact about the current repository.
export const notToday: readonly string[] = [
  "It is not a public production release - the version is 0.0.0-qualification and there is no installer.",
  "It is not a hosted service - everything runs from a source checkout on your machine.",
  "It does not transfer provider credentials - a handoff carries evidence and next actions, never sessions or secrets.",
  "It does not make unapproved paid model calls - a missing provider reports not configured, never a silent pass.",
  "It does not treat CI as human review - acceptance is an explicit human decision recorded as evidence.",
  "It does not call same-author checks independent verification - that distinction is stated, not blurred.",
  "It does not expose unqualified commands - the installed CLI advertises init and nothing else."
] as const;
