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
  if (!/^[a-z][a-z0-9.-]{0,126}[a-z0-9]$/u.test(binding.logicalName)) {
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

interface OsSecretBackend {
  has(locator: Readonly<{ namespace: string; logicalName: string }>): Promise<boolean>;
  read(locator: Readonly<{ namespace: string; logicalName: string }>): Promise<Uint8Array | undefined>;
}

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

export class QualifiedOsSecretAdapter implements SecretAdapter {
  readonly adapterId: string;
  readonly #backend: OsSecretBackend;

  constructor(options: {
    readonly platform: string;
    readonly evidence?: { readonly digest: string; readonly controls: readonly string[] };
    readonly backend: OsSecretBackend;
  }) {
    const contract = OS_SECRET_CONTROLS[options.platform as keyof typeof OS_SECRET_CONTROLS];
    const evidence = options.evidence;
    if (
      contract === undefined ||
      evidence === undefined ||
      !/^[a-f0-9]{64}$/u.test(evidence.digest) ||
      !contract.controls.every((control) => evidence.controls.includes(control))
    ) {
      throw new PlatformSecurityError("VES_SECRET_STORE_UNQUALIFIED", "OS secret store lacks complete qualification");
    }
    if (typeof options.backend.has !== "function" || typeof options.backend.read !== "function") {
      throw new PlatformSecurityError("VES_SECRET_STORE_UNQUALIFIED", "OS secret-store bridge contract is incomplete");
    }
    this.adapterId = contract.adapterId;
    this.#backend = options.backend;
  }

  async has(workspaceId: string, logicalName: string): Promise<boolean> {
    try {
      return await this.#backend.has(Object.freeze({ namespace: `verchestra/${workspaceId}`, logicalName }));
    } catch (error) {
      throw new PlatformSecurityError(
        "VES_SECRET_BACKEND_FAILURE",
        "Qualified OS secret-store lookup failed",
        {},
        { cause: error }
      );
    }
  }

  async read(workspaceId: string, logicalName: string): Promise<Uint8Array | undefined> {
    try {
      const value = await this.#backend.read(Object.freeze({ namespace: `verchestra/${workspaceId}`, logicalName }));
      return value === undefined ? undefined : Uint8Array.from(value);
    } catch (error) {
      throw new PlatformSecurityError(
        "VES_SECRET_BACKEND_FAILURE",
        "Qualified OS secret-store read failed",
        {},
        { cause: error }
      );
    }
  }
}
