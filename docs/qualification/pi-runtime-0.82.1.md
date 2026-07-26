# Pi Runtime Boundary Requalification

**Maintenance scope:** dependency refresh after T68  
**Status:** Qualified for the existing T02 contract  
**Qualified packages:** `@earendil-works/pi-agent-core@0.82.1`, `@earendil-works/pi-ai@0.82.1`

## Qualification boundary

This report supersedes the package-version identity recorded by the original
T02 qualification without changing its architecture or advancing the product
roadmap. Pi remains behind the Driver port and owns no Verchestra policy,
workflow, artifact, Approval, or durable state. T68 remains complete and T69
remains the next product task.

## Proven behavior

- Both direct Pi packages and their lockfile packages resolve to one exact
  0.82.1 version.
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
`pnpm site:build` pass. The twelve Pi boundary outcomes use Pi's deterministic
faux provider and do not contact a paid provider or external model endpoint.

