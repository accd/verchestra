// invariant: SSI-12 and SSI-13. The `@verchestra/agent-runtime/strands-coordination`
// subpath, the only way into the modules that import `@strands-agents/sdk` or
// `zod`. The package's main entry never reaches it, so the SDK is loaded only
// when a composition root imports this subpath for a graph or swarm run.
export { handoffDecisionSchema, nodeResultZod } from "./handoff-schema.ts";
export { StrandsCoordinationEngine, strandsOrchestrator, strandsOutcome } from "./strands-engine.ts";
export { structuralAgent } from "./structural-agent.ts";
