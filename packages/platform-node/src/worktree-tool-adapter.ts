import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

import {
  EXECUTION_PAYLOAD_TOMBSTONE,
  MAXIMUM_EXECUTION_PAYLOAD_BYTES,
  executionPayloadDigest,
  type EffectIntent,
  type EffectRepository,
  type ExecutionPayloadPort,
  type ExecutionToolPort,
  type ExecutionToolRequest
} from "@verchestra/application";
import { canonicalizeJsonV2 } from "@verchestra/domain";

const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,511}$/u;
const LOGICAL_PATH = /^(?![A-Za-z]:)(?!\/)(?!.*\\)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._@+/-]+$/u;
const OPERATION_KIND = "worktree-tool/1";
const ADAPTER_ID = "node-worktree-tool";

export type WorktreeToolErrorCode =
  | "VES_TOOL_REQUEST_INVALID"
  | "VES_TOOL_COMMAND_DENIED"
  | "VES_TOOL_PROTECTED_PATH"
  | "VES_TOOL_PATH_ESCAPE"
  | "VES_TOOL_SYMLINK_DENIED"
  | "VES_TOOL_PAYLOAD_INVALID"
  | "VES_TOOL_REQUEST_CONFLICT"
  | "VES_TOOL_EFFECT_FAILED"
  | "VES_TOOL_RECEIPT_INVALID";

export class WorktreeToolError extends Error {
  readonly code: WorktreeToolErrorCode;

  constructor(code: WorktreeToolErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorktreeToolError";
    this.code = code;
  }
}

