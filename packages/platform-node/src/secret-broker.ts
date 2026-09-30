import { randomUUID } from "node:crypto";

import { StableId } from "@verchestra/domain";

import { PlatformSecurityError } from "./platform-security-errors.ts";

export interface SecretBinding {
  readonly workspaceId: string;
  readonly logicalName: string;
  readonly purpose: string;
  readonly blockedCapability: string;
  readonly expectedStore: string;
}

export interface SecretHandle {
  readonly handleId: string;
  readonly workspaceId: string;
  readonly logicalName: string;
  readonly purpose: string;
  toJSON(): Readonly<Record<string, string>>;
}

export interface SecretAdapter {
  readonly adapterId: string;
  has(workspaceId: string, logicalName: string): Promise<boolean>;
  read(workspaceId: string, logicalName: string): Promise<Uint8Array | undefined>;
}

const handleBindings = new WeakMap<object, { readonly broker: object; readonly binding: SecretBinding }>();

class OpaqueSecretHandle implements SecretHandle {
  readonly handleId: string;
  readonly workspaceId: string;
  readonly logicalName: string;
  readonly purpose: string;

  constructor(handleId: string, binding: SecretBinding, broker: object) {
    this.handleId = handleId;
    this.workspaceId = binding.workspaceId;
    this.logicalName = binding.logicalName;
    this.purpose = binding.purpose;
    handleBindings.set(this, { broker, binding });
    Object.freeze(this);
  }

  toJSON(): Readonly<Record<string, string>> {
    return Object.freeze({
      handleId: this.handleId,
      workspaceId: this.workspaceId,
      logicalName: this.logicalName,
      purpose: this.purpose
    });
  }
}

const LOGICAL_SECRET_NAME = /^[a-z][a-z0-9.-]{0,126}[a-z0-9]$/u;

export function isValidLogicalSecretName(value: unknown): value is string {
  return typeof value === "string" && LOGICAL_SECRET_NAME.test(value);
}

function validateBinding(binding: SecretBinding): void {
  for (const field of ["workspaceId", "logicalName", "purpose", "blockedCapability", "expectedStore"] as const) {
    const value = binding[field];
    if (
      typeof value !== "string" ||
      value.trim().length === 0 ||
      value.length > 512 ||
      /[\u0000-\u001f]/u.test(value)
    ) {
      throw new PlatformSecurityError("VES_SECRET_BINDING_INVALID", `Secret binding ${field} is invalid`);
    }
  }
  if (!isValidLogicalSecretName(binding.logicalName)) {
    throw new PlatformSecurityError("VES_SECRET_BINDING_INVALID", "Logical secret name is invalid");
  }
}

function missing(binding: SecretBinding): PlatformSecurityError {
  return new PlatformSecurityError("VES_SECRET_MISSING", "Required local credential is not bound", {
    logicalName: binding.logicalName,
    expectedStore: binding.expectedStore,
    purpose: binding.purpose,
    blockedCapability: binding.blockedCapability
  });
}

export class SecretBroker {
  readonly #adapter: SecretAdapter;
  readonly #workspaceId: string;
  readonly #idSource: () => string;
  readonly #identity = Object.freeze({});

  constructor(options: {
    readonly adapter: SecretAdapter;
    readonly workspaceId: string;
    readonly idSource?: () => string;
  }) {
    try {
      StableId.parse(options.workspaceId, "workspace");
    } catch (error) {
      throw new PlatformSecurityError("VES_WORKSPACE_ID_INVALID", "Workspace ID is invalid", {}, { cause: error });
    }
    this.#adapter = options.adapter;
    this.#workspaceId = options.workspaceId;
    this.#idSource = options.idSource ?? randomUUID;
  }

