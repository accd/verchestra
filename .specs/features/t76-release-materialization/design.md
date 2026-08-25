# T76 Release Materialization Design

`collectHermeticArtifactInputsFromFiles` reads each regular source exactly once
and returns a portable component plus a copy of its bytes. The materializer
passes only those components to `buildSupplyChainEvidence`, maps the resulting
documents to the four generated bundle components, and then calls
`buildHermeticDistributionBundle` for the final closure and digest.

The generated component identities are fixed (`license:closure`,
`sbom:cyclonedx`, `provenance:build`, `evaluation:release`). A source license
file is used to populate the license-closure document but is not emitted as a
second bundle license component; this preserves the candidate's exactly-one
evidence rule. A collision with a generated identity is rejected. Returned
component bytes are suitable as the input to the later TUF publisher; no
private key or network capability exists in this module.
