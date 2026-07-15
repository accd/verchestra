import {
  ArtifactSealer,
  HmacPathPseudonymizer,
  NodeEd25519Signer,
  SupportBundleBuilder,
  SupportCodeRegistry,
  SupportExportCoordinator,
  createTrustRoot,
  sha256Digest
} from "../../packages/evidence/src/index.ts";
import { recipient } from "./recovery-bundle-fixture.mjs";

export const supportNow = "2026-07-15T22:00:00.000Z";
export const supportWorkspace = "workspace_018f0b6d-7b1a-7abc-8def-312345678901";
export const supportRun = "run_018f0b6d-7b1a-7abc-8def-412345678901";
export const supportDigest = (value) => `sha256:${sha256Digest(value)}`;
export const supportCodeRegistry = () =>
  new SupportCodeRegistry({ codes: ["VES_RUNTIME_FAILURE", "VES_TEST_FAILURE", "VES_UNKNOWN_FAILURE"] });

export function defaultDiagnostics() {
  return [
    { fieldId: "release.digest", value: supportDigest("release") },
    { fieldId: "release.version", value: "1.0.0" },
    { fieldId: "self_test.profile", value: "full" },
    { fieldId: "self_test.check_count", value: 42 },
    { fieldId: "self_test.duration_ms", value: 1200 },
    { fieldId: "self_test.evidence_refs", value: ["evidence:gate:001"] },
    { fieldId: "self_test.redaction_count", value: 1 },
    { fieldId: "self_test.failure_codes", value: ["VES_TEST_FAILURE"] },
    { fieldId: "self_test.verdict", value: "FAIL" },
    { fieldId: "diagnostic.path", value: "C:\\Users\\alice\\project\\runtime.sqlite" }
  ];
}

export async function supportHarness(overrides = {}) {
  const recipients = overrides.recipients ?? [await recipient("support-team")];
  const signer = NodeEd25519Signer.generate({ keyId: "support-signer", purposes: ["support-bundle"] });
  const sealer = new ArtifactSealer({ signer, now: () => new Date(supportNow) });
  const pseudonymizer = new HmacPathPseudonymizer({
    key: new TextEncoder().encode("0123456789abcdef0123456789abcdef")
  });
  const codeRegistry = supportCodeRegistry();
  const builder = new SupportBundleBuilder({ sealer, pseudonymizer, codeRegistry });
  const input = {
    schemaVersion: 1,
    registryVersion: "1.0.0",
    workspaceId: supportWorkspace,
    runId: supportRun,
    releaseDigest: supportDigest("release"),
    diagnostics: overrides.diagnostics ?? defaultDiagnostics(),
    recipients: recipients.map(({ recipientId, publicKey }) => ({ recipientId, publicKey })),
    createdAt: supportNow,
    expiresAt: "2026-07-16T22:00:00.000Z",
    ...overrides.input
  };
  const plan = await builder.plan(input);
  const inspection = builder.inspect(plan);
  const trust = createTrustRoot({ trustRootId: "support-root", version: 1, keys: [signer.publicKeyRef] });
  return { recipients, signer, sealer, builder, codeRegistry, input, plan, inspection, trust };
}

export function supportExportPorts(overrides = {}) {
  const state = { calls: [], published: undefined };
  const ports = {
    approval: {
      verify: async (request) => {
        state.calls.push("approval");
        return { valid: true, bindingDigest: supportDigest(request) };
      },
      ...overrides.approval
    },
    egress: {
      authorize: async (request) => {
        state.calls.push("egress");
        return { allowed: true, decisionDigest: supportDigest(request) };
      },
      ...overrides.egress
    },
    sink: {
      publish: async (request) => {
        state.calls.push("publish");
        state.published = request;
        return { status: "published", receiptId: "receipt:support:001" };
      },
      ...overrides.sink
    }
  };
  return { state, ports };
}

export function supportCoordinator(builder, ports) {
  return new SupportExportCoordinator({ builder, ...ports });
}