  async bind(binding: SecretBinding): Promise<SecretHandle> {
    validateBinding(binding);
    if (binding.workspaceId !== this.#workspaceId) {
      throw new PlatformSecurityError("VES_SECRET_WORKSPACE_MISMATCH", "Secret binding belongs to another Workspace");
    }
    if (!(await this.#adapter.has(binding.workspaceId, binding.logicalName))) throw missing(binding);
    return new OpaqueSecretHandle(this.#idSource(), Object.freeze({ ...binding }), this.#identity);
  }

  async withSecret<T>(handle: SecretHandle, consumer: (value: Uint8Array) => Promise<T> | T): Promise<T> {
    const record = handleBindings.get(handle as object);
    if (record === undefined || record.broker !== this.#identity || record.binding.workspaceId !== this.#workspaceId) {
      throw new PlatformSecurityError("VES_SECRET_HANDLE_INVALID", "Secret handle is not authentic for this broker");
    }
    const stored = await this.#adapter.read(record.binding.workspaceId, record.binding.logicalName);
    if (stored === undefined) throw missing(record.binding);
    const ephemeral = stored;
    try {
      return await consumer(ephemeral);
    } finally {
      ephemeral.fill(0);
    }
  }
}

export class MockSecretAdapter implements SecretAdapter {
  readonly adapterId = "mock-secret-store";
  readonly #values = new Map<string, Uint8Array>();

  set(workspaceId: string, logicalName: string, value: Uint8Array): void {
    this.#values.set(`${workspaceId}\0${logicalName}`, Uint8Array.from(value));
  }

  delete(workspaceId: string, logicalName: string): void {
    this.#values.delete(`${workspaceId}\0${logicalName}`);
  }

  async has(workspaceId: string, logicalName: string): Promise<boolean> {
    return this.#values.has(`${workspaceId}\0${logicalName}`);
  }

  async read(workspaceId: string, logicalName: string): Promise<Uint8Array | undefined> {
    const value = this.#values.get(`${workspaceId}\0${logicalName}`);
    return value === undefined ? undefined : Uint8Array.from(value);
  }
}

export interface OsSecretLocator {
  readonly namespace: string;
  readonly logicalName: string;
}

// invariant: every OS store item is namespaced by its owning Workspace, so one
// Workspace's logical name can never resolve another Workspace's credential.
export function osSecretNamespace(workspaceId: string): string {
  return `verchestra/${workspaceId}`;
}

export interface OsSecretBackend {
  has(locator: Readonly<OsSecretLocator>): Promise<boolean>;
  read(locator: Readonly<OsSecretLocator>): Promise<Uint8Array | undefined>;
}

export interface OsSecretQualificationEvidence {
  readonly digest: string;
  readonly controls: readonly string[];
}

// invariant: key material (signing and recipient keys) must stay
// non-exportable. This contract is never relaxed to admit a readable
// credential; readable credentials qualify against OS_CREDENTIAL_CONTROLS
// below instead (AD-034).
const OS_SECRET_CONTROLS = Object.freeze({
  win32: Object.freeze({
    adapterId: "windows-cng",
    controls: ["cng-ksp", "non-exportable", "user-scope", "access-control"]
  }),
  darwin: Object.freeze({
    adapterId: "apple-keychain",
    controls: ["keychain", "non-exportable", "user-scope", "access-control"]
  }),
  linux: Object.freeze({
    adapterId: "secret-service",
    controls: ["secret-service", "locked-collection", "user-scope", "access-control"]
  })
});

// why: an API key must be handed to a child process, so it is readable by
// construction and cannot honestly claim non-exportable. This is the separate,
// honest contract for readable provider credentials (AD-034). Each platform
// names only what its own store guarantees and earns its own qualification
// report (AD-041).
export const OS_CREDENTIAL_CONTROLS = Object.freeze({
  darwin: Object.freeze({
    adapterId: "apple-keychain-credential",
    controls: Object.freeze(["keychain", "user-scope", "workspace-namespace", "not-in-argv", "presence-without-value"])
  }),
  linux: Object.freeze({
    adapterId: "secret-service-credential",
    controls: Object.freeze([
      "secret-service",
      "user-scope",
      "workspace-namespace",
      "not-in-argv",
      "presence-without-value"
    ])
  }),
  win32: Object.freeze({
    adapterId: "windows-credential-manager",
    controls: Object.freeze([
      "credential-manager",
      "dpapi-at-rest",
      "user-scope",
      "workspace-namespace",
      "not-in-argv",
      "presence-without-value"
    ])
  })
});

function qualifies(
  contract: { readonly controls: readonly string[] } | undefined,
  evidence: OsSecretQualificationEvidence | undefined
): boolean {
  return (
    contract !== undefined &&
    evidence !== undefined &&
    /^[a-f0-9]{64}$/u.test(evidence.digest) &&
    contract.controls.every((control) => evidence.controls.includes(control))
  );
}

function assertBridge(backend: OsSecretBackend): void {
  if (typeof backend?.has !== "function" || typeof backend?.read !== "function") {
    throw new PlatformSecurityError("VES_SECRET_STORE_UNQUALIFIED", "OS secret-store bridge contract is incomplete");
  }
}

// why: these codes tell the user what to do (unlock, fix the path, start the
// store) and carry no backend text, so they pass through; everything else is
// collapsed into VES_SECRET_BACKEND_FAILURE so no private native wording escapes.
const ACTIONABLE_BACKEND_CODES = new Set([
  "VES_SECRET_KEYCHAIN_INTERACTION_REQUIRED",
  "VES_SECRET_KEYCHAIN_INVALID",
  "VES_SECRET_STORE_UNAVAILABLE"
]);

function backendFailure(error: unknown, message: string): PlatformSecurityError {
  if (error instanceof PlatformSecurityError && ACTIONABLE_BACKEND_CODES.has(error.code)) return error;
  return new PlatformSecurityError("VES_SECRET_BACKEND_FAILURE", message, {}, { cause: error });
}

async function bridgeHas(backend: OsSecretBackend, workspaceId: string, logicalName: string): Promise<boolean> {
  try {
    return await backend.has(Object.freeze({ namespace: osSecretNamespace(workspaceId), logicalName }));
  } catch (error) {
    throw backendFailure(error, "Qualified OS secret-store lookup failed");
  }
}

async function bridgeRead(
  backend: OsSecretBackend,
  workspaceId: string,
  logicalName: string
): Promise<Uint8Array | undefined> {
  try {
    const value = await backend.read(Object.freeze({ namespace: osSecretNamespace(workspaceId), logicalName }));
    return value === undefined ? undefined : Uint8Array.from(value);
  } catch (error) {
    throw backendFailure(error, "Qualified OS secret-store read failed");
  }
}

export class QualifiedOsSecretAdapter implements SecretAdapter {
  readonly adapterId: string;
  readonly #backend: OsSecretBackend;

  constructor(options: {
    readonly platform: string;
    readonly evidence?: OsSecretQualificationEvidence;
    readonly backend: OsSecretBackend;
  }) {
    const contract = OS_SECRET_CONTROLS[options.platform as keyof typeof OS_SECRET_CONTROLS];
    if (contract === undefined || !qualifies(contract, options.evidence)) {
      throw new PlatformSecurityError("VES_SECRET_STORE_UNQUALIFIED", "OS secret store lacks complete qualification");
    }
    assertBridge(options.backend);
    this.adapterId = contract.adapterId;
    this.#backend = options.backend;
  }

  async has(workspaceId: string, logicalName: string): Promise<boolean> {
    return bridgeHas(this.#backend, workspaceId, logicalName);
  }

  async read(workspaceId: string, logicalName: string): Promise<Uint8Array | undefined> {
    return bridgeRead(this.#backend, workspaceId, logicalName);
  }
}

export class QualifiedOsCredentialAdapter implements SecretAdapter {
  readonly adapterId: string;
  readonly #backend: OsSecretBackend;

  constructor(options: {
    readonly platform: string;
    readonly evidence?: OsSecretQualificationEvidence;
    readonly backend: OsSecretBackend;
  }) {
    const contract = OS_CREDENTIAL_CONTROLS[options.platform as keyof typeof OS_CREDENTIAL_CONTROLS];
    if (contract === undefined || !qualifies(contract, options.evidence)) {
      throw new PlatformSecurityError(
        "VES_SECRET_STORE_UNQUALIFIED",
        "OS credential store lacks complete qualification"
      );
    }
    assertBridge(options.backend);
    this.adapterId = contract.adapterId;
    this.#backend = options.backend;
  }

  async has(workspaceId: string, logicalName: string): Promise<boolean> {
    return bridgeHas(this.#backend, workspaceId, logicalName);
  }

  async read(workspaceId: string, logicalName: string): Promise<Uint8Array | undefined> {
    return bridgeRead(this.#backend, workspaceId, logicalName);
  }
}
