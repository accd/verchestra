# Design

`buildSupplyChainEvidence` validates one exact release identity, sorts
components and evaluation profiles with UTF-16 code-unit order, and emits four
canonical V2 JSON documents. The SBOM uses a CycloneDX 1.5-shaped projection;
provenance uses an in-toto Statement with a SLSA provenance predicate; license
closure and evaluation are versioned Verchestra documents.

Each document carries a logical path, canonical-byte digest, byte size, and
bytes. `verifySupplyChainEvidence` checks all four identities and reparses the
bytes through the same canonical V2 primitive. No private key, network, URL,
machine path, or activation authority is accepted.
