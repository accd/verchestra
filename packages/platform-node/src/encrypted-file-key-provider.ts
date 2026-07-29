import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scrypt } from "node:crypto";
import { link, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
export interface PublicKeyRef {
  readonly keyId: string;
  readonly algorithm: "Ed25519";
  readonly encoding: "spki-der-base64url";
  readonly publicKey: string;
  readonly purposes: readonly string[];
  readonly validFrom?: string;
  readonly validUntil?: string;
}

export interface KeyProviderRequest {
  readonly keyId: string;
  readonly purposes: readonly string[];
}

export interface KeyRotationRequest extends KeyProviderRequest {
  readonly overlapUntil: string;
}

export interface KeyProviderSigner {
  readonly publicKeyRef: PublicKeyRef;
  exportPkcs8(): Uint8Array;
  sign(purpose: string, data: Uint8Array): Promise<string>;
}

export interface KeyProviderSignerFactory {
  generate(options: {
    readonly keyId: string;
    readonly purposes: readonly string[];
    readonly validFrom?: string;
  }): KeyProviderSigner;
  fromPkcs8(
    options: {
      readonly keyId: string;
      readonly purposes: readonly string[];
      readonly validFrom?: string;
      readonly validUntil?: string;
    },
    encoded: Uint8Array
  ): KeyProviderSigner;
}

export interface KeyRotation {
  readonly current: KeyProviderSigner;
  readonly previous: PublicKeyRef;
}

export class KeyProviderError extends Error {
  readonly code: "VES_KEYSTORE_INTEGRITY" | "VES_KEY_REVOKED" | "VES_KEY_EXPIRED";

  constructor(code: KeyProviderError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "KeyProviderError";
    this.code = code;
  }
}
const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;

interface KeystoreEnvelopeV1 {
  readonly version: 1;
  readonly keyId: string;
  readonly kdf: {
    readonly name: "scrypt";
    readonly salt: string;
    readonly N: number;
    readonly r: number;
    readonly p: number;
  };
  readonly cipher: { readonly name: "AES-256-GCM"; readonly iv: string; readonly tag: string };
  readonly ciphertext: string;
  readonly publicKeyRef: PublicKeyRef;
}

interface KeystoreEnvelopeV2 {
  readonly version: 2;
  readonly keyId: string;
  readonly kdf: KeystoreEnvelopeV1["kdf"];
  readonly cipher: KeystoreEnvelopeV1["cipher"];
  readonly ciphertext: string;
  readonly publicKeyRef: PublicKeyRef;
}

type KeystoreEnvelope = KeystoreEnvelopeV1 | KeystoreEnvelopeV2;

interface EncryptedKeyState {
  readonly logicalKeyId: string;
  readonly revoked: boolean;
  readonly publicKeyRef: PublicKeyRef;
  readonly privateKey: string;
}

interface LoadedKey {
  readonly signer: KeyProviderSigner;
  readonly logicalKeyId: string;
  readonly revoked: boolean;
}

function fail(message: string, options?: ErrorOptions): never {
  throw new KeyProviderError("VES_KEYSTORE_INTEGRITY", message, options);
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  const sortedLeft = [...new Set(left)].sort();
  const sortedRight = [...new Set(right)].sort();
  return sortedLeft.length === sortedRight.length && sortedLeft.every((value, index) => value === sortedRight[index]);
}

function sameReference(left: PublicKeyRef, right: PublicKeyRef): boolean {
  return (
    left.keyId === right.keyId &&
    left.algorithm === right.algorithm &&
    left.encoding === right.encoding &&
    left.publicKey === right.publicKey &&
    sameArray(left.purposes, right.purposes) &&
    left.validFrom === right.validFrom &&
    left.validUntil === right.validUntil
  );
}

function decode(value: unknown, expectedBytes?: number): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value)) fail("Keystore encoding is invalid");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length === 0 || (expectedBytes !== undefined && decoded.length !== expectedBytes))
    fail("Keystore encoding is invalid");
  return decoded;
}

