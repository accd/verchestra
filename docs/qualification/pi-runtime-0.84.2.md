# Pi Runtime Boundary Requalification

**Maintenance scope:** dependency refresh after T73
**Status:** Candidate pending exact-head CI qualification
**Qualified packages:** `@earendil-works/pi-agent-core@0.84.2`, `@earendil-works/pi-ai@0.84.2`

## Qualification boundary

This report supersedes the package-version identity recorded by
`docs/qualification/pi-runtime-0.84.1.md` without changing the driver
architecture or advancing the product roadmap. Pi remains behind the Driver
port and owns no Verchestra policy, workflow, artifact, Approval, or durable
state. The package versions are one coordinated qualification unit.

## Proven behavior

- Both direct Pi packages and their lockfile packages resolve to one exact
  `0.84.2` version.
- The real `PiDriver.probe()` resolves the installed package manifest and
  reports the observed version; an unreadable or absent package is unavailable,
  and any version other than `0.84.2` is unsupported.
- A fresh Pi `Agent` is created and reset for every invocation.
- Verchestra supplies the resolved model, exact context, tools, stream
  function, and controller abort signal.
- Tool execution remains guarded by a controller-owned authorization callback.
- Lifecycle, content, tool, usage, abort, provider failure, and runtime failure
  outcomes retain their stable Verchestra representation.
- Transcript, system prompt, session identity, credentials, and provider-local
  state are not returned.

## Evidence

The coordinated dependency change is accepted only when `pnpm qualify:pi`,
`pnpm test:qualification`, `pnpm gate:full`, `pnpm site:test`, and
`pnpm site:build` pass on the exact implementation revision. The Pi boundary
outcomes use Pi's deterministic faux provider and do not contact a paid
provider or external model endpoint.
