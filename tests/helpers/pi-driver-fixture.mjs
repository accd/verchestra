import { AssistantMessageEventStream, Type, createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { mockRequest } from "./driver-protocol-fixture.mjs";

export function piFixture(responses = [fauxAssistantMessage("hello")], options = {}) {
  const faux = createFauxCore({ provider: "verchestra-pi-test", ...options });
  faux.setResponses(responses);
  const model = faux.getModel();
  const calls = { resolve: 0, authorize: 0, execute: 0 };
  const tool = {
    name: "vestra_read",
    inputSchemaDigest: "sha256:" + "b".repeat(64),
    label: "Read",
    description: "Read approved fixture data",
    parameters: Type.Object({ path: Type.String() }),
    execute: async (_id, params) => {
      calls.execute += 1;
      return { content: [{ type: "text", text: params.path }], details: {} };
    }
  };
  const passport = {
    passportId: "passport_018f0000-0000-7000-8000-000000001504",
    revision: 1,
    provider: model.provider,
    api: model.api,
    resolvedModel: model.id
  };
  const execution = {
    passport,
    model,
    streamFn: faux.streamSimple,
    prompt: "private prompt",
    systemPrompt: "",
    tools: [tool],
    authorizeTool: async () => {
      calls.authorize += 1;
      return { allowed: true };
    }
  };
  return {
    faux,
    model,
    calls,
    execution,
    request: (overrides = {}) => mockRequest(overrides),
    dependencies: (overrides = {}) => ({
      resolveExecution: async () => {
        calls.resolve += 1;
        return { ...execution, ...overrides };
      }
    })
  };
}

// why: a provider run that ends only when its own signal aborts, so a test can
// observe that a cancel reached the provider and not only the ledger.
export function piAbortableFixture() {
  const fixture = piFixture();
  const model = createFauxCore({ provider: "verchestra-pi-abortable" }).getModel();
  const observed = { aborts: 0 };
  let markRunning;
  const running = new Promise((resolve) => (markRunning = resolve));
  const streamFn = (_model, _context, options) => {
    const stream = new AssistantMessageEventStream();
    options.signal.addEventListener(
      "abort",
      () => {
        observed.aborts += 1;
        stream.push({ type: "error", reason: "aborted", error: fauxAssistantMessage("", { stopReason: "aborted" }) });
      },
      { once: true }
    );
    markRunning();
    return stream;
  };
  const passport = { ...fixture.execution.passport, provider: model.provider, api: model.api, resolvedModel: model.id };
  return {
    observed,
    running,
    request: fixture.request,
    dependencies: () => fixture.dependencies({ model, streamFn, passport })
  };
}
