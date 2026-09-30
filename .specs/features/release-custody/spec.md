# Release custody specification (#408)

## Problem statement

The signed hold in `docs/qualification/release-decision-1.0.0.md` names a second
accountable human custodian as a precondition for any future promote round
(acceptance matrix L8; "Conscious ratification (F5)"). TUF role separation (#18,
F1) separates key *purposes*, not *people*. Today one operator holds the
signing keys, the object store, the npm package, and the only merge bypass.

The work is owner-led. An agent cannot appoint humans, provision keys, or change
governance settings. This feature prepares the model, the rehearsal, and the
owner checklist, so that closing #408 needs only owner decisions and actions.

## Goals

- A bounded custody model naming every release responsibility, its current
  holder, a target model with a second accountable custodian, and the
  independent control on each release effect.
- An honest record of residual risk, including the permanent admin bypass, and
  an explicit rule that two fields or two keys are not a two-person control.
- Revocation, rotation, and emergency procedures with an independent
  retrospective.
- A rehearsal against disposable artifacts that publishes nothing, with exact
  commands and expected denials.
- An owner checklist of human-only steps, each with a sanitized verification.

## Out of scope

| Exclusion | Reason |
| --- | --- |
| Choosing or appointing custodian #2 | Owner-only decision (#408). |
| Reading any real key or credential | Owner custody; agents never read key material back. |
| Provisioning or rotating a real key, or creating environments, without the owner's explicit authorization | The owner authorized the O2/O3 steps on 2026-09-30; keys were generated in memory and piped straight into environment secrets. |
| Changing the ruleset, CODEOWNERS, npm, or R2 settings | Governance changes need the owner and an independent review. |
| Timestamp/snapshot refresh routine | #382. |
| Release lifecycle (`.3`, metadata versions, rollback) | #387, #393. |
| Trusted-publishing workflow, detached threshold signing | Follow-up implementation tasks (T6-T7), each a separate reviewed change. |
| Updating acceptance-matrix L1/L8 | Only after the controls are verified and ratified. |

## Requirements

- **CUST-01**: WHEN the model is read THEN it SHALL name, for offline
  root/targets signing, online timestamp/snapshot refresh, npm publication,
  object-store publication, release-decision signing, evidence signing,
  recovery/rotation, and merge approval: the current holder, the target model,
  and the independent control.
- **CUST-02**: The model SHALL state the current posture as single-operator
  custody and SHALL NOT describe it as independent custody or claim promotion
  readiness.
- **CUST-03**: The model SHALL record residual risks, including the permanent
  `Repository admin` bypass, and SHALL state that two fields, two keys, an
  in-process threshold, or two admins are not a two-person control.
- **CUST-04**: The model SHALL map each release effect to the target control and
  to the remaining single-person path.
- **CUST-05**: The model SHALL define revocation, per-role rotation, emergency
  recovery with a tracked-issue precondition, and an independent retrospective.
- **CUST-06**: The model SHALL provide a rehearsal against disposable artifacts
  covering normal approval, custodian unavailability, and recovery. It SHALL
  give exact commands and expected denials, and it SHALL publish nothing.
- **CUST-07**: The model SHALL provide an ordered owner checklist whose
  verification commands print only names, logins, and settings, never values.
- **CUST-08**: No tracked file SHALL contain key material, credentials,
  environment values, emails, or machine-local paths.

### Protected signing environments and rotation (T5, T11; O2/O3 technical part)

- **CUST-09**: Each job that reads a signing key SHALL bind the protected
  environment that holds it (`tuf-release-signing` for the offline and online
  TUF keys, `t75-evidence-signing` for the evidence key). No signing secret SHALL
  be read outside a job bound to its environment, only the declared signing jobs
  SHALL bind those environments, and no workflow SHALL name a retired
  repository-level signing secret.
- **CUST-10**: The keys that were reachable as repository secrets SHALL be
  rotated. Each old anchor SHALL stay committed as a retired anchor with a
  retirement instant, and no signing path SHALL admit a retired anchor for a new
  signature. Committed historical evidence SHALL still verify under its retired
  anchor.
- **CUST-11**: Every committed trust identity, active or retired, SHALL differ
  from every other in key material and key id. Each retired anchor SHALL be
  named by its key id and have an active successor for its role.
- **CUST-12**: A signing workflow dispatched from any branch other than `main`
  SHALL be refused by its environment before any step runs.

## Acceptance

CUST-01 to CUST-08 are met by documentation, and CUST-09 to CUST-12 by code,
tests, and an observed refusal, all verified in `validation.md`. #408
itself closes only after the owner and an independent reviewer ratify the model
and the checklist evidence is recorded. `handoff.md` tracks that state as
`blocked`.
