import {
  ArtifactSealer,
  dsseEnvelopeOf,
  sealedArtifactFromEnvelope,
  sha256DigestForVersion,
  type DsseEnvelope,
  type EvidenceSigner,
  type JsonValue,
  type SealedArtifact,
  type TrustRoot
} from "@verchestra/evidence";

// invariant: doors 2 and 3 of .specs/features/probe-host-composition/plan.md.
// Every record an extension command signs is a DSSE envelope sealed by the
// Workspace evidence key under its existing `approval` purpose. No purpose is
// added: the key provider refuses a stored key whose purposes differ, so a new
// one would lock every existing Workspace key.
const PURPOSE = "approval";

export type ExtensionRecordSchema = "skill-lock" | "extension-approval" | "extension-approval-revocation";

export interface ExtensionRecordBinding {
  readonly bindingId: string;
  readonly sourceStateDigest: string;
}

const hex = (digest: string): string => (digest.startsWith("sha256:") ? digest.slice("sha256:".length) : digest);

export async function sealRecord(
  signer: EvidenceSigner,
  schema: ExtensionRecordSchema,
  content: JsonValue,
  binding: ExtensionRecordBinding
): Promise<DsseEnvelope> {
  const artifact = await new ArtifactSealer({ signer }).seal(content, {
    schema: { name: schema, version: 1 },
    purpose: PURPOSE,
    bindingId: binding.bindingId,
    sourceStateDigest: hex(binding.sourceStateDigest)
  });
  return dsseEnvelopeOf(artifact);
}

// why: the digest a sealed record's statement names for its content, so a
// caller that knows the content it expects compares one value.
export function recordContentDigest(content: unknown): string {
  return sha256DigestForVersion(1, content);
}

// invariant: answers a record only when the envelope is a declared
// attestation of this schema, its signature verifies against the pinned
// anchor under the `approval` purpose, and its binding is the one the caller
// derives from what it signed. Anything else is answered `undefined`, never
// thrown, so an unreadable record fails closed.
export async function openRecord(
  trust: TrustRoot | undefined,
  schema: ExtensionRecordSchema,
  envelope: unknown,
  binding: (content: JsonValue) => ExtensionRecordBinding | undefined
): Promise<SealedArtifact | undefined> {
  const key = trust?.keys[0];
  if (trust === undefined || key === undefined) return undefined;
  try {
    const artifact = sealedArtifactFromEnvelope(envelope);
    const expected = binding(artifact.payload);
    if (expected === undefined) return undefined;
    // why: `ArtifactSealer` takes a signer even to verify, and its `verify`
    // never signs, so the one it gets here refuses.
    const verifier = new ArtifactSealer({
      signer: { publicKeyRef: key, sign: () => Promise.reject(new Error("verify only")) }
    });
    const result = await verifier.verify(artifact, trust, {
      schema: { name: schema, version: 1 },
      purpose: PURPOSE,
      bindingId: expected.bindingId,
      sourceStateDigest: hex(expected.sourceStateDigest),
      now: new Date()
    });
    return result.ok ? artifact : undefined;
  } catch {
    return undefined;
  }
}
