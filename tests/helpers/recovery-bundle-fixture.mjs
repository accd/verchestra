import { generateKeyPair } from "jose";

import {
  ArtifactSealer,
  NodeEd25519Signer,
  RecoveryBundleBuilder,
  RecoveryRestoreCoordinator,
  createTrustRoot,
  sha256Digest
} from "../../packages/evidence/src/index.ts";

export const recoveryNow = "2026-07-15T20:00:00.000Z";
export const recoveryWorkspace = "workspace_018f0b6d-7b1a-7abc-8def-212345678901";
export const recoveryDigest = (value) => `sha256:${sha256Digest(value)}`;
export const bytes = (value) => new TextEncoder().encode(value);

export async function recipient(recipientId) {
  const pair = await generateKeyPair("ECDH-ES+A256KW", { crv: "X25519" });
  return { recipientId, ...pair };
}

export function recoveryObjects() {
  return [
    { objectId: "runtime.sqlite", kind: "runtime-snapshot", bytes: bytes("runtime-safe-snapshot") },
    { objectId: "memory.sqlite", kind: "memory-snapshot", bytes: bytes("memory-safe-snapshot") },
    { objectId: "capsules/run.json", kind: "run-capsule", bytes: bytes("signed-run-capsule") }
  ];
}

export async function recoveryHarness(overrides = {}) {
  const recipients = overrides.recipients ?? [await recipient("alice")];
  const signer = NodeEd25519Signer.generate({ keyId: "recovery-signer", purposes: ["recovery-bundle"] });
  const sealer = new ArtifactSealer({ signer, now: () => new Date(recoveryNow) });
  const builder = new RecoveryBundleBuilder({ sealer });
  const objects = recoveryObjects();
  const plan = await builder.plan({
    schemaVersion: 1,
    workspaceId: recoveryWorkspace,
    snapshotBarrierId: "barrier:001",
    runtimeStateDigest: recoveryDigest("runtime-state"),
    memoryStateDigest: recoveryDigest("memory-state"),
    sourceStateDigest: recoveryDigest("source-state"),
    policyDigest: recoveryDigest("policy"),
    approvalBindingDigest: recoveryDigest("approval"),
    claimDigest: recoveryDigest("claim"),
    releaseDigest: recoveryDigest("release"),
    includedClasses: ["runtime", "memory", "evidence"],
    excludedClasses: [
      "credential-values",
      "machine-authentication",
      "provider-sessions",
      "secret-values",
      "vector-indexes"
    ],
    logicalSecretBindings: ["database.primary", "jira.delivery"],
    uncertainEffectIds: ["effect:remote-001"],
    objects,
    recipients: recipients.map(({ recipientId, publicKey }) => ({ recipientId, publicKey })),
    createdAt: recoveryNow,
    expiresAt: "2026-07-16T20:00:00.000Z"
  });
  const bundle = await builder.build(
    plan,
    objects,
    recipients.map(({ recipientId, publicKey }) => ({ recipientId, publicKey }))
  );
  const trust = createTrustRoot({ trustRootId: "recovery-root", version: 1, keys: [signer.publicKeyRef] });
  return { recipients, signer, sealer, builder, objects, plan, bundle, trust };
}

export function restorePorts(overrides = {}) {
  const state = { active: "original", staged: undefined, discarded: false, calls: [] };
  const ports = {
    staging: {
      stage: async (objects) => {
        state.calls.push("stage");
        state.staged = objects;
        return "stage:001";
      },
      validate: async () => {
        state.calls.push("validate");
      },
      activate: async () => {
        state.calls.push("activate");
        state.active = "restored";
      },
      discard: async () => {
        state.calls.push("discard");
        state.discarded = true;
      },
      ...overrides.staging
    },
    authority: {
      reevaluate: async () => {
        state.calls.push("authority");
        return { policy: "passed", source: "passed", approvals: "passed", claims: "passed" };
      },
      ...overrides.authority
    },
    secrets: {
      isBound: async (name) => {
        state.calls.push(`secret:${name}`);
        return true;
      },
      ...overrides.secrets
    },
    effects: {
      reconcile: async (effectId) => {
        state.calls.push(`effect:${effectId}`);
        return "applied";
      },
      ...overrides.effects
    }
  };
  return { state, ports };
}

export function restoreCoordinator(builder, ports) {
  return new RecoveryRestoreCoordinator({ builder, ...ports });
}
