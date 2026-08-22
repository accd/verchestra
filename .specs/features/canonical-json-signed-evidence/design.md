# Design — signed-evidence canonical JSON

`canonical.ts` remains the V1 facade. A version-aware facade delegates V2 to
`canonicalizeJsonV2` from the existing inward domain package. `dsse.ts` maps a
declared schema name and exact schema version to both a predicate URI and the
canonicalization version. `artifact-sealer.ts` uses that mapping for clones,
payload digests, statement bytes, artifact IDs, envelope reconstruction, and
verification.

Execution Package validates `schemaVersion` as 1 or 2. Its normalizers receive
that version: V1 retains its exact `localeCompare` behavior; V2 sorts declared
sets with the default string comparator, which is UTF-16 code-unit order. The
schema version is copied to the DSSE binding, so storage and a later verifier
select the same algorithm. Existing V1 fixtures remain explicit; default fixture
construction moves to V2 to model new output.

Unsupported predicate/schema pairs have no mapping and are rejected before a
signature is trusted. The design changes no pre-DSSE compatibility behavior.
