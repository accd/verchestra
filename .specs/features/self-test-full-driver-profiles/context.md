# T71 Full, Fault, and Approved-Driver Self-Test Context

## Request

Implement issue #12 after explicit maintainer confirmation and assignment to
`MiguelCorre`. The issue still carries `status: blocked`; that remote metadata
is intentionally left unchanged because repository implementation authority
does not imply issue-triage authority.

## Repository state at start

- Base revision: `4b984c7e541863fe056a31a9e72749f9bcf46f7f`
- Local branch: `codex/issue-12-t71-self-test`
- Product state remains `0.0.0-qualification`; this work makes no release or
  production-readiness claim.
- `pnpm gate:quick` passes after restoring the existing frozen workspace links.
- The repository pins Node `24.14.0`; the local runtime is `24.18.0`, so every
  local result must retain that environment caveat.

## Locked decisions

- Profile IDs remain exactly `smoke | full | workspace | drivers`.
- Crash recovery is a mode of `full`, never a fifth profile.
- Application rules and ports live in `packages/application/src/self-test/`.
- Node-bound facts live in `packages/self-test/`.
- Sibling adapters are composed only under `apps/vestra-cli/`.
- Ports return facts; application code owns every verdict.
- Self-Test uses deterministic local substitutes by default. It never makes a
  live or paid provider call and never reads operator credentials or sessions.
- The existing allowlisted signed Self-Test report remains the public evidence
  boundary. T71 does not add report fields or a JSON schema.
- No writer Tool may be present in the approved Driver profile.
- All repository and GitHub content is English-only.
- Changes are committed locally in atomic, behavior-complete commits. Nothing
  is pushed without the contributor's later explicit authorization.

## Existing components to reuse

- T69 isolation, material, sentinel, quarantine, and report controls.
- T70 scenario coverage, convergence fingerprints, offline guard, disposable
  Git fixtures, CLI command, and report rendering.
- Execution Package, Approval/Capability Broker, context, routing, egress,
  effect, verification, portable Handoff, and Run Capsule production APIs.
- Qualified Claude Code, Codex, and OpenCode/Qwen adapters plus the deterministic
  Driver protocol test double.
- Existing durable stores and idempotency/reconciliation behavior. T71 must
  exercise them; it must not create a parallel workflow implementation.

## Human-review boundary

The implementation may be specified, tested, and committed locally. Push, PR
creation, merge, release, and any external qualification action remain pending
explicit human authorization and independent review.
