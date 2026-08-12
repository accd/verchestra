// Builds the T75 evidence index: the single record that binds what was
// qualified, on which platforms, under which gate profiles, at which revision
// (issue #16's completion checklist, matrix.md section 8).
//
// It merges two inputs that neither can replace:
//
//   * `.specs/features/platform-qualification-matrix/matrix.json` — the DECLARED
//     matrix. Human-authored, reviewed, and bound to its canonical sources by
//     tests/agent-readiness/t75-matrix-declaration.test.mjs, so a case cannot be
//     silently dropped from it.
//   * the per-profile fleet indexes produced by `.github/workflows/platform-matrix.yml`
//     — the OBSERVED evidence, one per dispatched gate profile, each carrying
//     per-leg platform, arch, runtime, candidate revision and recomputed digests.
//
// The declaration alone is a claim; the fleet evidence alone covers only the
// platform dimension. The index is the join, and it states every dimension's
// status including the ones that are not qualified — an index listing only what
// passed would report a green fleet by omission, which is the failure mode the
// whole matrix exists to prevent.
//
//   node scripts/t75-evidence-index.mjs --revision <sha> <fleet-index.json...>

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MATRIX = resolve(ROOT, ".specs/features/platform-qualification-matrix/matrix.json");

export function buildEvidenceIndex(matrix, fleetIndexes, revision) {
  if (typeof revision !== "string" || !/^[0-9a-f]{40}$/u.test(revision))
    throw new Error("revision must be a full 40-character commit sha");

  // Every leg of every profile must speak about the same candidate. Evidence
  // collected at different revisions is not evidence about one release.
  for (const index of fleetIndexes) {
    if (index.revision !== null && index.revision !== revision)
      throw new Error(`fleet index ${index.runId} binds ${index.revision}, not the candidate ${revision}`);
  }

  const profiles = fleetIndexes.map((index) => ({
    gate: index.gate,
    runId: index.runId,
    complete: index.complete,
    legs: index.legs.map((leg) => ({ leg: leg.leg, status: leg.status, legDigest: leg.legDigest ?? null }))
  }));

  const dimensions = matrix.dimensions.map((entry) => ({
    dimension: entry.dimension,
    cases: entry.cases.map((item) => ({ case: item.case, status: item.status, evidence: item.evidence }))
  }));

  const declared = dimensions.flatMap((entry) => entry.cases);
  const body = {
    schemaVersion: 1,
    task: "T75",
    revision,
    // Counted rather than asserted, so the summary cannot drift from the rows.
    summary: {
      cases: declared.length,
      qualified: declared.filter((item) => item.status === "qualified").length,
      contractQualified: declared.filter((item) => item.status === "contract-qualified").length,
      notQualified: declared.filter((item) => item.status === "not-qualified").length,
      environmental: declared.filter((item) => item.status === "environmental").length
    },
    dimensions,
    profiles
  };

  return {
    ...body,
    bodyDigest: `sha256:${createHash("sha256").update(JSON.stringify(body)).digest("hex")}`,
    // The index is NOT signed here, and says so rather than implying it.
    //
    // The repository's one signing precedent (scripts/generate-proof-artifact.mjs)
    // uses a committed TEST-ONLY key, which is honest for fixture data and would
    // be a category error here: this attests real qualification runs, so a
    // no-trust key would look like signed evidence while carrying none. Signing
    // it needs a release identity, which is a key-custody decision for the
    // repository owner and not something this generator may invent.
    //
    // "not configured", never a pass — the same rule the product applies to a
    // missing provider, applied to its own evidence.
    signingState: {
      signed: false,
      reason:
        "No release signing identity is configured for qualification evidence. A TEST-ONLY key would carry no trust; signing is an owner key-custody decision."
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
    `t75 evidence index written for ${revision}: ${index.summary.qualified}/${index.summary.cases} qualified`
  );
}
