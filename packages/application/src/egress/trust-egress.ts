import {
  DataClassification,
  IsoInstant,
  StableId,
  canonicalizeJsonV2,
  type DataClassificationValue
} from "@verchestra/domain";

import type { ContentDigestPort } from "../sync/workspace-reconcile.ts";

const TRUST_CLASSES = ["authority", "verified-evidence", "untrusted-data", "generated-content"] as const;
const SAFE_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,511}$/u;

export type TrustClass = (typeof TRUST_CLASSES)[number];

export class EgressError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "EgressError";
    this.code = code;
  }
}

export interface SourceIdentity {
  readonly kind: string;
  readonly identity: string;
  readonly revision: string;
}

export interface TrustEnvelope {
  readonly schemaVersion: 1;
  readonly fragmentId: string;
  readonly workspaceId: string;
  readonly source: SourceIdentity;
  readonly retrievedAt: string;
  readonly classification: DataClassificationValue;
  readonly trust: TrustClass;
  readonly contentDigest: string;
  readonly content: string;
  readonly inputFragmentIds: readonly string[];
  readonly declassificationEvidenceId?: string;
  readonly declassification?: {
    readonly evidenceId: string;
    readonly purpose: string;
    readonly destinationId: string;
    readonly expiresAt: string;
  };
  readonly declassificationEvidence?: DeclassificationEvidence;
}

export interface DeclassificationEvidence {
  readonly evidenceId: string;
  readonly workspaceId: string;
  readonly sourceContentDigest: string;
  readonly from: DataClassificationValue;
  readonly to: DataClassificationValue;
  readonly purpose: string;
  readonly destinationId: string;
  readonly approver: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly signature: string;
}

export interface DeclassificationVerifierPort {
  verify(evidence: DeclassificationEvidence): Promise<boolean>;
}

function safe(value: string, field: string): void {
  if (!SAFE_VALUE.test(value)) throw new EgressError("VES_TRUST_ENVELOPE_INVALID", `${field} is invalid`);
}

function cloneSource(source: SourceIdentity): SourceIdentity {
  safe(source.kind, "source.kind");
  safe(source.identity, "source.identity");
  safe(source.revision, "source.revision");
  return Object.freeze({ ...source });
}

function assertContent(content: string): void {
  if (content.length > 10_000_000 || /[\u0000]/u.test(content))
    throw new EgressError("VES_TRUST_ENVELOPE_INVALID", "Content is outside bounded text limits");
}

export class TrustEnvelopeService {
  readonly #digest: ContentDigestPort;
  readonly #declassification: DeclassificationVerifierPort | undefined;

  constructor(options: {
    readonly digest: ContentDigestPort;
    readonly declassification?: DeclassificationVerifierPort;
  }) {
    this.#digest = options.digest;
    this.#declassification = options.declassification;
  }

  source(input: {
    readonly fragmentId: string;
    readonly workspaceId: string;
    readonly source: SourceIdentity;
    readonly retrievedAt: string;
    readonly classification: DataClassificationValue;
    readonly trust: TrustClass;
    readonly content: string;
  }): TrustEnvelope {
    StableId.parse(input.fragmentId, "fragment");
    StableId.parse(input.workspaceId, "workspace");
    IsoInstant.parse(input.retrievedAt);
    const classification = DataClassification.parse(input.classification).value;
    if (!TRUST_CLASSES.includes(input.trust))
      throw new EgressError("VES_TRUST_ENVELOPE_INVALID", "Trust class is invalid");
    assertContent(input.content);
    return Object.freeze({
      schemaVersion: 1,
      fragmentId: input.fragmentId,
      workspaceId: input.workspaceId,
      source: cloneSource(input.source),
      retrievedAt: input.retrievedAt,
      classification,
      trust: input.trust,
      contentDigest: this.#digest.sha256(input.content),
      content: input.content,
      inputFragmentIds: Object.freeze([])
    });
  }

  generated(input: {
    readonly fragmentId: string;
    readonly workspaceId: string;
    readonly inputs: readonly TrustEnvelope[];
    readonly content: string;
    readonly generatedAt: string;
  }): TrustEnvelope {
    StableId.parse(input.fragmentId, "fragment");
    StableId.parse(input.workspaceId, "workspace");
    IsoInstant.parse(input.generatedAt);
    if (input.inputs.length === 0 || input.inputs.some((entry) => entry.workspaceId !== input.workspaceId))
      throw new EgressError("VES_TRUST_ENVELOPE_INVALID", "Generated content inputs are invalid");
    assertContent(input.content);
    const classification = DataClassification.mostRestrictive(
      input.inputs.map((entry) => DataClassification.parse(entry.classification))
    ).value;
    return Object.freeze({
      schemaVersion: 1,
      fragmentId: input.fragmentId,
      workspaceId: input.workspaceId,
      source: Object.freeze({
        kind: "generated",
        identity: "controller",
        revision: this.#digest.sha256(canonicalizeJsonV2(input.inputs.map((entry) => entry.contentDigest)))
      }),
      retrievedAt: input.generatedAt,
      classification,
      trust: "generated-content",
      contentDigest: this.#digest.sha256(input.content),
      content: input.content,
      inputFragmentIds: Object.freeze(input.inputs.map((entry) => entry.fragmentId))
    });
  }

