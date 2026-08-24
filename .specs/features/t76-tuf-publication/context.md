# T76 TUF Publication — Context

This slice turns the verified T76 candidate and its real component bytes into
an independently consumable TUF repository. Private key custody remains an
application concern: the publisher receives synchronous signer callbacks and
never reads an environment variable, key file, or secret itself.

The repository is a release artifact, not an activation authority. It emits a
bootstrap root, delegated component metadata, timestamp/snapshot metadata, and
hash-addressed targets for the four existing source modes.
