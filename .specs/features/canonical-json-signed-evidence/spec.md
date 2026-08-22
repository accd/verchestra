# Specification — signed-evidence canonical JSON

Issue: #58

## Requirements

| ID | Requirement |
| --- | --- |
| CJE-01 | An Execution Package with schema version 1 shall retain V1 canonical bytes and remain verifiable. |
| CJE-02 | A newly emitted Execution Package shall use schema version 2, the V2 in-toto predicate, and RFC 8785 bytes. |
| CJE-03 | Every set-like Execution Package ordering that feeds V2 evidence shall use UTF-16 code-unit order rather than ambient locale collation. |
| CJE-04 | DSSE sealing, loading, storage integrity, and cryptographic verification shall select canonicalization from the recorded schema version and fail closed for an unsupported version. |
| CJE-05 | Focused unit and security evidence shall prove V1 compatibility, V2 cross-locale determinism, and rejection of version/predicate or V2-ordering mutations. |

## Success criteria

- [ ] A pinned V1 package verifies without byte changes.
- [ ] Default package construction emits schema V2 and its declared V2 predicate.
- [ ] V2 packages are byte-identical for mixed-case set permutations under two locales.
- [ ] A V1 package cannot be presented as V2 or vice versa.
- [ ] The relevant unit, security, architecture, quick, and security gates pass.