function parseEnvelope(value: unknown): KeystoreEnvelope {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("Keystore envelope is invalid");
  const input = value as Record<string, unknown>;
  if (
    (input["version"] !== 1 && input["version"] !== 2) ||
    typeof input["keyId"] !== "string" ||
    input["kdf"] === null ||
    typeof input["kdf"] !== "object" ||
    input["cipher"] === null ||
    typeof input["cipher"] !== "object" ||
    input["publicKeyRef"] === null ||
    typeof input["publicKeyRef"] !== "object" ||
    typeof input["ciphertext"] !== "string"
  ) {
    fail("Keystore envelope is invalid");
  }
  const kdf = input["kdf"] as Record<string, unknown>;
  const cipher = input["cipher"] as Record<string, unknown>;
  const publicKeyRef = input["publicKeyRef"] as Record<string, unknown>;
  if (
    kdf["name"] !== "scrypt" ||
    kdf["N"] !== SCRYPT_N ||
    kdf["r"] !== SCRYPT_R ||
    kdf["p"] !== SCRYPT_P ||
    cipher["name"] !== "AES-256-GCM"
  ) {
    fail("Keystore envelope is unsupported");
  }
  if (
    typeof publicKeyRef["keyId"] !== "string" ||
    publicKeyRef["algorithm"] !== "Ed25519" ||
    publicKeyRef["encoding"] !== "spki-der-base64url" ||
    typeof publicKeyRef["publicKey"] !== "string" ||
    !Array.isArray(publicKeyRef["purposes"]) ||
    publicKeyRef["purposes"].length === 0 ||
    publicKeyRef["purposes"].some((purpose) => typeof purpose !== "string" || purpose.length === 0) ||
    (publicKeyRef["validFrom"] !== undefined && typeof publicKeyRef["validFrom"] !== "string") ||
    (publicKeyRef["validUntil"] !== undefined && typeof publicKeyRef["validUntil"] !== "string")
  ) {
    fail("Keystore public key reference is invalid");
  }
  decode(kdf["salt"], SALT_BYTES);
  decode(cipher["iv"], IV_BYTES);
  decode(cipher["tag"], TAG_BYTES);
  decode(input["ciphertext"]);
  return input as unknown as KeystoreEnvelope;
}

function parseEncryptedState(value: Buffer): EncryptedKeyState {
  let input: unknown;
  try {
    input = JSON.parse(value.toString("utf8"));
  } catch (error) {
    return fail("Keystore state is invalid", { cause: error });
  }
  if (input === null || typeof input !== "object" || Array.isArray(input)) fail("Keystore state is invalid");
  const state = input as Record<string, unknown>;
  if (
    typeof state["logicalKeyId"] !== "string" ||
    typeof state["revoked"] !== "boolean" ||
    typeof state["privateKey"] !== "string" ||
    state["publicKeyRef"] === null ||
    typeof state["publicKeyRef"] !== "object"
  ) {
    fail("Keystore state is invalid");
  }
  const reference = state["publicKeyRef"] as Record<string, unknown>;
  if (
    typeof reference["keyId"] !== "string" ||
    reference["algorithm"] !== "Ed25519" ||
    reference["encoding"] !== "spki-der-base64url" ||
    typeof reference["publicKey"] !== "string" ||
    !Array.isArray(reference["purposes"]) ||
    reference["purposes"].length === 0 ||
    reference["purposes"].some((purpose) => typeof purpose !== "string" || purpose.length === 0) ||
    (reference["validFrom"] !== undefined && typeof reference["validFrom"] !== "string") ||
    (reference["validUntil"] !== undefined && typeof reference["validUntil"] !== "string")
  ) {
    fail("Keystore public key reference is invalid");
  }
  decode(state["privateKey"]);
  return state as unknown as EncryptedKeyState;
}

export class EncryptedFileKeyProvider {
  readonly #stateRoot: string;
  readonly #passphrase: () => Promise<Uint8Array>;
  readonly #signers: KeyProviderSignerFactory;
  readonly #now: () => Date;

  constructor(options: {
    readonly stateRoot: string;
    readonly passphrase: () => Promise<Uint8Array>;
    readonly signers: KeyProviderSignerFactory;
    readonly now?: () => Date;
  }) {
    if (
      !isAbsolute(options.stateRoot) ||
      options.stateRoot.includes("\0") ||
      typeof options.passphrase !== "function" ||
      options.signers === null ||
      typeof options.signers !== "object" ||
      typeof options.signers.generate !== "function" ||
      typeof options.signers.fromPkcs8 !== "function"
    ) {
      fail("Keystore configuration is invalid");
    }
    this.#stateRoot = resolve(options.stateRoot);
    this.#passphrase = options.passphrase;
    this.#signers = options.signers;
    this.#now = options.now ?? (() => new Date());
  }

