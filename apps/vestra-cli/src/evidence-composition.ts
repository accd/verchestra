import { ArtifactSealer, NodeEd25519Signer, type KeyProviderPort, type KeyProviderRequest } from "@verchestra/evidence";
import { EncryptedFileKeyProvider } from "@verchestra/platform-node";

export async function createEvidenceSealer(options: {
  readonly keyProvider: KeyProviderPort;
  readonly request: KeyProviderRequest;
}): Promise<ArtifactSealer> {
  return new ArtifactSealer({ signer: await options.keyProvider.loadOrCreate(options.request) });
}

export async function createLocalEvidenceSealer(options: {
  readonly stateRoot: string;
  readonly passphrase: () => Promise<Uint8Array>;
  readonly request: KeyProviderRequest;
}): Promise<ArtifactSealer> {
  return createEvidenceSealer({
    keyProvider: new EncryptedFileKeyProvider({
      stateRoot: options.stateRoot,
      passphrase: options.passphrase,
      signers: NodeEd25519Signer
    }),
    request: options.request
  });
}
