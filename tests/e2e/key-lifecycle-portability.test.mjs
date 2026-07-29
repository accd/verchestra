import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { createEvidenceSealer } from "../../apps/vestra-cli/src/evidence-composition.ts";
import { MachineBootstrapService } from "../../packages/application/src/index.ts";
import {
  createTrustRoot,
  ExecutionPackageBuilder,
  NodeEd25519Signer,
  RunCapsuleBuilder
} from "../../packages/evidence/src/index.ts";
import { EncryptedFileKeyProvider } from "../../packages/platform-node/src/index.ts";
import { capsuleExpectation, capsuleInput } from "../helpers/run-capsule-fixture.mjs";
import { claude, codex, executeInput, qwen, serviceOptions } from "../helpers/machine-bootstrap-fixture.mjs";
import { currentState, packageInput } from "../helpers/execution-package-fixture.mjs";

const stateRoots = [];
const sourcePassphrase = "source portability passphrase";
const receiverPassphrase = "receiver portability passphrase";
const sourceRequest = Object.freeze({ keyId: "source-execution-2026", purposes: ["execution-package"] });
const receiverRequest = Object.freeze({ keyId: "receiver-run-capsule-2026", purposes: ["run-capsule"] });

afterEach(async () => {
  await Promise.all(stateRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function localProvider(stateRoot, passphrase) {
  return new EncryptedFileKeyProvider({
    stateRoot,
    passphrase: async () => Buffer.from(passphrase, "utf8"),
    signers: NodeEd25519Signer
  });
}

test("an Execution Package crosses two machine-local key roots and resumes under a different qualified driver", async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "verchestra-key-portability-source-"));
  const receiverRoot = await mkdtemp(join(tmpdir(), "verchestra-key-portability-receiver-"));
  stateRoots.push(sourceRoot, receiverRoot);

  const sourceProvider = await localProvider(sourceRoot, sourcePassphrase);
  const sourceSigner = await sourceProvider.loadOrCreate(sourceRequest);
  const sourceSealer = await createEvidenceSealer({ keyProvider: sourceProvider, request: sourceRequest });
  const input = packageInput();
  const sealedPackage = await new ExecutionPackageBuilder({ sealer: sourceSealer }).build(input);
  const exportedTrustRoot = JSON.parse(
    JSON.stringify(createTrustRoot({ trustRootId: "source-root", version: 1, keys: [sourceSigner.publicKeyRef] }))
  );
  const transferredPackage = JSON.parse(JSON.stringify(sealedPackage));

  const receiverProvider = await localProvider(receiverRoot, receiverPassphrase);
  const receiverSigner = await receiverProvider.loadOrCreate(receiverRequest);
  const receiverSealer = await createEvidenceSealer({ keyProvider: receiverProvider, request: receiverRequest });
  const receiverPackages = new ExecutionPackageBuilder({ sealer: receiverSealer });
  const receiverTrustRoot = createTrustRoot({
    trustRootId: "receiver-root",
    version: 1,
    keys: [receiverSigner.publicKeyRef]
  });

  const rejectedWithoutTransferredTrust = await receiverPackages.verify(
    transferredPackage,
    receiverTrustRoot,
    currentState(input)
  );
  assert.deepEqual(rejectedWithoutTransferredTrust, { ok: false, code: "VES_TRUST_KEY_UNKNOWN" });

  const acceptedWithTransferredTrust = await receiverPackages.verify(
    transferredPackage,
    exportedTrustRoot,
    currentState(input)
  );
  assert.equal(acceptedWithTransferredTrust.ok, true);
  assert.equal(acceptedWithTransferredTrust.firstPendingTaskId, "T-2");
  assert.notEqual(sourceSigner.publicKeyRef.keyId, receiverSigner.publicKeyRef.keyId);

  const sourceBootstrap = serviceOptions(MachineBootstrapService, [claude(), codex()]);
  const receiverBootstrap = serviceOptions(MachineBootstrapService, [qwen()]);
  await sourceBootstrap.service.execute(executeInput());
  await receiverBootstrap.service.execute(executeInput());
  assert.equal(sourceBootstrap.store.profile.drivers[0].driverId, "claude-code");
  assert.equal(sourceBootstrap.store.profile.drivers[0].passport.qualificationStatus, "qualified");
  assert.equal(receiverBootstrap.store.profile.drivers[0].driverId, "opencode");
  assert.equal(receiverBootstrap.store.profile.drivers[0].passport.qualificationStatus, "qualified");

  const resumedCapsuleInput = capsuleInput("COMPLETED", "low", {
    executionPackageRef: {
      artifactId: `execution-package:${transferredPackage.artifactId}`,
      digest: `sha256:${transferredPackage.payloadDigest}`
    }
  });
  const receiverCapsules = new RunCapsuleBuilder({ sealer: receiverSealer });
  const resumedCapsule = await receiverCapsules.build(resumedCapsuleInput);
  const verifiedCapsule = await receiverCapsules.verify(
    resumedCapsule,
    receiverTrustRoot,
    capsuleExpectation(resumedCapsuleInput)
  );
  assert.deepEqual(verifiedCapsule, {
    ok: true,
    capsuleId: resumedCapsule.artifactId,
    status: "COMPLETED"
  });

  const [sourceKeyFile] = await readdir(join(sourceRoot, "keys"));
  const [receiverKeyFile] = await readdir(join(receiverRoot, "keys"));
  const sourceKeystore = await readFile(join(sourceRoot, "keys", sourceKeyFile), "utf8");
  const receiverKeystore = await readFile(join(receiverRoot, "keys", receiverKeyFile), "utf8");
  const transferredText = JSON.stringify({ exportedTrustRoot, transferredPackage, resumedCapsule });
  for (const forbidden of [sourcePassphrase, receiverPassphrase, sourceRoot, receiverRoot]) {
    assert.equal(sourceKeystore.includes(forbidden), false);
    assert.equal(receiverKeystore.includes(forbidden), false);
    assert.equal(transferredText.includes(forbidden), false);
  }
});
