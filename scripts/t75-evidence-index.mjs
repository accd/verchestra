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
// Written into the feature directory, not the repository root: the index
// generated at the qualification revision is committed beside t75-validation.md,
// which is what makes it citable rather than a number retyped out of a terminal.
const OUTPUT = resolve(ROOT, ".specs/features/platform-qualification-matrix/evidence-index.json");

// The declared vocabulary (matrix.md sections 6-7) and the observed vocabulary
// (platform-matrix.yml's index job). Neither is open: an unrecognised status
// would be counted as nothing by every tally below, so it is refused instead.
const DECLARED_STATUSES = new Set(["qualified", "contract-qualified", "not-qualified", "environmental"]);
const LEG_STATUSES = new Set(["qualified", "failed", "digest-mismatch", "missing"]);

// What a declaration that is not `qualified` is allowed to look like when the
// fleet observes it. Without this the declaration under verification decides how
// strictly it is verified: a leg labelled `environmental` could run and fail in
// every dispatch and the index would report nothing, because the only
// disagreement it checked was the too-good direction. `environmental` means the
// job never dequeued, so `missing` discharges it and `failed` does not -- a case
// that ran and failed is a product finding wearing an environmental label.
const CONSISTENT_DISSENT = Object.freeze({
  environmental: new Set(["missing"]),
  "not-qualified": new Set(["failed", "digest-mismatch", "missing", "incomplete"]),
  "contract-qualified": new Set([])
});

const dissentIsConsistent = (declared, status) => CONSISTENT_DISSENT[declared].has(status);

// The fleet answers two dimensions, and each has its own observable unit: a
// platform case is a leg, a gate-profile case is a whole dispatch. Everything
// else -- database engines, sandboxes, installers -- keeps the declaration's
// word, because nothing a fleet run produces can confirm or refute it. Keyed on
// the dimension rather than on a case's prose evidence note, which is
// documentation and must not decide control flow.
const FLEET_DIMENSIONS = new Set(["platform", "gate-profile"]);
const GATE_PREFIX = "gate:";

// A leg carries its own claim about which candidate it ran and its own digest
// over that claim. Both are re-checked here rather than transcribed: the
// workflow already verified them once, but an index is assembled from files, and
// a file that was edited after the run would otherwise enter the published
// record unexamined.
// A passing leg's sealed record is fully determined by what the fleet index
// carries: the workflow seals `{schemaVersion, identity, identityDigest,
// outcome}` and a pass fixes the outcome. So this digest is re-derived, not
// taken on trust, for every leg that claims to have passed -- which is every leg
// a qualification verdict actually rests on. A failed leg's `reported` value is
// not recoverable, so its digest stays transcribed and the index says so.
const PASSED_OUTCOME = Object.freeze({ result: "pass", reported: "success" });

function verifyLegDigest(leg) {
  const sealed = {
    schemaVersion: 2,
    identity: leg.identity,
    identityDigest: leg.identityDigest,
    outcome: PASSED_OUTCOME
  };
  const recomputed = `sha256:${createHash("sha256").update(JSON.stringify(sealed)).digest("hex")}`;
  if (leg.legDigest !== recomputed)
    throw new Error(`leg ${leg.leg} passed, but its leg digest does not cover the record that pass would have sealed`);
}

function verifyLeg(leg, revision) {
  const identity = leg.identity;
  // Checked for every leg that ran, whatever its outcome. A failed leg's
  // identity is exactly as load-bearing as a passing one's: it is what proves
  // the failure belongs to this candidate.
  if (identity.revision !== revision)
    throw new Error(`leg ${leg.leg} ran ${identity.revision}, not the candidate ${revision}`);
  // A `digest-mismatch` leg arrives with its identity and NO digests, because
  // the digests are precisely what failed to verify at the producer
  // (platform-matrix.yml emits `{leg, status, identity}` for this case). Demanding
  // them here would mean a tampered leg produces no index at all -- so the record
  // could not state that tampering was found, which is the one thing it most
  // needs to say.
  if (leg.status === "digest-mismatch") return;
  if (typeof leg.identityDigest !== "string")
    throw new Error(`leg ${leg.leg} carries an identity with no digest over it`);
  const recomputed = `sha256:${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`;
  if (leg.identityDigest !== recomputed)
    throw new Error(`leg ${leg.leg} carries an identity digest that does not cover its identity`);
  if (leg.status !== "qualified") return;
  // Absence refused by name. Caught only incidentally, the tamper path this
  // verification closes reopens by deleting the field instead of forging it.
  if (typeof leg.legDigest !== "string")
    throw new Error(`leg ${leg.leg} passed, but carries no leg digest over the record that pass sealed`);
  verifyLegDigest(leg);
}

