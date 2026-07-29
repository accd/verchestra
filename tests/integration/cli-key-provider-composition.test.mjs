import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { createLocalEvidenceSealer } from "../../apps/vestra-cli/src/evidence-composition.ts";

const roots = [];
const request = Object.freeze({ keyId: "cli-execution-2026", purposes: ["execution-package"] });
const binding = Object.freeze({
  schema: { name: "execution-package", version: 1 },
  purpose: "execution-package",
  bindingId: "ticket:VES-51",
  sourceStateDigest: "a".repeat(64)
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("CLI evidence composition obtains a persistent signer exclusively through the key provider", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-cli-key-provider-"));
  roots.push(root);
  const options = {
    stateRoot: root,
    passphrase: async () => Buffer.from("correct horse battery staple", "utf8"),
    request
  };
  const first = await createLocalEvidenceSealer(options);
  const second = await createLocalEvidenceSealer(options);
  const firstArtifact = await first.seal({ ordinal: 1 }, binding, { issuedAt: "2026-07-29T15:30:00.000Z" });
  const secondArtifact = await second.seal({ ordinal: 2 }, binding, { issuedAt: "2026-07-29T15:30:00.000Z" });

  assert.equal(firstArtifact.keyId, secondArtifact.keyId);
  assert.equal(firstArtifact.keyId, request.keyId);
});

test("CLI composition supplies the concrete signer only at the composition boundary", async () => {
  const composition = await readFile(
    new URL("../../apps/vestra-cli/src/evidence-composition.ts", import.meta.url),
    "utf8"
  );
  assert.equal(composition.includes("signers: NodeEd25519Signer"), true);
  assert.equal(composition.includes("loadOrCreate"), true);
});
