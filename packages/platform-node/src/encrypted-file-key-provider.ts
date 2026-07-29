import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from "node:crypto";
import { link, lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  IntegrityError,
  NodeEd25519Signer,
  type EvidenceSigner,
  type KeyProviderRequest,
  type PublicKeyRef
} from "@verchestra/evidence";
const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;

interface KeystoreEnvelope {
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

function fail(message: string, options?: ErrorOptions): never {
  throw new IntegrityError("VES_KEYSTORE_INTEGRITY", message, options);
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
    input["version"] !== 1 ||
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

export class EncryptedFileKeyProvider {
  readonly #stateRoot: string;
  readonly #passphrase: () => Promise<Uint8Array>;

  constructor(options: { readonly stateRoot: string; readonly passphrase: () => Promise<Uint8Array> }) {
    if (
      !isAbsolute(options.stateRoot) ||
      options.stateRoot.includes("\0") ||
      typeof options.passphrase !== "function"
    ) {
      fail("Keystore configuration is invalid");
    }
    this.#stateRoot = resolve(options.stateRoot);
    this.#passphrase = options.passphrase;
  }

  async loadOrCreate(request: KeyProviderRequest): Promise<EvidenceSigner> {
    const root = await this.#root();
    const target = join(root, `${createHash("sha256").update(request.keyId, "utf8").digest("hex")}.key.json`);
    try {
      return await this.#load(target, request);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const signer = NodeEd25519Signer.generate(request);
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
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return await this.#load(target, request);
      throw error;
    } finally {
      await rm(temporary, { force: true });
    }
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

  async #load(path: string, request: KeyProviderRequest): Promise<EvidenceSigner> {
    let envelope: KeystoreEnvelope;
    try {
      envelope = parseEnvelope(JSON.parse(await readFile(path, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
      if (error instanceof IntegrityError) throw error;
      fail("Keystore could not be read", { cause: error });
    }
    if (
      envelope.keyId !== request.keyId ||
      envelope.publicKeyRef.keyId !== request.keyId ||
      !sameArray(envelope.publicKeyRef.purposes, request.purposes)
    ) {
      fail("Keystore identity does not match the requested key");
    }
    const privateKey = await this.#decrypt(envelope);
    try {
      const signer = NodeEd25519Signer.fromPkcs8(
        {
          keyId: envelope.publicKeyRef.keyId,
          purposes: envelope.publicKeyRef.purposes,
          ...(envelope.publicKeyRef.validFrom === undefined ? {} : { validFrom: envelope.publicKeyRef.validFrom }),
          ...(envelope.publicKeyRef.validUntil === undefined ? {} : { validUntil: envelope.publicKeyRef.validUntil })
        },
        privateKey
      );
      if (!sameReference(signer.publicKeyRef, envelope.publicKeyRef))
        fail("Keystore public key does not match private key material");
      return signer;
    } finally {
      privateKey.fill(0);
    }
  }

  async #encrypt(signer: NodeEd25519Signer): Promise<KeystoreEnvelope> {
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
      if (error instanceof IntegrityError) throw error;
      return fail("Keystore key derivation failed", { cause: error });
    } finally {
      passphrase?.fill(0);
    }
  }
}
