import { fileURLToPath } from "node:url";

import {
  assertNoNetworkAttempts,
  driverScenarioChecks,
  type DriverInvocationFacts,
  type DriverReviewFacts,
  type DriverScenarioFacts,
  type SubjectRunFacts
} from "@verchestra/application";
import {
  ClaudeCodeDriver,
  CodexDriver,
  OpenCodeDriver,
  type Driver,
  type DriverEvent,
  type DriverStartRequest
} from "@verchestra/drivers";
import { sha256Digest } from "@verchestra/evidence";
import { offlineGuard } from "@verchestra/self-test";

import { runAuthorizedDriverBoundary, type DriverAuthorityFacts } from "./self-test-driver-authority.ts";

const WORKSPACE_ID = "workspace_018f0000-0000-7000-8000-000000001501";
const RUN_ID = "run_018f0000-0000-7000-8000-000000001502";
const PASSPORT_ID = "passport_018f0000-0000-7000-8000-000000001504";
const FAKE_DRIVER_PATH = fileURLToPath(new URL("./self-test-driver-fake.mjs", import.meta.url));
const digest = (value: string): `sha256:${string}` => `sha256:${sha256Digest(value)}`;

export interface DriverScenarioResult {
  readonly facts: SubjectRunFacts;
  readonly invocations: readonly DriverInvocationFacts[];
  readonly events: readonly DriverEvent[];
  readonly scenarioFacts: DriverScenarioFacts;
}

function review(
  providerId: DriverReviewFacts["providerId"],
  modelId: string,
  destinationId: string
): DriverReviewFacts {
  return Object.freeze({
    providerId,
    modelId,
    destinationId,
    maximumCostUsd: 0.25,
    modelCapabilities: Object.freeze(["read", "reason"]),
    tools: Object.freeze([{ name: "vestra_read", access: "read" as const }]),
    classification: "internal",
    purpose: "self-test-read-only",
    retention: "none",
    egressMode: "online" as const
  });
}

function authorityFor(value: DriverReviewFacts): DriverAuthorityFacts {
  return {
    approvalGranted: true,
    capabilityGranted: true,
    destinationId: value.destinationId,
    maximumCostUsd: value.maximumCostUsd,
    egressAllowed: true,
    approvedReview: value
  };
}

function request(review: DriverReviewFacts): DriverStartRequest {
  return {
    workspaceId: WORKSPACE_ID,
    runId: RUN_ID,
    passportRef: { passportId: PASSPORT_ID, revision: 1 },
    serializedContextRef: { manifestId: digest("driver-context"), target: review.destinationId },
    tools: review.tools.map((tool) => ({ name: tool.name, inputSchemaDigest: digest("read-schema") }))
  };
}

async function exercise(driver: Driver, review: DriverReviewFacts, events: DriverEvent[]): Promise<void> {
  const session = await driver.start(request(review), (event) => events.push(event), new AbortController().signal);
  await driver.close(session);
}

function claude(events: DriverEvent[]): (review: DriverReviewFacts) => Promise<void> {
  return async (review) => {
    const driver = new ClaudeCodeDriver({
      command: [process.execPath, FAKE_DRIVER_PATH, "claude"],
      minimumVersion: "2.1.168",
      resolveExecution: async () => ({
        passport: {
          passportId: PASSPORT_ID,
          revision: 1,
          provider: "anthropic",
          resolvedModel: review.modelId
        },
        prompt: "Read the deterministic Self-Test context.",
        model: review.modelId,
        environment: { VERCHESTRA_SELF_TEST_FAKE: "claude" },
        sensitiveValues: []
      })
    });
    await exercise(driver, review, events);
  };
}

function codex(events: DriverEvent[]): (review: DriverReviewFacts) => Promise<void> {
  return async (review) => {
    const driver = new CodexDriver({
      command: [process.execPath, FAKE_DRIVER_PATH, "codex"],
      minimumVersion: "0.115.0",
      resolveExecution: async () => ({
        passport: {
          passportId: PASSPORT_ID,
          revision: 1,
          provider: "openai",
          resolvedModel: review.modelId
        },
        prompt: "Read the deterministic Self-Test context.",
        model: review.modelId,
        tools: review.tools.map((tool) => ({
          name: tool.name,
          description: "Read approved deterministic input",
          inputSchema: { type: "object" },
          inputSchemaDigest: digest("read-schema")
        })),
        environment: { VERCHESTRA_SELF_TEST_FAKE: "codex" },
        sensitiveValues: [],
        cancelGraceMs: 50
      })
    });
    await exercise(driver, review, events);
  };
}

