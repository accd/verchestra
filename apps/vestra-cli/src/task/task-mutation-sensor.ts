import { taskGateVerdict, type TaskGateCommand, type VerificationPorts } from "@verchestra/application";
import { isWithinTaskScope } from "@verchestra/domain";
import { NodeGateProcessRunner, type GateCommandProfile } from "@verchestra/platform-node";

import { canonicalDigest, sha256 } from "./task-files.ts";
import { git } from "./task-git.ts";
import { scratchCheckouts, type TaskWorkspace } from "./task-workspace.ts";

type Row = Readonly<Record<string, unknown>>;
type SensorRequest = Parameters<VerificationPorts["sensor"]["run"]>[0];

export interface MutationSensorContext {
  readonly workspace: Pick<TaskWorkspace, "repositoryRoot" | "verificationRoot">;
  readonly runId: string;
  readonly sourceRevision: string;
  readonly changeScope: readonly string[];
  readonly gates: readonly TaskGateCommand[];
  readonly profiles: Readonly<Record<string, GateCommandProfile>>;
}

// invariant: the verification sensor compares this digest before and after
// every mutation run; the user's checkout (HEAD, index, and working tree
// status) must not move while Verchestra verifies.
export async function activeStateDigest(repositoryRoot: string): Promise<`sha256:${string}`> {
  const head = await git(repositoryRoot, ["rev-parse", "HEAD"]).catch(() => "unborn");
  const status = await git(repositoryRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  return canonicalDigest({ head: head.trim(), status });
}

// invariant: a mutant is killed only when a gate that covers its requirement
// fails on it by the gate's own verdict, so verification never counts as
// killed a mutant the gate would have committed, nor the reverse.
export class MutationSensor {
  readonly #context: MutationSensorContext;
  #runs = 0;

  constructor(context: MutationSensorContext) {
    this.#context = context;
  }

  async run(request: SensorRequest): Promise<Row> {
    const repositoryRoot = this.#context.workspace.repositoryRoot;
    const before = await activeStateDigest(repositoryRoot);
    const scratch = await scratchCheckouts(this.#context.workspace, this.#context.runId, "mutations");
    // why: stable for this mutation within one verification, so a resumed
    // verification replaces the checkout a killed one left behind.
    const name = `${request.mutation.mutationId}:${(this.#runs += 1)}`;
    const killed = await scratch.checkouts.withScratchCheckout(
      { name, commitId: request.commitId },
      async (checkout) => {
        await this.#mutate(checkout.directory, request.mutation.targetRef);
        return this.#gatesFail(scratch.root, checkout.worktreeRef, request.criterion.requirementId);
      }
    );
    return {
      // invariant: the worktree module calls back only with a checkout it has
      // proven to be a real directory inside the run's scratch root.
      scratchIsolationVerified: true,
      killed,
      expectedFailureObserved: killed,
      evidenceRef: `mutation:${sha256(`${request.mutation.mutationId}:${String(killed)}`).slice(7, 39)}`,
      activeStateBeforeDigest: before,
      activeStateAfterDigest: await activeStateDigest(repositoryRoot)
    };
  }

  // why: the mutation is the reversal of the implementation file the verifier
  // named: restore its base content, or remove it when the task created it.
  async #mutate(checkout: string, targetRef: string): Promise<void> {
    const path = targetRef.slice("path:".length);
    if (!isWithinTaskScope(path, this.#context.changeScope))
      throw Object.assign(new Error("mutation target outside scope"), { code: "VES_TASK_MUTATION_INVALID" });
    const base = this.#context.sourceRevision;
    const existed = await git(checkout, ["cat-file", "-e", `${base}:${path}`]).then(
      () => true,
      () => false
    );
    if (existed) await git(checkout, ["checkout", base, "--", path]);
    else await git(checkout, ["rm", "-q", "--ignore-unmatch", "-f", "--", path]);
  }

  async #gatesFail(root: string, worktreeRef: string, requirementId: string): Promise<boolean> {
    const runner = new NodeGateProcessRunner({
      repositoryRoot: this.#context.workspace.repositoryRoot,
      worktreesRoot: root,
      commands: this.#context.profiles
    });
    for (const gate of this.#context.gates.filter((entry) => entry.requirementIds.includes(requirementId))) {
      const result = await runner.run({ ...gate, worktreeRef });
      if (taskGateVerdict(gate, result) === "FAIL") return true;
    }
    return false;
  }
}
