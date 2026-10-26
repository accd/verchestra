import type { SecretAdapter } from "./secret-broker.ts";

// invariant: ARQ-006 (#597). The in-memory secret adapter that tests seed
// lives here, never in the package's index.ts, so production code reaches a
// test double only by naming this module.
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
