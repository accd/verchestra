import { timingSafeEqual } from "node:crypto";

import type { TaskCommandIo, TaskConfirmationInput } from "./task-io.ts";
import { taskError } from "./task-errors.ts";

const MAXIMUM_CONFIRMATION_BYTES = 512;

function readLine(input: TaskConfirmationInput, untilEnd: boolean): Promise<string> {
  return new Promise((resolveLine) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      input.removeAllListeners();
      input.pause();
      resolveLine(Buffer.concat(chunks).toString("utf8").split(/\r?\n/u)[0] ?? "");
    };
    input.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAXIMUM_CONFIRMATION_BYTES) return settle();
      chunks.push(Buffer.from(chunk));
      if (!untilEnd && chunk.includes(0x0a)) settle();
    });
    input.on("end", settle);
    input.on("close", settle);
    input.on("error", settle);
    input.resume();
  });
}

function same(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

// invariant: a human decision (approve, review) is recorded only after the
// exact digest being decided is typed back. From an interactive terminal that
// is a prompt; the only other path is the explicit, non-default
// `--confirm-stdin` flag with the digest piped in, which a script has to spell
// out deliberately and which is documented as local, not cryptographic,
// authority.
export async function confirmDigest(
  io: TaskCommandIo,
  expected: string,
  options: { readonly confirmStdin: boolean; readonly label: string }
): Promise<void> {
  const interactive = io.stdin.isTTY === true;
  if (!options.confirmStdin && !interactive)
    throw taskError(
      "VES_TASK_CONFIRMATION_REQUIRED",
      {},
      "A human decision needs an interactive terminal or --confirm-stdin"
    );
  if (!options.confirmStdin) io.stderr(`Type the ${options.label} digest to confirm: `);
  const typed = (await readLine(io.stdin, options.confirmStdin)).trim();
  if (!same(typed, expected))
    throw taskError("VES_TASK_CONFIRMATION_REQUIRED", {}, "The typed confirmation does not match the digest");
}
