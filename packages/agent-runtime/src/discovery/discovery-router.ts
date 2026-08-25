import { createHash } from "node:crypto";

import { canonicalizeJsonV2, dropUndefinedMembers } from "@verchestra/domain";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SAFE = /^[a-z0-9][a-z0-9._:@/+\-]{0,255}$/u;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const REQUIRED_INTAKE = [
  "stack",
  "applications",
  "buildCommands",
  "testCommands",
  "architectureSources",
  "projectBoundaries",
  "trackers",
  "knowledgeSources",
  "databaseRegistrations",
  "aiArtifacts"
] as const;
const READ_ONLY_CAPABILITIES = ["read", "search"] as const;

export class DiscoveryRouterError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "DiscoveryRouterError";
    this.code = code;
  }
}

interface IntakeValue {
  readonly value: readonly unknown[];
  readonly provenance: readonly { readonly sourceId: string; readonly revision: string; readonly digest: string }[];
}

interface DiscoveryIntakeInput {
  readonly projectId: string;
  readonly projectClass: string;
  readonly documentation: { readonly present: boolean; readonly reliable: boolean; readonly stale: boolean };
  readonly sections: Readonly<Record<string, IntakeValue | undefined>>;
}

interface Qualification {
  readonly strategy: "reversa" | "codenavi";
  readonly status: "qualified" | "failed";
  readonly projectClasses: readonly string[];
  readonly benefit: "positive" | "neutral" | "negative";
  readonly evidenceDigest: string;
  readonly expiresAt: string;
}

