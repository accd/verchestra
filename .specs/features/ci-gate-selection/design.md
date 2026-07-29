# Design

`gate-selection.mjs` maps changed paths to named gate profiles. A closed,
conservative rule covers qualification reports and CI self-modification.
`gate-stages.mjs` is the single definition of each profile's stages and returns
their ordered union. `select-gates.mjs` resolves a Git range, emits sanitized
evidence, and falls back to the conservative profile when that range cannot be
trusted. The workflow supplies the event-specific base SHA and runs the emitted
stages directly, once per stage.
