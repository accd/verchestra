import { join } from "node:path";

import { NodeEd25519Signer, createTrustRoot, type EvidenceSigner, type TrustRoot } from "@verchestra/evidence";
import { EncryptedFileKeyProvider } from "@verchestra/platform-node";

import { stateInvalid, taskError } from "./task-errors.ts";
import { objectRow, readJsonFile, writeJsonAtomic } from "./task-files.ts";
import type { TaskWorkspace } from "./task-workspace.ts";

// invariant: one Workspace evidence key signs every artifact a governed task
// seals; its private half is encrypted at rest under the brokered
// `evidence-signing-passphrase` and never leaves the key provider.
export const EVIDENCE_KEY_ID = "workspace-task-evidence";
export const EVIDENCE_PURPOSES = Object.freeze(["execution-package", "approval", "run-capsule", "context-manifest"]);

function anchorPath(workspace: TaskWorkspace): string {
  return join(workspace.layout.workspaceRoot, "keys", "task-evidence-trust.json");
}

export async function workspaceSigner(workspace: TaskWorkspace, passphrase: string): Promise<EvidenceSigner> {
  const provider = new EncryptedFileKeyProvider({
    stateRoot: workspace.layout.workspaceRoot,
    passphrase: async () => Buffer.from(passphrase, "utf8"),
    signers: NodeEd25519Signer
  });
  let signer: EvidenceSigner;
  try {
    signer = await provider.loadOrCreate({ keyId: EVIDENCE_KEY_ID, purposes: EVIDENCE_PURPOSES });
  } catch (error) {
    throw taskError(
      "VES_TASK_FAILED",
      { reason: "VES_KEYSTORE_INTEGRITY" },
      "The Workspace evidence key could not be unlocked",
      { cause: error }
    );
  }
  await pinTrustAnchor(workspace, signer);
  return signer;
}

// why: verification needs the public key without the passphrase; it is pinned
// on first use and must never silently change afterwards.
async function pinTrustAnchor(workspace: TaskWorkspace, signer: EvidenceSigner): Promise<void> {
  const stored = await readJsonFile(anchorPath(workspace), "evidence trust anchor");
  if (stored === undefined) {
    await writeJsonAtomic(anchorPath(workspace), { schemaVersion: 1, publicKeyRef: signer.publicKeyRef });
    return;
  }
  const pinned = objectRow(objectRow(stored, "evidence trust anchor")["publicKeyRef"], "publicKeyRef");
  if (pinned["publicKey"] !== signer.publicKeyRef.publicKey || pinned["keyId"] !== signer.publicKeyRef.keyId)
    throw stateInvalid("VES_TASK_TRUST_ANCHOR_MISMATCH", "The evidence key differs from the pinned trust anchor");
}

export async function workspaceTrustRoot(workspace: TaskWorkspace): Promise<TrustRoot> {
  const stored = await readJsonFile(anchorPath(workspace), "evidence trust anchor");
  if (stored === undefined)
    throw stateInvalid("VES_TASK_TRUST_ANCHOR_MISSING", "No Workspace evidence key has been created");
  const publicKeyRef = objectRow(objectRow(stored, "evidence trust anchor")["publicKeyRef"], "publicKeyRef");
  try {
    return createTrustRoot({
      trustRootId: "workspace-task-evidence",
      version: 1,
      keys: [publicKeyRef as unknown as EvidenceSigner["publicKeyRef"]]
    });
  } catch (error) {
    throw stateInvalid("VES_TASK_TRUST_ANCHOR_INVALID", "The pinned evidence trust anchor is invalid", {
      cause: error
    });
  }
}

// invariant: a dry run seals with a throwaway key so it can print the exact
// surface a real plan would bind, while writing nothing and reading no
// credential; nothing it signs is ever persisted or approvable.
export function ephemeralSigner(): EvidenceSigner {
  return NodeEd25519Signer.generate({ keyId: "dry-run-ephemeral", purposes: [...EVIDENCE_PURPOSES] });
}
