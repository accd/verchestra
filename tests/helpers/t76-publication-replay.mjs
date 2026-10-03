// why: the publisher's checks must admit the evidence of every published
// candidate, since those releases were built from it. This helper runs the real
// publisher over a downloaded candidate run, signs with throwaway keys bound to
// throwaway anchors in a scratch directory, and discards everything it wrote.
// Nothing is uploaded, and no reviewed key or anchor is read.
//
//   node tests/helpers/t76-publication-replay.mjs --run <directory> \
//     --revision <sha> --rollback-index <prior t76-target-index.json>
//
// <directory> is laid out as for tests/helpers/t76-inline-evidence-writers.mjs
// replay: `targets/` holds every artifact of the run, and the reconciled
// `t76-target-index.json` sits beside it.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  KEY_ENVIRONMENT_NAME,
  RELEASE_ANCHOR_PURPOSE,
  TIMESTAMP_ANCHOR_PURPOSE,
  TIMESTAMP_KEY_ENVIRONMENT_NAME,
  publicationSummary,
  publishT76Release
} from "../../scripts/t76-publish-release.mjs";
import {
  PUBLICATION_BASE_URL,
  PUBLICATION_EXPIRES,
  testSigningKeyBase64,
  writeMatchingReleaseAnchor
} from "./t76-publication-fixture.mjs";

export async function publishDownloadedRun({ runDirectory, revision, rollbackIndexPath }) {
  const scratch = await mkdtemp(join(tmpdir(), "verchestra-t76-publication-replay-"));
  try {
    const releaseKey = testSigningKeyBase64();
    const timestampKey = testSigningKeyBase64();
    const manifest = await publishT76Release({
      indexPath: join(runDirectory, "t76-target-index.json"),
      targetsDirectory: join(runDirectory, "targets"),
      outputDirectory: join(scratch, "publication-output"),
      baseUrl: PUBLICATION_BASE_URL,
      revision,
      expires: PUBLICATION_EXPIRES,
      metadataVersion: 1,
      rootVersion: 1,
      rollbackIndexPath,
      protectedEnvironment: { [KEY_ENVIRONMENT_NAME]: releaseKey, [TIMESTAMP_KEY_ENVIRONMENT_NAME]: timestampKey },
      releaseAnchorPath: writeMatchingReleaseAnchor(scratch, releaseKey, RELEASE_ANCHOR_PURPOSE),
      timestampAnchorPath: writeMatchingReleaseAnchor(scratch, timestampKey, TIMESTAMP_ANCHOR_PURPOSE)
    });
    return publicationSummary(manifest);
  } finally {
    await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

const argument = (args, name) => {
  const index = args.indexOf(name);
  if (index < 0 || args[index + 1] === undefined) throw new Error(`missing ${name}`);
  return args[index + 1];
};

const runCli = async () => {
  const args = process.argv.slice(2);
  const summary = await publishDownloadedRun({
    runDirectory: resolve(argument(args, "--run")),
    revision: argument(args, "--revision"),
    rollbackIndexPath: resolve(argument(args, "--rollback-index"))
  });
  for (const target of summary.targets) console.log(`PASS ${target.targetKey}: ${target.releaseDigest}`);
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCli();
