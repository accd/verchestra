// Builds the T75 evidence index: the single record that binds what was
// qualified, on which platforms, under which gate profiles, at which revision
// (issue #16's completion checklist, matrix.md section 8).
//
// It reconciles two inputs, and reconciliation — not collection — is the point:
//
//   * `.specs/features/platform-qualification-matrix/matrix.json` — the DECLARED
//     matrix. Human-authored, reviewed, and bound to its canonical sources by
//     tests/agent-readiness/t75-matrix-declaration.test.mjs, so a case cannot be
//     silently dropped from it. It is a claim.
//   * the per-profile fleet indexes produced by `.github/workflows/platform-matrix.yml`
//     — the OBSERVED evidence, one per dispatched gate profile, each carrying
//     per-leg platform, arch, runtime, candidate revision and recomputed digests.
//
// A platform case is recorded as qualified only if every dispatched profile
// that covers it observed it qualified. Concatenating the two inputs instead
// would let an all-red fleet be published under a green declaration, which is a
// worse artifact than none: it carries the authority of evidence while
// contradicting it.
//
// The index also records every case that is NOT qualified. An index listing only
// what passed reports a green fleet by omission — the failure mode the whole
// matrix exists to prevent.
//
//   node scripts/t75-evidence-index.mjs --revision <sha> <fleet-index.json...>

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { canonicalizeJsonV2 } from "../packages/domain/src/index.ts";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MATRIX = resolve(ROOT, ".specs/features/platform-qualification-matrix/matrix.json");

// The declared vocabulary (matrix.md sections 6-7) and the observed vocabulary
// (platform-matrix.yml's index job). Neither is open: an unrecognised status
// would be counted as nothing by every tally below, so it is refused instead.
const DECLARED_STATUSES = new Set(["qualified", "contract-qualified", "not-qualified", "environmental"]);
const LEG_STATUSES = new Set(["qualified", "failed", "digest-mismatch", "missing"]);

// The fleet answers exactly one dimension. Only its cases are reconciled: a
// database engine's status is not something a platform leg can confirm or
// refute. Keyed on the dimension rather than on a case's prose evidence note,
// which is documentation and must not decide control flow.
const FLEET_DIMENSION = "platform";

// A leg that never ran carries no identity, and every field it would have
// carried is recorded as an explicit null rather than omitted: absent evidence
// has to be visible in the artifact, not inferred from a missing key.
const orNull = (value) => value ?? null;

function legRecord(leg) {
  if (!LEG_STATUSES.has(leg.status)) throw new Error(`leg ${leg.leg} reports unknown status ${leg.status}`);
  const identity = leg.identity ?? {};
  return {
    leg: leg.leg,
    status: leg.status,
    // Criterion 3 binds the runtime and the digests, not just the outcome. A
    // leg recorded without them cannot be re-checked against the run that
    // produced it, so they are carried through rather than projected away.
    platform: orNull(identity.platform),
    arch: orNull(identity.arch),
    runtime: orNull(identity.runtime),
    revision: orNull(identity.revision),
    identityDigest: orNull(leg.identityDigest),
    legDigest: orNull(leg.legDigest)
  };
}

function profileRecords(fleetIndexes, revision) {
  const runIds = new Set();
  return fleetIndexes.map((index) => {
    // A null revision is not a missing field: it is the workflow's own signal
    // that its legs disagreed about the candidate (platform-matrix.yml writes
    // the index and uploads it before throwing). Admitting it here would stamp
    // the candidate revision onto evidence its producer rejected.
    if (index.revision !== revision)
      throw new Error(
        `fleet index ${index.runId} binds ${index.revision === null ? "no single revision" : index.revision}, not the candidate ${revision}`
      );
    // Two dispatches of the same profile are two pieces of evidence. Keying by
    // gate would collapse a re-run over a failure it is meant to expose.
    if (runIds.has(index.runId)) throw new Error(`fleet index ${index.runId} appears twice`);
    runIds.add(index.runId);
    return { gate: index.gate, runId: index.runId, complete: index.complete, legs: index.legs.map(legRecord) };
  });
}

function observationsByLeg(profiles) {
  const observed = new Map();
  for (const profile of profiles) {
    for (const leg of profile.legs) {
      const entry = { gate: profile.gate, runId: profile.runId, status: leg.status };
      observed.set(leg.leg, [...(observed.get(leg.leg) ?? []), entry]);
    }
  }
  return observed;
}

// Fails closed in both directions. A case declared qualified is downgraded when
// the fleet does not agree; a case declared otherwise is never upgraded by an
// observation, because the declaration is reviewed and the run is not. Either
// way the disagreement is recorded, never resolved silently.
function fleetVerdict(item, observations) {
  const dissenting = observations.filter((entry) => entry.status !== "qualified");
  const cited = dissenting.map((entry) => `${entry.status} in ${entry.gate} (run ${entry.runId})`).join(", ");
  if (item.status === "qualified") {
    // Silence is not a pass: a leg no supplied profile covered has not been
    // observed to do anything.
    if (observations.length === 0)
      return {
        status: "not-qualified",
        contradiction: "declared qualified, but no supplied fleet profile covers this leg"
      };
    if (dissenting.length > 0)
      return { status: "not-qualified", contradiction: `declared qualified, but observed ${cited}` };
    return { status: item.status };
  }
  if (observations.length > 0 && dissenting.length === 0)
    return {
      status: item.status,
      contradiction: `declared ${item.status}, but every supplied profile observed it qualified; the declaration is stale`
    };
  return { status: item.status };
}