// A leg that never ran carries no identity, and every field it would have
// carried is recorded as an explicit null rather than omitted: absent evidence
// has to be visible in the artifact, not inferred from a missing key.
const orNull = (value) => value ?? null;

function legRecord(leg, revision, declaredLegs) {
  if (!LEG_STATUSES.has(leg.status)) throw new Error(`leg ${leg.leg} reports unknown status ${leg.status}`);
  // Closed on the same reasoning as the gate vocabulary: a leg the matrix does
  // not declare is recorded in the profile and read by no case, so its result --
  // including its failure -- reaches the published index and counts for nothing.
  if (!declaredLegs.has(leg.leg)) throw new Error(`leg ${leg.leg} is not a platform the matrix declares`);
  if (leg.identity) verifyLeg(leg, revision);
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

function profileRecords(fleetIndexes, revision, declaredGates, declaredLegs) {
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
    // gate would collapse a re-run over the failure it is meant to expose.
    if (runIds.has(index.runId)) throw new Error(`fleet index ${index.runId} appears twice`);
    runIds.add(index.runId);
    // The gate vocabulary is the declaration's own gate-profile case set, so
    // there is no second list to drift out of step with it.
    // One spelling, checked once. A gate name accepted here and re-derived
    // differently later would key its evidence under a case that does not exist,
    // discarding the run and reporting a contradiction that never happened.
    if (!index.gate.startsWith(GATE_PREFIX) || !declaredGates.has(index.gate.slice(GATE_PREFIX.length)))
      throw new Error(`fleet index ${index.runId} ran ${index.gate}, which the matrix does not declare`);
    const legs = index.legs.map((leg) => legRecord(leg, revision, declaredLegs));
    // Two rows for one leg make the artifact order-dependent: whichever is read
    // last decides the coverage verdict while the other decides the case row, and
    // the two can disagree inside one file.
    const seen = new Set();
    for (const leg of legs) {
      if (seen.has(leg.leg)) throw new Error(`fleet index ${index.runId} reports leg ${leg.leg} twice`);
      seen.add(leg.leg);
    }
    // Recomputed, never transcribed: a profile is complete only if it actually
    // ran every leg green. An index that disagrees with itself is reported.
    const complete = legs.length > 0 && legs.every((leg) => leg.status === "qualified");
    if (index.complete !== complete)
      throw new Error(`fleet index ${index.runId} claims complete=${index.complete} but its legs say ${complete}`);
    return { gate: index.gate, runId: index.runId, complete, legs };
  });
}

// What a single dispatch proves about its profile. Judged against every declared
// platform case, not against the legs that happen to be in the file: a case the
// declaration expects green must be green here, and a case it does not expect
// green is excused only when this run observed something the declaration
// actually predicts. The excused set is recorded on the profile, so
// `gate-profile/security = qualified` can be read as what it is -- covered on
// these legs -- rather than as "ran everywhere".
function profileCoverage(profile, platformCases) {
  const byLeg = new Map(profile.legs.map((leg) => [leg.leg, leg.status]));
  const shortfall = [];
  const excused = [];
  for (const item of platformCases) {
    const status = byLeg.get(item.case) ?? "absent";
    if (item.status === "qualified") {
      if (status !== "qualified") shortfall.push(`${item.case}=${status}`);
      continue;
    }
    // A leg that came back green cannot be this profile's shortfall, whatever
    // the declaration expected of it. Exceeding a declaration is a stale
    // declaration -- reported on that case's own row -- not a coverage failure.
    if (status === "absent" || status === "qualified" || dissentIsConsistent(item.status, status))
      excused.push(`${item.case}=${status}`);
    else shortfall.push(`${item.case}=${status}`);
  }
  return { shortfall, excused };
}

