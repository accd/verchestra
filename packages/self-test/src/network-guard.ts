// T70: the offline guard for a Self-Test scenario call (PRF-01). It blocks
// and records every outbound connection attempt for the duration of its
// scope; the verdict on whether any attempt is acceptable stays in
// application's assertNoNetworkAttempts.
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { NetworkAttempt } from "@verchestra/application";

export interface OfflineGuard {
  readonly attempts: () => readonly NetworkAttempt[];
  readonly restore: () => void;
}

function describeConnect(args: readonly unknown[]): string {
  const first = args[0];
  if (typeof first === "object" && first !== null) {
    const options = first as { host?: unknown; path?: unknown; port?: unknown };
    if (typeof options.path === "string") return options.path;
    if (typeof options.host === "string") return `${options.host}:${String(options.port ?? "")}`;
  }
  if (typeof first === "number") return `port ${first}`;
  return "unknown target";
}

function describeRequestArgs(args: readonly unknown[]): string {
  const first = args[0];
  if (typeof first === "string") return first;
  if (first instanceof URL) return first.href;
  if (typeof first === "object" && first !== null) {
    const options = first as { host?: unknown; hostname?: unknown; path?: unknown };
    const host = options.hostname ?? options.host ?? "unknown-host";
    return `${String(host)}${typeof options.path === "string" ? options.path : ""}`;
  }
  return "unknown target";
}

// Blocks (never merely observes) so a scenario cannot dial out, hang, or
// leak state through a real connection before the guard reports the attempt.
export function offlineGuard(): OfflineGuard {
  const attempts: NetworkAttempt[] = [];
  const originalConnect = net.Socket.prototype.connect;
  const originalHttpRequest = http.request;
  const originalHttpsRequest = https.request;
  const originalFetch = globalThis.fetch;

  function blocked(api: NetworkAttempt["api"], target: string): never {
    attempts.push(Object.freeze({ api, target }));
    throw new Error(`self-test offline guard blocked ${api} to ${target}`);
  }

  net.Socket.prototype.connect = function (this: net.Socket, ...args: readonly unknown[]) {
    return blocked("net.connect", describeConnect(args));
  } as typeof net.Socket.prototype.connect;
  http.request = ((...args: readonly unknown[]) =>
    blocked("http.request", describeRequestArgs(args))) as typeof http.request;
  https.request = ((...args: readonly unknown[]) =>
    blocked("https.request", describeRequestArgs(args))) as typeof https.request;
  if (typeof originalFetch === "function") {
    globalThis.fetch = ((input: unknown) => {
      const target = typeof input === "string" ? input : input instanceof URL ? input.href : "unknown target";
      return Promise.reject(new Error(`self-test offline guard blocked fetch to ${target}`)).finally(() => {
        attempts.push(Object.freeze({ api: "fetch", target }));
      });
    }) as typeof fetch;
  }

  return Object.freeze({
    attempts: (): readonly NetworkAttempt[] => Object.freeze([...attempts]),
    restore: (): void => {
      net.Socket.prototype.connect = originalConnect;
      http.request = originalHttpRequest;
      https.request = originalHttpsRequest;
      if (typeof originalFetch === "function") globalThis.fetch = originalFetch;
    }
  });
}
