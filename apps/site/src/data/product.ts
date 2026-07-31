export const productHeadline = "AI delivery that survives the model, the machine, and the handoff.";

export const productDefinition =
  "Verchestra is a verified AI software-delivery harness. It turns discovery, planning, implementation, validation, and human approval into portable, signed, and reviewable delivery work.";

export const productScenario =
  "A developer can begin with one AI environment and hand the next developer an executable contract, verified evidence, and the exact next action — without transferring credentials or relying on chat history.";

export const productStatus = {
  version: "0.0.0-qualification",
  completedTask: "T68d",
  nextTask: "T69",
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

export const databases = [
  "SAP ASE / Sybase",
  "PostgreSQL",
  "MySQL / MariaDB",
  "SQL Server",
  "Oracle",
  "SQLite",
  "MongoDB"
] as const;