// One observation table for both fleet-answerable dimensions. A platform case is
// observed once per profile that carried its leg; a gate-profile case is
// observed once per dispatch of that profile.
function fleetObservations(profiles) {
  const observed = new Map();
  const record = (dimension, name, entry) => {
    const key = `${dimension}/${name}`;
    observed.set(key, [...(observed.get(key) ?? []), entry]);
  };
  for (const profile of profiles) {
    const cite = { gate: profile.gate, runId: profile.runId };
    for (const leg of profile.legs) record("platform", leg.leg, { ...cite, status: leg.status });
    // The excused legs travel with the observation, so a reader of the
    // gate-profile row sees the scope the verdict was reached under without
    // having to join it back to the profile that produced it.
    record("gate-profile", profile.gate.slice(GATE_PREFIX.length), {
      ...cite,
      status: profile.shortfall.length === 0 ? "qualified" : "incomplete",
      ...(profile.shortfall.length === 0 ? {} : { detail: profile.shortfall.join(", ") }),
      ...(profile.excused.length === 0 ? {} : { excused: profile.excused })
    });
  }
  return observed;
}

const citation = (entry) =>
  `${entry.status}${entry.detail === undefined ? "" : ` (${entry.detail})`} in ${entry.gate} (run ${entry.runId})`;

// Fails closed in every direction the evidence can disagree. A case declared
// qualified is downgraded when the fleet does not agree. A case declared
// otherwise is never upgraded by an observation, because the declaration is
// reviewed and a run is not. And a case declared otherwise is still contradicted
// when the fleet observes something its declaration does not predict.
function fleetVerdict(item, observations) {
  const dissenting = observations.filter((entry) => entry.status !== "qualified");
  if (item.status === "qualified") {
    // Silence is not a pass: a case no supplied profile covered has not been
    // observed to do anything.
    if (observations.length === 0)
      return {
        status: "not-qualified",
        contradiction: "declared qualified, but no supplied fleet evidence covers this case"
      };
    if (dissenting.length > 0)
      return {
        status: "not-qualified",
        contradiction: `declared qualified, but observed ${dissenting.map(citation).join(", ")}`
      };
    return { status: item.status };
  }
  // One per-observation test for both ways a non-qualified declaration can be
  // wrong, because splitting them left the stale branch demanding unanimity: a
  // leg declared environmental that came back green in four dispatches and
  // absent in the fifth reported nothing. That is not exotic input -- it is what
  // Intel capacity returning looks like, and reporting the return is this
  // artifact's job. `qualified` is in no dissent set, so a green observation is
  // unpredicted by construction.
  const unpredicted = observations.filter((entry) => !dissentIsConsistent(item.status, entry.status));
  if (unpredicted.length > 0)
    return {
      // The declared status is preserved. A contradiction is a disagreement to
      // resolve by review, not a licence for the generator to relabel a case the
      // declaration was reviewed to say.
      status: item.status,
      contradiction:
        dissenting.length === 0
          ? `declared ${item.status}, but observed ${unpredicted.map(citation).join(", ")}; the declaration is stale`
          : `declared ${item.status}, which does not predict ${unpredicted.map(citation).join(", ")}`
    };
  return { status: item.status };
}

function reconcile(dimension, item, observed) {
  const base = { case: item.case, declaredStatus: item.status, status: item.status, evidence: item.evidence };
  if (!FLEET_DIMENSIONS.has(dimension)) return { ...base, observed: [] };
  const observations = observed.get(`${dimension}/${item.case}`) ?? [];
  return { ...base, ...fleetVerdict(item, observations), observed: observations };
}

// Validated before anything reads a status, so no later lookup has to carry a
// fallback for a value the declaration should never have contained. Every case
// also carries the note that says why it holds the status it holds: a status
// without its reason is a row a reader cannot act on.
function validateDeclaration(matrix) {
  for (const entry of matrix.dimensions)
    for (const item of entry.cases) {
      if (!DECLARED_STATUSES.has(item.status))
        throw new Error(`case ${item.case} declares unknown status ${item.status}`);
      if (typeof item.evidence !== "string" || item.evidence.length === 0)
        throw new Error(`case ${item.case} declares no evidence note`);
    }
}

