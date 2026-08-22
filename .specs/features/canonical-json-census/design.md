# Canonical JSON Census Design

## Canonical source

`docs/canonical-json-census.json` is the reviewed classification source. Each
entry has one path, its observed signals, one closed classification, and a
reason. `scripts/canonical-json-census.mjs` derives candidates from the source
tree and validates the inventory; it never edits the inventory.

## Closed classifications

| Classification | Meaning |
| --- | --- |
| `migrated-v2` | A structured identity already emits or verifies the declared V2 contract. |
| `retained-v1-versioned` | A signed or persisted V1 contract remains authoritative until its explicit versioned migration. |
| `pending-versioned-migration` | A structured portable, trust, or persistent identity awaiting a versioned vertical. |
| `raw-byte-digest` | SHA-256 is applied to bytes rather than a structured value; canonical JSON does not apply. |
| `presentation-or-fixture` | Closed exception for ordering that cannot contribute to a portable identity. |

## Failure rules

- A detected path absent from the inventory fails.
- An inventory path no longer detected fails.
- A path appears only once and uses one closed classification.
- `presentation-or-fixture` entries cannot carry a canonicalizer or an ambient
  locale sort together with a structured digest producer.
- A future source with any detector signal fails until reviewed and classified.