  async loadOrCreate(request: KeyProviderRequest): Promise<KeyProviderSigner> {
    const root = await this.#root();
    const target = join(root, `${createHash("sha256").update(request.keyId, "utf8").digest("hex")}.key.json`);
    try {
      return (await this.#load(target, request)).signer;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const signer = this.#signers.generate(request);
    const envelope = await this.#encrypt(signer);
    const temporary = join(
      root,
      `.${createHash("sha256").update(request.keyId, "utf8").digest("hex")}.${randomBytes(12).toString("hex")}.tmp`
    );
    try {
      await writeFile(temporary, `${JSON.stringify(envelope)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
        flush: true
      });
      await link(temporary, target);
      return signer;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return (await this.#load(target, request)).signer;
      throw error;
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async rotate(request: KeyRotationRequest): Promise<KeyRotation> {
    const overlapUntil = Date.parse(request.overlapUntil);
    const now = this.#now();
    if (
      !Number.isFinite(overlapUntil) ||
      new Date(overlapUntil).toISOString() !== request.overlapUntil ||
      overlapUntil <= now.getTime()
    ) {
      throw new KeyProviderError("VES_KEY_EXPIRED", "Key rotation overlap must end in the future");
    }
    const root = await this.#root();
    const target = join(root, `${createHash("sha256").update(request.keyId, "utf8").digest("hex")}.key.json`);
    const loaded = await this.#load(target, request);
    const previous = this.#withValidity(loaded.signer, request.overlapUntil);
    const current = this.#signers.generate({
      keyId: `${request.keyId}:rotation:${randomUUID()}`,
      purposes: request.purposes,
      validFrom: now.toISOString()
    });
    await this.#replace(target, await this.#encryptState(request.keyId, current, false));
    return Object.freeze({ current, previous: previous.publicKeyRef });
  }

  async revoke(keyId: string): Promise<void> {
    const root = await this.#root();
    const target = join(root, `${createHash("sha256").update(keyId, "utf8").digest("hex")}.key.json`);
    let loaded: LoadedKey;
    try {
      loaded = await this.#load(target, { keyId, purposes: [] }, true);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
      throw error;
    }
    if (loaded.revoked) return;
    await this.#replace(target, await this.#encryptState(loaded.logicalKeyId, loaded.signer, true));
  }

  async #root(): Promise<string> {
    await mkdir(this.#stateRoot, { recursive: true, mode: 0o700 });
    const state = await lstat(this.#stateRoot);
    if (state.isSymbolicLink() || !state.isDirectory()) fail("Keystore state root is invalid");
    const stateRoot = await realpath(this.#stateRoot);
    const root = join(stateRoot, "keys");
    await mkdir(root, { recursive: true, mode: 0o700 });
    const metadata = await lstat(root);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) fail("Keystore root is invalid");
    const resolved = await realpath(root);
    const child = relative(stateRoot, resolved);
    if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) fail("Keystore root escaped state");
    return resolved;
  }

  async #load(path: string, request: KeyProviderRequest, allowRevoked = false): Promise<LoadedKey> {
    let envelope: KeystoreEnvelope;
    try {
      envelope = parseEnvelope(JSON.parse(await readFile(path, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
      if (error instanceof KeyProviderError) throw error;
      fail("Keystore could not be read", { cause: error });
    }
    if (
      envelope.keyId !== request.keyId ||
      (request.purposes.length > 0 && !sameArray(envelope.publicKeyRef.purposes, request.purposes))
    ) {
      fail("Keystore identity does not match the requested key");
    }
    const privateKey = await this.#decrypt(envelope);
    try {
      if (envelope.version === 2) {
        const state = parseEncryptedState(privateKey);
        if (
          state.logicalKeyId !== request.keyId ||
          !sameReference(state.publicKeyRef, envelope.publicKeyRef) ||
          (request.purposes.length > 0 && !sameArray(state.publicKeyRef.purposes, request.purposes))
        ) {
          fail("Keystore identity does not match the requested key");
        }
        const storedPrivateKey = decode(state.privateKey);
        try {
          const signer = this.#signerFromReference(state.publicKeyRef, storedPrivateKey);
          if (state.revoked && !allowRevoked) throw new KeyProviderError("VES_KEY_REVOKED", "Signing key is revoked");
          return Object.freeze({ signer, logicalKeyId: state.logicalKeyId, revoked: state.revoked });
        } finally {
          storedPrivateKey.fill(0);
        }
      }
      if (envelope.publicKeyRef.keyId !== request.keyId) fail("Keystore identity does not match the requested key");
      const signer = this.#signerFromReference(envelope.publicKeyRef, privateKey);
      return Object.freeze({ signer, logicalKeyId: request.keyId, revoked: false });
    } finally {
      privateKey.fill(0);
    }
  }

  #signerFromReference(reference: PublicKeyRef, privateKey: Uint8Array): KeyProviderSigner {
    const signer = this.#signers.fromPkcs8(
      {
        keyId: reference.keyId,
        purposes: reference.purposes,
        ...(reference.validFrom === undefined ? {} : { validFrom: reference.validFrom }),
        ...(reference.validUntil === undefined ? {} : { validUntil: reference.validUntil })
      },
      privateKey
    );
    if (!sameReference(signer.publicKeyRef, reference)) fail("Keystore public key does not match private key material");
    return signer;
  }

  #withValidity(signer: KeyProviderSigner, validUntil: string): KeyProviderSigner {
    const privateKey = signer.exportPkcs8();
    try {
      return this.#signers.fromPkcs8(
        {
          keyId: signer.publicKeyRef.keyId,
          purposes: signer.publicKeyRef.purposes,
          ...(signer.publicKeyRef.validFrom === undefined ? {} : { validFrom: signer.publicKeyRef.validFrom }),
          validUntil
        },
        privateKey
      );
    } finally {
      privateKey.fill(0);
    }
  }

  async #encryptState(logicalKeyId: string, signer: KeyProviderSigner, revoked: boolean): Promise<KeystoreEnvelopeV2> {
    const privateKey = signer.exportPkcs8();
    const state = Buffer.from(
      JSON.stringify({
        logicalKeyId,
        revoked,
        publicKeyRef: signer.publicKeyRef,
        privateKey: Buffer.from(privateKey).toString("base64url")
      }),
      "utf8"
    );
    privateKey.fill(0);
    const salt = randomBytes(SALT_BYTES);
    const iv = randomBytes(IV_BYTES);
    const key = await this.#derive(salt);
    try {
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([cipher.update(state), cipher.final()]);
      return Object.freeze({
        version: 2,
        keyId: logicalKeyId,
        kdf: Object.freeze({ name: "scrypt", salt: salt.toString("base64url"), N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }),
        cipher: Object.freeze({
          name: "AES-256-GCM",
          iv: iv.toString("base64url"),
          tag: cipher.getAuthTag().toString("base64url")
        }),
        ciphertext: ciphertext.toString("base64url"),
        publicKeyRef: signer.publicKeyRef
      });
    } finally {
      key.fill(0);
      state.fill(0);
    }
  }

  async #replace(path: string, envelope: KeystoreEnvelopeV2): Promise<void> {
    const temporary = `${path}.${randomBytes(12).toString("hex")}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(envelope)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
        flush: true
      });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async #encrypt(signer: KeyProviderSigner): Promise<KeystoreEnvelope> {
    const salt = randomBytes(SALT_BYTES);
    const iv = randomBytes(IV_BYTES);
    const key = await this.#derive(salt);
    const privateKey = signer.exportPkcs8();
    try {
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([cipher.update(privateKey), cipher.final()]);
      return Object.freeze({
        version: 1,
        keyId: signer.publicKeyRef.keyId,
        kdf: Object.freeze({ name: "scrypt", salt: salt.toString("base64url"), N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }),
        cipher: Object.freeze({
          name: "AES-256-GCM",
          iv: iv.toString("base64url"),
          tag: cipher.getAuthTag().toString("base64url")
        }),
        ciphertext: ciphertext.toString("base64url"),
        publicKeyRef: signer.publicKeyRef
      });
    } finally {
      key.fill(0);
      privateKey.fill(0);
    }
  }

  async #decrypt(envelope: KeystoreEnvelope): Promise<Buffer> {
    const key = await this.#derive(decode(envelope.kdf.salt, SALT_BYTES));
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, decode(envelope.cipher.iv, IV_BYTES));
      decipher.setAuthTag(decode(envelope.cipher.tag, TAG_BYTES));
      return Buffer.concat([decipher.update(decode(envelope.ciphertext)), decipher.final()]);
    } catch (error) {
      return fail("Keystore authentication failed", { cause: error });
    } finally {
      key.fill(0);
    }
  }

  async #derive(salt: Buffer): Promise<Buffer> {
    let passphrase: Uint8Array | undefined;
    try {
      const supplied = await this.#passphrase();
      if (!(supplied instanceof Uint8Array) || supplied.byteLength === 0) fail("Keystore passphrase is invalid");
      passphrase = supplied;
      return await new Promise<Buffer>((resolveDerived, rejectDerived) => {
        scrypt(
          supplied,
          salt,
          KEY_BYTES,
          { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 },
          (error, derived) => {
            if (error !== null) rejectDerived(error);
            else resolveDerived(Buffer.from(derived));
          }
        );
      });
    } catch (error) {
      if (error instanceof KeyProviderError) throw error;
      return fail("Keystore key derivation failed", { cause: error });
    } finally {
      passphrase?.fill(0);
    }
  }
}