function fail(code: WorktreeToolErrorCode, message: string, options?: ErrorOptions): never {
  throw new WorktreeToolError(code, message, options);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function inside(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child !== "" && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function errnoCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

async function lstatOrUndefined(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

const REQUEST_FIELDS = [
  "requestId",
  "taskId",
  "capabilityGrantRef",
  "operation",
  "targetPaths",
  "payloadRef",
  "worktreeRef"
] as const;
const TOKEN_FIELDS = ["requestId", "taskId", "capabilityGrantRef", "payloadRef", "worktreeRef"] as const;

function requestRow(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail("VES_TOOL_REQUEST_INVALID", "Tool request must be an object");
  const row = value as Record<string, unknown>;
  const keys: readonly string[] = REQUEST_FIELDS;
  if (Object.keys(row).some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(row, key)))
    fail("VES_TOOL_REQUEST_INVALID", "Tool request fields are invalid");
  for (const key of TOKEN_FIELDS)
    if (typeof row[key] !== "string" || !SAFE.test(row[key])) fail("VES_TOOL_REQUEST_INVALID", `${key} is invalid`);
  return row;
}

function payloadDigestFor(operation: "write" | "delete", payloadRef: string): string | undefined {
  const digest = executionPayloadDigest(payloadRef);
  const valid = operation === "write" ? digest !== undefined : payloadRef === EXECUTION_PAYLOAD_TOMBSTONE;
  if (!valid) fail("VES_TOOL_PAYLOAD_INVALID", "Tool payload reference does not match its operation");
  return digest;
}

// Walks parent components one lstat at a time from the real worktree root.
// A missing parent is created for a write and ends a delete (nothing to do).
async function walkParents(root: string, segments: readonly string[], create: boolean): Promise<string | undefined> {
  let directory = root;
  for (const segment of segments) {
    const next = join(directory, segment);
    let metadata = await lstatOrUndefined(next);
    if (metadata === undefined && !create) return undefined;
    if (metadata === undefined) {
      await mkdir(next, { mode: 0o755 });
      metadata = await lstat(next);
    }
    if (metadata.isSymbolicLink()) fail("VES_TOOL_SYMLINK_DENIED", "Tool target crosses a symbolic link");
    if (!metadata.isDirectory()) fail("VES_TOOL_PATH_ESCAPE", "Tool target parent is not a directory");
    directory = next;
  }
  if (directory !== root && (await realpath(directory)) !== directory)
    fail("VES_TOOL_PATH_ESCAPE", "Tool target parent resolves elsewhere");
  return directory;
}

interface ToolRequest {
  readonly requestId: string;
  readonly taskId: string;
  readonly capabilityGrantRef: string;
  readonly operation: "write" | "delete";
  readonly targetPath: string;
  readonly payloadRef: string;
  readonly payloadDigest: string | undefined;
  readonly worktreeRef: string;
}

interface ConfinedTarget {
  readonly directory: string;
  readonly target: string;
  readonly exists: boolean;
  readonly mode: number | undefined;
}

export interface NodeWorktreeToolAdapterOptions {
  readonly workspaceId: string;
  readonly worktrees: { resolvePath(worktreeRef: string): Promise<string> };
  // The runtime store's durable effect intents and operation receipts
  // (RuntimeStore#createEffectRepository).
  readonly receipts: EffectRepository;
  readonly payloads: ExecutionPayloadPort;
  // Logical roots refused regardless of the task declaration. `.git` is always
  // refused, at any depth.
  readonly protectedRoots?: readonly string[];
  readonly now?: () => string;
}

// ExecutionToolPort for an isolated Git worktree. The executor has already
// checked scope, protected paths, capability grant, and tool-effect authority;
// this adapter re-confines every effect by real path because it is the last
// component that touches the filesystem.
export class NodeWorktreeToolAdapter implements ExecutionToolPort {
  readonly #workspaceId: string;
  readonly #worktrees: NodeWorktreeToolAdapterOptions["worktrees"];
  readonly #receipts: EffectRepository;
  readonly #payloads: ExecutionPayloadPort;
  readonly #protectedRoots: readonly string[];
  readonly #now: () => string;

  constructor(options: NodeWorktreeToolAdapterOptions) {
    if (!SAFE.test(options.workspaceId)) fail("VES_TOOL_REQUEST_INVALID", "Workspace identity is invalid");
    const protectedRoots = options.protectedRoots ?? [];
    if (protectedRoots.some((root) => !LOGICAL_PATH.test(root)))
      fail("VES_TOOL_REQUEST_INVALID", "Protected roots must be logical paths");
    this.#workspaceId = options.workspaceId;
    this.#worktrees = options.worktrees;
    this.#receipts = options.receipts;
    this.#payloads = options.payloads;
    this.#protectedRoots = Object.freeze(protectedRoots.map((root) => root.toLowerCase()));
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async invoke(value: ExecutionToolRequest & { readonly worktreeRef: string }) {
    const request = this.#normalize(value);
    const idempotencyKey = `worktree-tool:sha256:${sha256(
      canonicalizeJsonV2({
        workspaceId: this.#workspaceId,
        worktreeRef: request.worktreeRef,
        requestId: request.requestId
      })
    )}`;
    const previously = await this.#receipts.get(idempotencyKey);
    const intent = await this.#intent(request, idempotencyKey);
    const prior = await this.#receipts.getReceipt(idempotencyKey);
    if (prior !== undefined) return this.#reference(prior.receiptId);
    if (intent.status === "failed") fail("VES_TOOL_EFFECT_FAILED", "Tool request already has a definite failure");
    if (intent.status === "completed") fail("VES_TOOL_RECEIPT_INVALID", "Completed tool request has no receipt");
    const startedAt = this.#now();
    // why: a re-delivered request whose first attempt was interrupted is
    // retried as a new attempt only after observing the target.
    const { attempt, outcome } = await this.#run(request, intent, previously !== undefined);
    const receiptId = `tool-receipt-${sha256(idempotencyKey).slice(0, 40)}`;
    await this.#receipts.complete(idempotencyKey, {
      receiptId,
      effectId: attempt.effectId,
      idempotencyKey,
      adapterId: ADAPTER_ID,
      attempt: Math.max(attempt.attempt, 1),
      outcome,
      ...(request.payloadDigest === undefined ? {} : { outputDigest: `sha256:${request.payloadDigest}` }),
      safeEvidenceRefs: [`path:${request.targetPath}`],
      startedAt,
      completedAt: this.#now()
    });
    return this.#reference(receiptId);
  }

  async #run(
    request: ToolRequest,
    intent: EffectIntent,
    redelivered: boolean
  ): Promise<{ readonly attempt: EffectIntent; readonly outcome: "applied" | "already-applied" }> {
    try {
      const target = await this.#confine(request);
      const outcome = await this.#observe(request, target);
      if (outcome === "already-applied") return { attempt: intent, outcome };
      const attempt = await this.#claim(intent, redelivered);
      await this.#apply(request, target);
      return { attempt, outcome };
    } catch (error) {
      if (error instanceof WorktreeToolError) await this.#receipts.updateStatus(intent.idempotencyKey, "failed");
      throw error;
    }
  }

  async #claim(intent: EffectIntent, redelivered: boolean): Promise<EffectIntent> {
    const fresh = intent.status === "applying" && !redelivered;
    if (fresh) return intent;
    // hazard: `ready` is dispatchable for the instant before startAttempt
    // claims it; no generic effect dispatcher runs in the task process.
    if (intent.status === "applying") await this.#receipts.updateStatus(intent.idempotencyKey, "ready");
    return await this.#receipts.startAttempt(intent.idempotencyKey);
  }

  #reference(receiptId: string) {
    return Object.freeze({ receiptRef: `receipt:${receiptId}` });
  }

  #normalize(value: unknown): ToolRequest {
    const row = requestRow(value);
    const operation = row["operation"];
    if (operation === "command") fail("VES_TOOL_COMMAND_DENIED", "Command execution is not a worktree tool");
    if (operation !== "write" && operation !== "delete") fail("VES_TOOL_REQUEST_INVALID", "Tool operation is invalid");
    const targets = row["targetPaths"];
    if (!Array.isArray(targets) || targets.length !== 1 || typeof targets[0] !== "string")
      fail("VES_TOOL_REQUEST_INVALID", "A worktree tool request names exactly one target");
    const payloadRef = row["payloadRef"] as string;
    return Object.freeze({
      requestId: row["requestId"] as string,
      taskId: row["taskId"] as string,
      capabilityGrantRef: row["capabilityGrantRef"] as string,
      operation,
      targetPath: this.#logicalTarget(targets[0]),
      payloadRef,
      payloadDigest: payloadDigestFor(operation, payloadRef),
      worktreeRef: row["worktreeRef"] as string
    });
  }

  #logicalTarget(value: string): string {
    if (!LOGICAL_PATH.test(value)) fail("VES_TOOL_PATH_ESCAPE", "Tool target is not a logical path");
    const path = value.replaceAll(/\/{2,}/gu, "/").replace(/\/$/u, "");
    const segments = path.split("/");
    if (segments.some((segment) => segment === "." || segment === ""))
      fail("VES_TOOL_PATH_ESCAPE", "Tool target is not a normalized logical path");
    if (segments.some((segment) => segment.toLowerCase() === ".git"))
      fail("VES_TOOL_PROTECTED_PATH", "Tool target is inside Git metadata");
    // hazard: the default macOS volume is case-insensitive, so a protected root
    // is compared without case to stop `.Verchestra/policy` aliasing it.
    const folded = path.toLowerCase();
    if (this.#protectedRoots.some((root) => folded === root || folded.startsWith(`${root}/`)))
      fail("VES_TOOL_PROTECTED_PATH", "Tool target is protected");
    return path;
  }

  async #intent(request: ToolRequest, idempotencyKey: string): Promise<EffectIntent> {
    const canonicalInputDigest = `sha256:${sha256(
      canonicalizeJsonV2({
        operation: request.operation,
        targetPath: request.targetPath,
        payloadRef: request.payloadRef,
        taskId: request.taskId,
        capabilityGrantRef: request.capabilityGrantRef,
        worktreeRef: request.worktreeRef
      })
    )}`;
    let intent: EffectIntent;
    try {
      // why: inserted directly as `applying`, never `planned`, so a generic
      // effect dispatcher sharing this store cannot claim a worktree write.
      intent = await this.#receipts.insertOrGet({
        effectId: `tool-effect-${sha256(idempotencyKey).slice(0, 40)}`,
        idempotencyKey,
        operationKind: OPERATION_KIND,
        workspaceId: this.#workspaceId,
        logicalTarget: `${request.worktreeRef}/${request.targetPath}`,
        canonicalInputDigest,
        semanticIdentity: `request:${request.requestId}`,
        canonicalizationVersion: 2,
        riskTier: "medium",
        grantRef: request.capabilityGrantRef,
        status: "applying",
        attempt: 1,
        createdAt: this.#now()
      });
    } catch (error) {
      if (errnoCode(error) === "VES_EFFECT_KEY_CONFLICT")
        fail("VES_TOOL_REQUEST_CONFLICT", "Request identity is bound to a different tool request", { cause: error });
      throw error;
    }
    if (intent.idempotencyKey !== idempotencyKey || intent.canonicalInputDigest !== canonicalInputDigest)
      fail("VES_TOOL_REQUEST_CONFLICT", "Request identity is bound to a different tool request");
    return intent;
  }

  async #confine(request: ToolRequest): Promise<ConfinedTarget> {
    const root = await realpath(await this.#worktrees.resolvePath(request.worktreeRef));
    const segments = request.targetPath.split("/");
    const name = segments.pop() as string;
    const directory = await walkParents(root, segments, request.operation === "write");
    if (directory === undefined) return { directory: root, target: root, exists: false, mode: undefined };
    const target = join(directory, name);
    if (!inside(root, target)) fail("VES_TOOL_PATH_ESCAPE", "Tool target escaped its worktree");
    const metadata = await lstatOrUndefined(target);
    if (metadata?.isSymbolicLink() === true) fail("VES_TOOL_SYMLINK_DENIED", "Tool target is a symbolic link");
    if (metadata !== undefined && !metadata.isFile()) fail("VES_TOOL_PATH_ESCAPE", "Tool target is not a regular file");
    return { directory, target, exists: metadata !== undefined, mode: metadata?.mode };
  }

  // Observation makes a replay after a crash converge instead of re-applying:
  // the target already holding the requested state is an applied effect.
  async #observe(request: ToolRequest, target: ConfinedTarget): Promise<"applied" | "already-applied"> {
    if (request.operation === "delete") return target.exists ? "applied" : "already-applied";
    if (!target.exists) return "applied";
    return sha256(await readFile(target.target)) === request.payloadDigest ? "already-applied" : "applied";
  }

  async #apply(request: ToolRequest, target: ConfinedTarget): Promise<void> {
    if (request.operation === "delete") {
      await unlink(target.target);
      return;
    }
    const content = await this.#payloads.get(request.payloadRef);
    if (
      !(content instanceof Uint8Array) ||
      content.byteLength > MAXIMUM_EXECUTION_PAYLOAD_BYTES ||
      sha256(content) !== request.payloadDigest
    )
      fail("VES_TOOL_PAYLOAD_INVALID", "Tool payload is missing, oversized, or does not match its digest");
    const temporary = join(target.directory, `.vestra-${randomUUID()}.tmp`);
    try {
      // invariant: `wx` never follows or reuses an existing name, and rename
      // replaces the final component itself, so a link cannot redirect it.
      await writeFile(temporary, content, { flag: "wx", mode: (target.mode ?? 0o644) & 0o777 });
      await rename(temporary, target.target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
}
