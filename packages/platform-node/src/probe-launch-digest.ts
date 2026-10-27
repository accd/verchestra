import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath } from "node:fs/promises";
import { extname } from "node:path";
import { pipeline } from "node:stream/promises";

import { canonicalizeJsonV2 } from "@verchestra/domain";

export interface ProbeLaunch {
  readonly executable: string;
  readonly args?: readonly string[];
  readonly environment?: Readonly<Record<string, string>>;
  readonly entry: { readonly path: string; readonly digest: string };
}

async function fileDigest(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return `sha256:${hash.digest("hex")}`;
}

// invariant: one digest names everything a launch runs: the executable's real
// path and bytes, its arguments, the environment extras, and the entry's digest
// and extension, which picks how the executable reads it. The host measures it
// from what it starts, and whoever issues an approval or a grant computes it
// here, so the two cannot drift (#569, PHC-01).
// why: the executable's bytes, not only its path, so a binary swapped at the
// same path is a different launch. A toolchain upgrade therefore needs a new
// approval.
export async function probeLaunchDigest(launch: ProbeLaunch): Promise<string> {
  const executable = await realpath(launch.executable);
  const body = canonicalizeJsonV2({
    schema: "verchestra-probe-launch/1",
    executable: { path: executable, digest: await fileDigest(executable) },
    args: [...(launch.args ?? [])],
    environment: { ...launch.environment },
    entry: { digest: launch.entry.digest, extension: extname(launch.entry.path) }
  });
  return `sha256:${createHash("sha256").update(body).digest("hex")}`;
}
