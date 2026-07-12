# Pi Runtime Boundary Qualification

**Task:** T02  
**Status:** Qualified for the T02 contract  
**Qualified packages:** `@earendil-works/pi-agent-core@0.80.6`, `@earendil-works/pi-ai@0.80.6`

## Upstream drift discovered

The previously planned `@mariozechner/pi-*` package names are deprecated by their publisher and direct users to `@earendil-works/pi-*`. T02 rejected the deprecated namespace and pinned the current packages and lockfile integrity instead. This changes no Verchestra architecture: Pi remains behind the Driver port and owns no Verchestra policy, workflow, artifact, Approval, or durable state.

## Proven boundary

- A fresh Pi `Agent` is created and reset for every invocation.
- Verchestra supplies the resolved model, exact context, tools, stream function, and controller abort signal.
- Tool execution is guarded by a controller-owned authorization callback before the implementation can run.
- Pi lifecycle/content/tool events are normalized to a small Verchestra event vocabulary.
- The returned result includes resolved identity, usage, stop reason, normalized events, and output text only.
- Transcript, system prompt, Pi session identity, credential material, and provider-local state are not returned.
- Mandatory-context capacity is checked before provider invocation.
- Provider errors, runtime/stream contract rejection, and controller abort remain distinct stable failures.

## Evidence

Command: `corepack pnpm@10.34.5 gate:full`

- Result: 28 passed, 0 failed, 0 skipped, 0 todo (16 T01 + 12 T02).
- No paid provider or external model endpoint was called; Pi's official faux provider supplied deterministic events and usage.
- Allowed and denied tool paths prove mediation before execution.
- The abort case waits until the provider stream has registered the controller signal, then proves stable cancellation.
- Two sequential runs each see a fresh one-message context, proving no transcript reuse through the boundary.