function reconcile(dimension, item, observed) {
  if (!DECLARED_STATUSES.has(item.status)) throw new Error(`case ${item.case} declares unknown status ${item.status}`);
  // Every case carries the note that says why it holds the status it holds. A
  // status without its reason is the row a reader cannot act on, so a
  // declaration missing one is refused by name here rather than surfacing later
  // as canonicalization rejecting an undefined.
  if (typeof item.evidence !== "string" || item.evidence.length === 0)
    throw new Error(`case ${item.case} declares no evidence note`);
  const base = { case: item.case, declaredStatus: item.status, status: item.status, evidence: item.evidence };
  // The fleet answers one dimension; everything else keeps the declaration's
  // word because nothing in the fleet can speak to it.
  if (dimension !== FLEET_DIMENSION) return { ...base, observed: [] };
  const observations = observed.get(item.case) ?? [];
  return { ...base, ...fleetVerdict(item, observations), observed: observations };
}

export function buildEvidenceIndex(matrix, fleetIndexes, revision) {
  if (typeof revision !== "string" || !/^[0-9a-f]{40}$/u.test(revision))
    throw new Error("revision must be a full 40-character commit sha");

  const profiles = profileRecords(fleetIndexes, revision);
  const observed = observationsByLeg(profiles);
  const dimensions = matrix.dimensions.map((entry) => ({
    dimension: entry.dimension,
    cases: entry.cases.map((item) => reconcile(entry.dimension, item, observed))
  }));

  const recorded = dimensions.flatMap((entry) => entry.cases);
  const counted = (status) => recorded.filter((item) => item.status === status).length;
  const body = {
    schemaVersion: 1,
    canonicalizationVersion: 2,
    task: "T75",
    revision,
    // Counted from the reconciled rows, so the summary cannot disagree with the
    // evidence beneath it or with the declaration above it.
    summary: {
      cases: recorded.length,
      qualified: counted("qualified"),
      contractQualified: counted("contract-qualified"),
      notQualified: counted("not-qualified"),
      environmental: counted("environmental"),
      contradictions: recorded.filter((item) => item.contradiction !== undefined).length
    },
    dimensions,
    profiles
  };

  return {
    ...body,
    // V2 canonical JSON, as docs/canonical-json-compatibility.md requires of any
    // new persistent-verification digest, and declared above as
    // `canonicalizationVersion` so a downstream verifier can recompute it
    // without guessing which algorithm produced these bytes.
    bodyDigest: `sha256:${createHash("sha256").update(canonicalizeJsonV2(body)).digest("hex")}`,
    // The index is NOT signed here, and says so rather than implying it.
    //
    // The repository's one signing precedent (scripts/generate-proof-artifact.mjs)
    // uses a committed TEST-ONLY key, which is honest for fixture data and would
    // be a category error here: this attests real qualification runs, so a
    // no-trust key would look like signed evidence while carrying none. Signing
    // it needs a release identity, which is a key-custody decision for the
    // repository owner and not something this generator may invent.
    //
    // AD-014 schedules the signature: the evidence index is in its scope list,
    // so it is sealed in the same change that migrates the sealer to DSSE. Until
    // then this is "not configured", never a pass — the same rule the product
    // applies to a missing provider, applied to its own evidence.
    signingState: {
      signed: false,
      reason:
        "No release signing identity is configured for qualification evidence. A TEST-ONLY key would carry no trust; signing is an owner key-custody decision, scheduled by AD-014."
    }
  };
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const revisionAt = args.indexOf("--revision");
  if (revisionAt === -1) throw new Error("usage: t75-evidence-index.mjs --revision <sha> <fleet-index.json...>");
  const revision = args[revisionAt + 1];
  const files = args.filter((_, i) => i !== revisionAt && i !== revisionAt + 1);
  if (files.length === 0) throw new Error("at least one fleet index file is required");
  const matrix = JSON.parse(await readFile(MATRIX, "utf8"));
  const fleet = await Promise.all(files.map(async (file) => JSON.parse(await readFile(file, "utf8"))));
  const index = buildEvidenceIndex(matrix, fleet, revision);
  await writeFile(resolve(ROOT, "t75-evidence-index.json"), `${JSON.stringify(index, null, 2)}\n`);
  console.log(
    `t75 evidence index written for ${revision}: ${index.summary.qualified}/${index.summary.cases} qualified, ${index.summary.contradictions} contradiction(s)`
  );
  // A contradiction means the published declaration and the observed fleet
  // disagree. The index records it either way, but the exit code refuses to let
  // a qualification step treat that as a clean generation.
  if (index.summary.contradictions > 0) process.exitCode = 1;
}
