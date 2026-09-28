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
| Provisioning, reading, or rotating any real key or credential | Owner custody; agents never touch key material. |
| Changing the ruleset, CODEOWNERS, environments, npm, or R2 settings | Governance changes need the owner and an independent review. |
| Timestamp/snapshot refresh routine | #382. |
| Release lifecycle (`.3`, metadata versions, rollback) | #387, #393. |
| Workflow `environment:` wiring, trusted-publishing workflow, detached threshold signing | Follow-up implementation tasks (T5-T7), each a separate reviewed change. |
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

## Acceptance

CUST-01 to CUST-08 are met by documentation, verified in `validation.md`. #408
itself closes only after the owner and an independent reviewer ratify the model
and the checklist evidence is recorded. `handoff.md` tracks that state as
`blocked`.
