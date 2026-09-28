# Retained Release Rollback Specification (#393)

## Problem Statement

`NodeActivationClosure.activate()` always calls `TufUpdateClient.resolveAndStage()`,
which always runs a TUF `refresh()`. Once a machine has updated from release A
(metadata version 1) to release B (metadata version 2) under one trust root, the
persistent metadata cache is at version 2. Re-invoking launcher A then fetches
A's version-1 metadata, and TUF anti-rollback correctly rejects it with
`VES_TUF_ROLLBACK`. The live-activation matrix's `rollback` phase therefore
cannot pass after a successful update, and J02/L7 cannot close honestly.

Anti-rollback is a security property and must not be weakened: a client must
never accept older remote metadata. This feature adds a separate, local path
that re-activates a release this machine already verified and installed, with
no network access and no metadata at all, and it documents the TUF-correct
source-side alternative.

## Goals

- A launcher pinning a release that this machine previously verified, installed,
  and activated under the same trust root, and that a later verified release has
  since superseded, re-activates it locally: no source call, no TUF refresh.
- Every other case keeps the existing network path unchanged, so a remote
  downgrade still yields `VES_TUF_ROLLBACK`.
- The local path is visible in the activation receipt and in the verified
  launcher target (`operation: "rollback"`, `releaseReused: true`,
  `network: false`).
- Rollback's pointer switch is journaled with the same crash-safety discipline
  as activation.
- The source-side alternative (a roll-forward publication that points at the
  old bytes) is documented for the live-activation matrix.

## Out of Scope

| Item                                                                       | Reason                                                                               |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Changing TUF anti-rollback, metadata caching, or version comparison        | The property is correct; this feature adds a path that never consults metadata.      |
| Re-activating a release verified under a different trust root              | A different root is a different authority; it must resolve through the network path. |
| Protecting against a same-user local attacker who can write the state root | Such an attacker can already rewrite the npx cache; see `design.md`, threat model.   |
| Running the live-activation matrix or publishing releases                  | Owner-gated; no live success is claimed.                                             |
| Changing the published npm packages                                        | `0.0.0-qualification` and `.2` do not carry this code.                               |

## Requirements

| ID    | Requirement                                                                                                                                                                                                                                                                                                                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RR-01 | WHEN the network path activates a release from a TUF-verified stage and the caller supplies the trust-root digest THEN the manager SHALL persist a verified-release record binding `trustRootDigest`, `releaseId`, `releaseDigest`, and `semanticVersion`, ordered by verification recency. Without a trust-root digest nothing is recorded.                             |
| RR-02 | WHEN the pinned release matches exactly one recorded release under the pinned trust root, that release is installed, it is not the most recently verified release under that root, and the local trust anchor equals the pinned root digest THEN the closure SHALL re-activate it through `manager.rollback(digest, { trustRootDigest })` and SHALL make no source call. |
| RR-03 | WHEN any condition of RR-02 does not hold THEN the closure SHALL take the existing `resolveAndStage` path unchanged, so a remote downgrade still yields `VES_TUF_ROLLBACK`.                                                                                                                                                                                              |
| RR-04 | WHEN a trust-bound rollback targets a release with no record under that trust root, or whose installed bytes, manifest, platform, or identity do not verify, or whose health gate fails THEN it SHALL fail closed, leave the active pointer unchanged, and SHALL NOT fall back to the network.                                                                           |
| RR-05 | WHEN a rollback switches the pointer THEN it SHALL journal `operation: "rollback"` (`PREPARED` then `COMMITTED`), a crash at any fault point SHALL leave a byte-valid pointer at either the previous or the target release, a retry SHALL converge, and a foreign journal SHALL block it.                                                                                |
| RR-06 | The activation receipt and the verified launcher target SHALL report the path: `operation`, `releaseReused`, and `network`.                                                                                                                                                                                                                                              |
| RR-07 | `uninstall({ purgeReleases: true })` SHALL remove the verified-release records with the releases they describe.                                                                                                                                                                                                                                                          |
| RR-08 | The live-activation matrix documentation SHALL describe both the local retained-release rollback and the source-side roll-forward alternative, without claiming a live run that did not happen, and without reducing workflow enforcement.                                                                                                                               |