interface DiscoveryRequest {
  readonly projectId: string;
  readonly projectClass: string;
  readonly documentation: { readonly present: boolean; readonly reliable: boolean; readonly stale: boolean };
  readonly policy: { readonly reversaAllowed: boolean; readonly codeNaviAllowed: boolean };
  readonly evaluatedAt: string;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(canonicalizeJsonV2(dropUndefinedMembers(value)))
    .digest("hex")}`;
}

function validInstant(value: unknown): value is string {
  if (typeof value !== "string" || !INSTANT.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function qualified(
  strategy: "reversa" | "codenavi",
  request: DiscoveryRequest,
  qualifications: readonly Qualification[]
): Qualification | undefined {
  return qualifications.find(
    (entry) =>
      entry.strategy === strategy &&
      entry.status === "qualified" &&
      entry.benefit === "positive" &&
      entry.projectClasses.includes(request.projectClass) &&
      DIGEST.test(entry.evidenceDigest) &&
      validInstant(entry.expiresAt) &&
      entry.expiresAt > request.evaluatedAt
  );
}

function assertLogicalPath(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/u.test(value) ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  )
    throw new DiscoveryRouterError("VES_DISCOVERY_ANCHOR_INVALID", "Discovery anchor path is invalid");
}

export class DiscoveryRouter {
  readonly #limits: {
    readonly maximumEvidence: number;
    readonly maximumFindings: number;
    readonly maximumContentBytes: number;
  };
  constructor(limits = { maximumEvidence: 500, maximumFindings: 500, maximumContentBytes: 1_000_000 }) {
    this.#limits = limits;
  }

  intake(input: DiscoveryIntakeInput) {
    if (!SAFE.test(input.projectId) || !SAFE.test(input.projectClass))
      throw new DiscoveryRouterError("VES_DISCOVERY_INTAKE_INVALID", "Discovery intake identity is invalid");
    const sections: Record<string, IntakeValue> = {};
    const missing: string[] = [];
    for (const name of REQUIRED_INTAKE) {
      const section = input.sections[name];
      if (section === undefined || section.value.length === 0) {
        missing.push(name);
        sections[name] = Object.freeze({ value: Object.freeze([]), provenance: Object.freeze([]) });
        continue;
      }
      if (
        section.provenance.length === 0 ||
        section.provenance.some(
          (entry) => !SAFE.test(entry.sourceId) || entry.revision.length === 0 || !DIGEST.test(entry.digest)
        )
      )
        throw new DiscoveryRouterError("VES_DISCOVERY_PROVENANCE_INVALID", "Discovery intake provenance is invalid");
      sections[name] = Object.freeze({
        value: Object.freeze(structuredClone(section.value)),
        provenance: Object.freeze(section.provenance.map((entry) => Object.freeze({ ...entry })))
      });
    }
    const report = {
      schemaVersion: 1,
      projectId: input.projectId,
      projectClass: input.projectClass,
      documentation: Object.freeze({ ...input.documentation }),
      sections: Object.freeze(sections),
      missingMandatoryInformation: Object.freeze(missing.sort())
    };
    return Object.freeze({ ...report, intakeDigest: digest(report) });
  }

  choose(request: DiscoveryRequest, qualifications: readonly Qualification[]) {
    if (!SAFE.test(request.projectId) || !SAFE.test(request.projectClass) || !validInstant(request.evaluatedAt))
      throw new DiscoveryRouterError("VES_DISCOVERY_REQUEST_INVALID", "Discovery request is invalid");
    const needsRecon = !request.documentation.present || !request.documentation.reliable || request.documentation.stale;
    const reversa = qualified("reversa", request, qualifications);
    const codeNavi = qualified("codenavi", request, qualifications);
    const primary =
      needsRecon && request.policy.reversaAllowed && reversa !== undefined
        ? "reversa"
        : needsRecon
          ? "builtin-recon"
          : "builtin-intake";
    const supplemental = request.policy.codeNaviAllowed && codeNavi !== undefined ? ["codenavi"] : [];
    const decision = {
      projectId: request.projectId,
      primary,
      supplemental: Object.freeze(supplemental),
      capabilities: Object.freeze([...READ_ONLY_CAPABILITIES]),
      lifecycleOwners: Object.freeze([]),
      humanReviewRequired: primary !== "builtin-intake" || supplemental.length > 0,
      qualificationEvidence: Object.freeze(
        [
          primary === "reversa" ? reversa?.evidenceDigest : undefined,
          supplemental.length > 0 ? codeNavi?.evidenceDigest : undefined
        ].filter((entry): entry is string => entry !== undefined)
      )
    };
    return Object.freeze({ ...decision, decisionDigest: digest(decision) });
  }

  normalize(output: Readonly<Record<string, unknown>>) {
    const strategy = output["strategy"];
    if (!["builtin-intake", "builtin-recon", "reversa", "codenavi"].includes(strategy as string))
      throw new DiscoveryRouterError("VES_DISCOVERY_OUTPUT_INVALID", "Discovery strategy output is invalid");
    const capabilities = output["capabilities"];
    if (
      !Array.isArray(capabilities) ||
      capabilities.length !== 2 ||
      [...capabilities].sort().join(",") !== "read,search"
    )
      throw new DiscoveryRouterError(
        "VES_DISCOVERY_CAPABILITY_VIOLATION",
        "Discovery strategy exceeded read-only capability"
      );
    const owners = output["lifecycleOwners"];
    if (!Array.isArray(owners) || owners.length !== 0)
      throw new DiscoveryRouterError("VES_DISCOVERY_OWNER_VIOLATION", "Discovery strategy cannot own lifecycle phases");
    const persistentPaths = output["persistentPaths"];
    if (!Array.isArray(persistentPaths) || persistentPaths.some((path) => typeof path !== "string" || path.length > 0))
      throw new DiscoveryRouterError(
        "VES_DISCOVERY_PERSISTENCE_VIOLATION",
        "Discovery strategy cannot persist tool-owned project state"
      );
    const anchors = output["anchors"];
    const evidence = output["evidence"];
    const findings = output["findings"];
    if (!Array.isArray(anchors) || !Array.isArray(evidence) || !Array.isArray(findings))
      throw new DiscoveryRouterError("VES_DISCOVERY_OUTPUT_INVALID", "Discovery packet collections are invalid");
    if (evidence.length > this.#limits.maximumEvidence || findings.length > this.#limits.maximumFindings)
      throw new DiscoveryRouterError("VES_DISCOVERY_OUTPUT_LIMIT", "Discovery packet exceeds item limits");
    const anchorIds = new Set<string>();
    const normalizedAnchors = anchors.map((raw) => {
      const anchor = raw as Record<string, unknown>;
      if (!SAFE.test(anchor["id"] as string) || anchorIds.has(anchor["id"] as string))
        throw new DiscoveryRouterError("VES_DISCOVERY_ANCHOR_INVALID", "Discovery anchor identity is invalid");
      assertLogicalPath(anchor["logicalPath"]);
      if (
        !SAFE.test(anchor["projectId"] as string) ||
        !Number.isSafeInteger(anchor["startLine"]) ||
        !Number.isSafeInteger(anchor["endLine"]) ||
        (anchor["startLine"] as number) < 1 ||
        (anchor["endLine"] as number) < (anchor["startLine"] as number) ||
        !DIGEST.test(anchor["contentDigest"] as string)
      )
        throw new DiscoveryRouterError("VES_DISCOVERY_ANCHOR_INVALID", "Discovery anchor is invalid");
      anchorIds.add(anchor["id"] as string);
      return Object.freeze({ ...anchor });
    });
    let contentBytes = 0;
    const evidenceIds = new Set<string>();
    const normalizedEvidence = evidence.map((raw) => {
      const item = raw as Record<string, unknown>;
      const source = item["source"] as Record<string, unknown> | undefined;
      const content = item["content"];
      const itemAnchors = item["anchorIds"];
      if (
        !SAFE.test(item["id"] as string) ||
        evidenceIds.has(item["id"] as string) ||
        typeof content !== "string" ||
        source === undefined ||
        !SAFE.test(source["identity"] as string) ||
        typeof source["revision"] !== "string" ||
        source["revision"].length === 0 ||
        !validInstant(source["retrievedAt"]) ||
        !["public", "internal", "confidential", "restricted"].includes(source["classification"] as string) ||
        !DIGEST.test(source["contentDigest"] as string) ||
        !Array.isArray(itemAnchors) ||
        itemAnchors.some((id) => !anchorIds.has(id as string))
      )
        throw new DiscoveryRouterError("VES_DISCOVERY_EVIDENCE_INVALID", "Discovery evidence provenance is invalid");
      contentBytes += Buffer.byteLength(content);
      evidenceIds.add(item["id"] as string);
      return Object.freeze({
        ...item,
        trust: "untrusted",
        source: Object.freeze({ ...source }),
        anchorIds: Object.freeze([...itemAnchors])
      });
    });
    if (contentBytes > this.#limits.maximumContentBytes)
      throw new DiscoveryRouterError("VES_DISCOVERY_OUTPUT_LIMIT", "Discovery packet content exceeds its limit");
    const normalizedFindings = findings.map((raw) => {
      const finding = raw as Record<string, unknown>;
      if (
        !SAFE.test(finding["id"] as string) ||
        !["available", "missing", "stale", "contradictory", "outside-scope"].includes(finding["status"] as string) ||
        typeof finding["detail"] !== "string" ||
        !Array.isArray(finding["sourceIds"]) ||
        finding["sourceIds"].some((id) => !evidenceIds.has(id as string))
      )
        throw new DiscoveryRouterError("VES_DISCOVERY_FINDING_INVALID", "Discovery finding is invalid");
      return Object.freeze({
        ...finding,
        assumption: false,
        sourceIds: Object.freeze([...(finding["sourceIds"] as unknown[])])
      });
    });
    const packet = {
      schemaVersion: 1,
      strategy,
      generatedAt: output["generatedAt"],
      anchors: Object.freeze(normalizedAnchors),
      evidence: Object.freeze(normalizedEvidence),
      findings: Object.freeze(normalizedFindings),
      humanReviewRequired: true,
      promotionStatus: "pending-review",
      capabilities: Object.freeze([...READ_ONLY_CAPABILITIES]),
      lifecycleOwners: Object.freeze([]),
      persistentPaths: Object.freeze([])
    };
    if (!validInstant(packet.generatedAt))
      throw new DiscoveryRouterError("VES_DISCOVERY_OUTPUT_INVALID", "Discovery generation time is invalid");
    return Object.freeze({ ...packet, packetDigest: digest(packet) });
  }
}