export function buildEvidenceIndex(matrix, fleetIndexes, revision) {
  if (typeof revision !== "string" || !/^[0-9a-f]{40}$/u.test(revision))
    throw new Error("revision must be a full 40-character commit sha");

  // The declaration supplies its own gate vocabulary.
  const declaredGates = new Set(
    (matrix.dimensions.find((entry) => entry.dimension === "gate-profile")?.cases ?? []).map((item) => item.case)
  );
  validateDeclaration(matrix);
  const platformCases = matrix.dimensions.find((entry) => entry.dimension === "platform")?.cases ?? [];
  // A matrix expecting no platform to be green would qualify every profile for
  // free, since there would be nothing for a dispatch to fall short of.
  if (!platformCases.some((item) => item.status === "qualified"))
    throw new Error("the matrix declares no platform expected to be qualified, so no profile can be covered");
  const declaredLegs = new Set(platformCases.map((item) => item.case));
  const dispatched = profileRecords(fleetIndexes, revision, declaredGates, declaredLegs);
  const profiles = dispatched.map((profile) => ({ ...profile, ...profileCoverage(profile, platformCases) }));
  const observed = fleetObservations(profiles);
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
    // Which digests this index re-derived and which it copied. Presenting both
    // identically would let a reader take a transcribed value for a checked one.
    // `legDigest` covers the unsealed leg record, and the fleet index does not
    // carry that material -- its producer recomputes it and reports disagreement
    // as `digest-mismatch`, which this index treats as dissent.
    digestProvenance: {
      identityDigest: "recomputed",
      legDigest:
        "recomputed for passing legs; transcribed otherwise, because a failed leg's reported value is not recoverable from the fleet index"
    },
    dimensions,
    // `shortfall` drove the gate-profile verdict and is already spelled out in
    // that case's contradiction; `excused` stays, because it is the scope the
    // coverage claim was made under.
    profiles: profiles.map((profile) =>
      Object.fromEntries(Object.entries(profile).filter(([field]) => field !== "shortfall"))
    )
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
  if (revisionAt === -1 || args[revisionAt + 1] === undefined)
    throw new Error("usage: t75-evidence-index.mjs --revision <sha> [--out <path>] <fleet-index.json...>");
  const revision = args[revisionAt + 1];
  const outAt = args.indexOf("--out");
  if (outAt !== -1 && args[outAt + 1] === undefined) throw new Error("--out needs a path");
  const output = outAt === -1 ? OUTPUT : args[outAt + 1];
  // `pnpm run <script> -- --revision ...` forwards the separator verbatim, which
  // is the invocation style AGENTS.md documents; treat it as the no-op it is.
  // `outAt` is -1 when absent, and -1 + 1 is 0, which would silently drop the
  // first supplied file.
  const consumed = new Set(
    outAt === -1 ? [revisionAt, revisionAt + 1] : [revisionAt, revisionAt + 1, outAt, outAt + 1]
  );
  const files = args.filter((value, i) => !consumed.has(i) && value !== "--");
  if (files.length === 0) throw new Error("at least one fleet index file is required");
  const matrix = JSON.parse(await readFile(MATRIX, "utf8"));
  const fleet = await Promise.all(files.map(async (file) => JSON.parse(await readFile(file, "utf8"))));
  const index = buildEvidenceIndex(matrix, fleet, revision);
  await writeFile(output, `${JSON.stringify(index, null, 2)}\n`);
  console.log(
    `t75 evidence index written for ${revision}: ${index.summary.qualified}/${index.summary.cases} qualified, ${index.summary.contradictions} contradiction(s)`
  );
  // A contradiction means the published declaration and the observed fleet
  // disagree. The index records it either way, but the exit code refuses to let
  // a qualification step treat that as a clean generation.
  if (index.summary.contradictions > 0) process.exitCode = 1;
}
