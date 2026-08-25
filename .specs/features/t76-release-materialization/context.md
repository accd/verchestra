# T76 Release Materialization Context

Issue: #17

The artifact-input and unsigned supply-chain slices now exist independently.
This task joins them at the isolated-build boundary: read source bytes once,
generate the four evidence documents from those observed identities, and only
then construct the complete hermetic bundle. It deliberately stops before
candidate signing, public publication, activation, and rollback execution.