  async declassify(envelope: TrustEnvelope, evidence: DeclassificationEvidence): Promise<TrustEnvelope> {
    const from = DataClassification.parse(evidence.from);
    const to = DataClassification.parse(evidence.to);
    let signatureValid = false;
    try {
      signatureValid = (await this.#declassification?.verify(evidence)) === true;
    } catch {
      signatureValid = false;
    }
    const valid =
      signatureValid &&
      evidence.workspaceId === envelope.workspaceId &&
      evidence.sourceContentDigest === envelope.contentDigest &&
      evidence.from === envelope.classification &&
      from.rank > to.rank &&
      SAFE_VALUE.test(evidence.purpose) &&
      SAFE_VALUE.test(evidence.destinationId) &&
      SAFE_VALUE.test(evidence.approver) &&
      IsoInstant.parse(evidence.issuedAt).compare(IsoInstant.parse(evidence.expiresAt)) < 0;
    if (!valid) throw new EgressError("VES_DECLASSIFICATION_INVALID", "Declassification evidence is invalid");
    return Object.freeze({
      ...envelope,
      classification: to.value,
      declassificationEvidenceId: evidence.evidenceId,
      declassification: Object.freeze({
        evidenceId: evidence.evidenceId,
        purpose: evidence.purpose,
        destinationId: evidence.destinationId,
        expiresAt: evidence.expiresAt
      }),
      declassificationEvidence: Object.freeze({ ...evidence })
    });
  }
}

export interface DestinationProfile {
  readonly destinationId: string;
  readonly kind: "local" | "external";
  readonly endpoint: string;
  readonly workspaceId: string;
  readonly maximumClassification: DataClassificationValue;
  readonly allowedPurposes: readonly string[];
  readonly allowedRetention: readonly string[];
}

export interface EgressPolicyPort {
  authorize(request: unknown): Promise<{ readonly decision: string; readonly evidenceDigest: string }>;
}

export interface EgressAuthorityPort {
  verify(input: {
    readonly workspaceId: string;
    readonly runId: string;
    readonly approvalRef: string;
    readonly capabilityRef: string;
    readonly destinationId: string;
    readonly purpose: string;
  }): Promise<{ readonly approvalValid: boolean; readonly capabilityValid: boolean }>;
}

type EgressVerdict = Readonly<Record<string, unknown>> & { readonly allowed: boolean; readonly code: string };

export class DataEgressFirewall {
  readonly #digest: ContentDigestPort;
  readonly #destinations: ReadonlyMap<string, DestinationProfile>;
  readonly #policy: EgressPolicyPort;
  readonly #authority: EgressAuthorityPort;
  readonly #declassification: DeclassificationVerifierPort | undefined;
  readonly #now: () => string;