function openCodeFactory() {
  return async () => {
    const stream = async function* () {
      yield {
        type: "message.part.updated",
        properties: {
          sessionID: "self-test-session",
          part: { type: "text", text: "done", time: { end: 1 } }
        }
      };
      yield {
        type: "message.part.updated",
        properties: {
          sessionID: "self-test-session",
          part: { type: "step-finish", tokens: { input: 4, output: 2, reasoning: 1, cache: { read: 0, write: 0 } } }
        }
      };
      yield { type: "session.status", properties: { sessionID: "self-test-session", status: { type: "idle" } } };
    };
    return {
      client: {
        provider: {
          list: async () => ({
            data: {
              all: [
                {
                  id: "company",
                  name: "Company AI",
                  models: { "qwen3-coder-480b": { id: "qwen3-coder-480b" } }
                }
              ],
              connected: ["company"],
              default: { company: "qwen3-coder-480b" }
            }
          })
        },
        event: { subscribe: async () => ({ stream: stream() }) },
        session: {
          create: async () => ({ data: { id: "self-test-session" } }),
          prompt: async () => ({ data: {} }),
          abort: async () => ({ data: true }),
          delete: async () => ({ data: true })
        },
        permission: { reply: async () => ({ data: true }) }
      },
      server: { close: () => undefined }
    };
  };
}

function openCode(events: DriverEvent[]): (review: DriverReviewFacts) => Promise<void> {
  return async (review) => {
    const [provider, resolvedModel] = review.modelId.split("/");
    if (provider === undefined || resolvedModel === undefined) throw new Error("OpenCode review model is invalid");
    const driver = new OpenCodeDriver({
      command: [process.execPath, FAKE_DRIVER_PATH, "opencode"],
      minimumVersion: "1.17.18",
      serverFactory: openCodeFactory(),
      resolveExecution: async () => ({
        passport: {
          passportId: PASSPORT_ID,
          revision: 1,
          provider,
          resolvedModel
        },
        prompt: "Read the deterministic Self-Test context.",
        model: review.modelId,
        tools: review.tools.map((tool) => ({ name: tool.name, inputSchemaDigest: digest("read-schema") })),
        environment: {},
        sensitiveValues: [],
        authorizeTool: async () => false
      })
    });
    await exercise(driver, review, events);
  };
}

export async function runDriverScenario(): Promise<DriverScenarioResult> {
  const guard = offlineGuard();
  const events: DriverEvent[] = [];
  const declared = [
    { review: review("anthropic", "claude-opus-4-8", "local:claude"), invoke: claude(events) },
    { review: review("openai", "gpt-5.5-codex", "local:codex"), invoke: codex(events) },
    { review: review("opencode", "company/qwen3-coder-480b", "loopback:opencode"), invoke: openCode(events) }
  ];
  try {
    const invocations: DriverInvocationFacts[] = [];
    for (const item of declared)
      invocations.push(
        await runAuthorizedDriverBoundary({
          review: item.review,
          displayedReview: item.review,
          actualReview: item.review,
          authority: authorityFor(item.review),
          invoke: item.invoke
        })
      );
    const deniedReview = declared[0]!.review;
    invocations.push(
      await runAuthorizedDriverBoundary({
        review: deniedReview,
        displayedReview: deniedReview,
        actualReview: deniedReview,
        authority: { ...authorityFor(deniedReview), approvalGranted: false },
        invoke: async () => {
          throw new Error("denied Driver boundary was invoked");
        }
      })
    );
    assertNoNetworkAttempts(guard.attempts());
    const scenarioFacts: DriverScenarioFacts = {
      invocations,
      lifecycle: {
        sessionStarted: events.filter((event) => event.type === "session.started").length,
        sessionClosed: events.filter((event) => event.type === "session.closed").length,
        writerToolRequests: events.filter((event) => event.type === "tool.requested").length,
        networkAttempts: guard.attempts().length
      }
    };
    const scenarioChecks = driverScenarioChecks(scenarioFacts);
    return {
      facts: {
        checks: scenarioChecks,
        checkCount: scenarioChecks.length,
        durationMs: 0,
        evidenceRefs: [],
        failureCodes: [],
        redactionCount: 0
      },
      invocations,
      events,
      scenarioFacts
    };
  } finally {
    guard.restore();
  }
}
