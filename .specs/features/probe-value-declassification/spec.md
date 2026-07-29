# Probe Value Declassification Specification

**Issue:** #107  
**Status:** Approved for implementation by the repository owner on 2026-07-29

## Problem Statement

Promoted database Probe evidence currently carries arbitrary scalar claim
values. A classification label and human-review reference do not prove that a
value is safe to make portable, so a raw e-mail can survive promotion.

## Goals

- [ ] Make the portable promoted-evidence claim representation closed and free
  of raw scalar values.
- [ ] Transform allowed source values into digest references before they cross
  the promotion boundary.
- [ ] Reject secret-, credential-, token-, connection-string-, and e-mail-
  shaped source values before promotion.
- [ ] Bind the new retention representation into `evidenceDigest`.
- [ ] Version the changed portable representation explicitly and fail closed on
  legacy raw-value evidence.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Carrying a declassified raw value | No verified value-level authority exists in this slice; it stays non-portable. |
| Persisting or resolving protected query results | Contradicts the Probe trust boundary. |
| Changing Probe query execution | Only promotion serialization is in scope. |

## Assumptions & Open Questions

| Decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- |
| Portable claim values | Omit them; carry only `valueDigest`. | A digest reference preserves provenance without a generic text channel. | Yes |
| Raw input screening | Reject high-confidence secret and identity patterns before hashing. | Hashing a secret alone is not an authorization to retain it. | Yes |
| Future raw-value exception | Requires a separately verified authority contract. | Strings such as `humanReviewRef` are not authority. | Yes |

**Open questions:** none.

## Acceptance Criteria

1. WHEN a source claim contains a permitted scalar THEN promoted evidence SHALL
   contain exactly its fact key, classification, `valueDigest`, and untrusted
   marker, and SHALL not contain the scalar bytes.
2. WHEN a source claim contains an e-mail, credential, token, secret,
   connection string, private-key marker, or a prohibited fact key THEN
   promotion SHALL fail with `VES_PROBE_PROMOTION_INVALID` without returning
   the value.
3. WHEN a caller alters a retained `valueDigest` or its claim metadata THEN
   downstream seed planning SHALL reject the promoted evidence.
4. WHEN equivalent permitted source values are promoted THEN their normalized
   claim references and `evidenceDigest` SHALL be deterministic.
5. WHEN #34 binds promoted evidence into a package THEN it SHALL consume this
   representation only; no package reference may reintroduce raw claim values.
6. WHEN a receiver presents a V1 promoted-evidence body THEN it SHALL reject
   it and require re-promotion as V2 rather than interpreting raw claims.

## Requirement Traceability

| Requirement ID | Status |
| --- | --- |
| PVD-01 — closed portable claim | In Design |
| PVD-02 — prohibited content rejection | In Design |
| PVD-03 — integrity and determinism | In Design |
| PVD-04 — #34 compatibility | In Design |
| PVD-05 — explicit portable-version migration | In Design |