  constructor(options: {
    readonly digest: ContentDigestPort;
    readonly destinations: readonly DestinationProfile[];
    readonly policy: EgressPolicyPort;
    readonly authority: EgressAuthorityPort;
    readonly declassification?: DeclassificationVerifierPort;
    readonly now?: () => string;
  }) {
    this.#digest = options.digest;
    if (new Set(options.destinations.map((entry) => entry.destinationId)).size !== options.destinations.length)
      throw new EgressError("VES_EGRESS_PROFILE_INVALID", "Destination identities must be unique");
    this.#destinations = new Map(
      options.destinations.map((entry) => [entry.destinationId, Object.freeze({ ...entry })])
    );
    this.#policy = options.policy;
    this.#authority = options.authority;
    this.#declassification = options.declassification;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async authorize(input: {
    readonly workspaceId: string;
    readonly runId: string;
    readonly mode: "online" | "offline" | "no-egress";
    readonly fragments: readonly TrustEnvelope[];
    readonly purpose: string;
    readonly destinationId: string;
    readonly retention: string;
    readonly approvalRef: string;
    readonly capabilityRef: string;
  }): Promise<EgressVerdict> {
    const deny = (code: string): EgressVerdict => Object.freeze({ allowed: false, code });
    try {
      StableId.parse(input.workspaceId, "workspace");
      StableId.parse(input.runId, "run");
    } catch {
      return deny("VES_EGRESS_INPUT_INVALID");
    }
    if (input.fragments.length === 0) return deny("VES_EGRESS_FRAGMENT_INVALID");
    for (const fragment of input.fragments) {
      try {
        DataClassification.parse(fragment.classification);
        const declassificationParts = [
          fragment.declassificationEvidenceId,
          fragment.declassification,
          fragment.declassificationEvidence
        ].filter((value) => value !== undefined).length;
        if (
          !TRUST_CLASSES.includes(fragment.trust) ||
          fragment.contentDigest !== this.#digest.sha256(fragment.content) ||
          fragment.declassificationEvidenceId !== fragment.declassification?.evidenceId ||
          (declassificationParts !== 0 && declassificationParts !== 3)
        )
          return deny("VES_EGRESS_FRAGMENT_INVALID");
      } catch {
        return deny("VES_EGRESS_FRAGMENT_INVALID");
      }
    }
    const destination = this.#destinations.get(input.destinationId);
    if (destination === undefined) return deny("VES_EGRESS_DESTINATION_DENIED");
    if (
      destination.workspaceId !== input.workspaceId ||
      input.fragments.some((entry) => entry.workspaceId !== input.workspaceId)
    )
      return deny("VES_EGRESS_WORKSPACE_DENIED");
    if (destination.kind === "external" && input.mode !== "online") return deny("VES_EGRESS_NETWORK_MODE_DENIED");
    if (!destination.allowedPurposes.includes(input.purpose)) return deny("VES_EGRESS_PURPOSE_DENIED");
    if (!destination.allowedRetention.includes(input.retention)) return deny("VES_EGRESS_RETENTION_DENIED");
    for (const fragment of input.fragments) {
      if (
        fragment.declassification !== undefined &&
        (!(await this.#validDeclassification(fragment)) ||
          fragment.declassification.purpose !== input.purpose ||
          fragment.declassification.destinationId !== input.destinationId ||
          IsoInstant.parse(fragment.declassification.expiresAt).compare(IsoInstant.parse(this.#now())) <= 0)
      )
        return deny("VES_EGRESS_DECLASSIFICATION_DENIED");
    }
    const ceiling = DataClassification.parse(destination.maximumClassification);
    if (input.fragments.some((entry) => DataClassification.parse(entry.classification).rank > ceiling.rank))
      return deny("VES_EGRESS_CLASSIFICATION_DENIED");
    if (destination.kind === "external") {
      let authority;
      try {
        authority = await this.#authority.verify({
          workspaceId: input.workspaceId,
          runId: input.runId,
          approvalRef: input.approvalRef,
          capabilityRef: input.capabilityRef,
          destinationId: input.destinationId,
          purpose: input.purpose
        });
      } catch {
        return deny("VES_EGRESS_AUTHORITY_DENIED");
      }
      if (!authority.approvalValid || !authority.capabilityValid) return deny("VES_EGRESS_AUTHORITY_DENIED");
    }
    const manifest = Object.freeze({
      schemaVersion: 1,
      workspaceId: input.workspaceId,
      runId: input.runId,
      mode: input.mode,
      destinationId: input.destinationId,
      destinationKind: destination.kind,
      endpoint: destination.endpoint,
      purpose: input.purpose,
      retention: input.retention,
      fragments: Object.freeze(
        input.fragments.map((entry) =>
          Object.freeze({
            fragmentId: entry.fragmentId,
            classification: entry.classification,
            trust: entry.trust,
            contentDigest: entry.contentDigest,
            ...(entry.declassificationEvidenceId === undefined
              ? {}
              : { declassificationEvidenceId: entry.declassificationEvidenceId })
          })
        )
      )
    });
    let policy;
    try {
      policy = await this.#policy.authorize(manifest);
    } catch {
      return deny("VES_EGRESS_POLICY_FAILURE");
    }
    if (policy.decision !== "allow") return deny("VES_EGRESS_POLICY_DENIED");
    return Object.freeze({
      allowed: true,
      code: "VES_EGRESS_ALLOWED",
      egressDigest: this.#digest.sha256(canonicalizeJsonV2(manifest)),
      policyEvidenceDigest: policy.evidenceDigest,
      fragmentIds: Object.freeze(input.fragments.map((entry) => entry.fragmentId)),
      destinationId: input.destinationId
    });
  }

  async #validDeclassification(fragment: TrustEnvelope): Promise<boolean> {
    const evidence = fragment.declassificationEvidence;
    if (fragment.declassification === undefined || evidence === undefined || this.#declassification === undefined)
      return false;
    try {
      return (
        evidence.evidenceId === fragment.declassification.evidenceId &&
        evidence.workspaceId === fragment.workspaceId &&
        evidence.sourceContentDigest === fragment.contentDigest &&
        evidence.to === fragment.classification &&
        evidence.purpose === fragment.declassification.purpose &&
        evidence.destinationId === fragment.declassification.destinationId &&
        evidence.expiresAt === fragment.declassification.expiresAt &&
        DataClassification.parse(evidence.from).rank > DataClassification.parse(evidence.to).rank &&
        (await this.#declassification.verify(evidence))
      );
    } catch {
      return false;
    }
  }
}
