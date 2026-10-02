import { readdir } from "node:fs/promises";
import { join } from "node:path";

import type { GateAttemptFeedback, GateFailure } from "@verchestra/application";

import { stateInvalid } from "./task-errors.ts";
import { canonicalDigest, objectRow, readSealedRecord, writeSealedRecord } from "./task-files.ts";

type Digest = `sha256:${string}`;
type Row = Readonly<Record<string, unknown>>;

interface StoredGateEvidence {
  readonly entry: Row;
  readonly changeDigest: string;
  readonly sequence: number;
}

// invariant: gate evidence is kept as the coordinator emitted it, sealed by
// digest, plus the change it judged, so a resumed run can prove which
// evidence its task commit cites without re-running a gate.
// invariant: the store asks for its directory before every read and write, so
// the Run record that opens it decides each time whether that directory may be
// reached.
export class TaskEvidenceStore {
  readonly #directory: () => Promise<string>;
  #changeDigest = "";

  constructor(directory: () => Promise<string>) {
    this.#directory = directory;
  }

  judging(changeDigest: string): void {
    this.#changeDigest = changeDigest;
  }

  async record(entry: Row): Promise<{ readonly evidenceRef: string; readonly evidenceDigest: Digest }> {
    const evidenceDigest = canonicalDigest(entry);
    const evidenceRef = `gate-evidence:${evidenceDigest.slice(7, 39)}`;
    const root = await this.#directory();
    const existing = await readdir(root).catch(() => [] as string[]);
    const stored: StoredGateEvidence = { entry, changeDigest: this.#changeDigest, sequence: existing.length + 1 };
    await writeSealedRecord(join(root, `${evidenceRef.slice(14)}.json`), stored);
    return { evidenceRef, evidenceDigest };
  }

  async load(evidenceRef: string): Promise<Row | undefined> {
    if (!/^gate-evidence:[a-f0-9]{32}$/u.test(evidenceRef)) return undefined;
    const root = await this.#directory();
    const stored = await readSealedRecord(join(root, `${evidenceRef.slice(14)}.json`), "gate evidence");
    return stored === undefined ? undefined : objectRow(objectRow(stored, "gate evidence")["entry"], "entry");
  }

  // why: the committed task names only its evidence digest; the refs are
  // recovered from the passing evidence recorded for that exact change and
  // accepted only if they reproduce the digest the commit carries.
  async recover(changeDigest: string, gateIds: readonly string[], expected: string): Promise<readonly string[]> {
    const root = await this.#directory();
    const names = await readdir(root).catch(() => [] as string[]);
    const passing: {
      readonly ref: string;
      readonly digest: Digest;
      readonly gateId: string;
      readonly sequence: number;
    }[] = [];
    for (const name of names.filter((entry) => /^[a-f0-9]{32}\.json$/u.test(entry))) {
      const stored = objectRow(await readSealedRecord(join(root, name), "gate evidence"), "gate evidence");
      const entry = objectRow(stored["entry"], "entry");
      if (stored["changeDigest"] !== changeDigest || entry["verdict"] !== "PASS") continue;
      passing.push({
        ref: `gate-evidence:${name.slice(0, 32)}`,
        digest: canonicalDigest(entry),
        gateId: String(entry["gateId"]),
        sequence: Number(stored["sequence"])
      });
    }
    const latest = gateIds.map(
      (gateId) => passing.filter((item) => item.gateId === gateId).sort((a, b) => b.sequence - a.sequence)[0]
    );
    if (latest.some((item) => item === undefined))
      throw stateInvalid("VES_TASK_EVIDENCE_MISSING", "Gate evidence for the committed change is missing");
    const refs = latest.map((item) => item!.ref);
    const digests = latest.map((item) => item!.digest);
    if (canonicalDigest({ evidenceDigests: digests, evidenceRefs: refs }) !== expected)
      throw stateInvalid("VES_TASK_EVIDENCE_MISMATCH", "Recovered gate evidence does not match the task commit");
    return refs;
  }

  // invariant: feedback to the implementer is a bounded, redacted summary of
  // a gate verdict; gate output itself is evidence and never re-enters a prompt.
  async feedback(failure: GateFailure): Promise<{ readonly text: string; readonly feedback: GateAttemptFeedback }> {
    const entry = await this.load(failure.evidenceRef);
    const text =
      entry === undefined
        ? `The previous attempt stopped before its gates finished (${failure.failedGateId}).`
        : `Gate ${String(entry["gateId"])} (${String(entry["declaredCommand"])}) failed: exit code ${String(
            entry["exitCode"]
          )}, timed out ${String(entry["timedOut"])}, output limit exceeded ${String(entry["outputLimitExceeded"])}.`;
    const digest = canonicalDigest(text);
    return {
      text,
      feedback: {
        feedbackRef: `feedback:${digest.slice(7, 39)}`,
        feedbackDigest: digest,
        bytes: Buffer.byteLength(text)
      }
    };
  }
}
