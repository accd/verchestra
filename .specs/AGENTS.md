# Specification Instructions

Apply the root `AGENTS.md` first.

- `.specs/STATE.md` stores project decisions and the current repository
  handoff; do not erase unrelated decisions when updating it.
- Each non-trivial feature uses `context.md`, `spec.md`, `design.md`, `tasks.md`,
  `handoff.md`, and `validation.md` as applicable. These artifacts must be
  understandable without an installed skill.
- Requirements have stable IDs and precise outcomes. Tasks are atomic,
  dependency-ordered, independently verifiable, and committed one at a time.
- Update handoff frontmatter only through valid transitions and record exact
  completed evidence, next action, blockers, decisions, and intentionally
  unchanged files.
- Never put credentials, environment values, usernames, home directories,
  absolute paths, local profiles, or provider sessions in tracked artifacts.
- Independent validation maps evidence to every requirement and runs a
  discrimination sensor before completion; human review still decides merge.

