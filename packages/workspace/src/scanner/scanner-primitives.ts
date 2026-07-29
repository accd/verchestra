import { createHash } from "node:crypto";

export class WorkspaceScanError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkspaceScanError";
    this.code = code;
  }
}

function normalizedRepositoryPath(pathname: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname)
      .replaceAll("\\", "/")
      .replace(/\/+$/u, "")
      .replace(/\.git$/u, "");
  } catch (error) {
    throw new WorkspaceScanError("VES_WORKSPACE_REMOTE_INVALID", "Remote repository path is invalid", {
      cause: error
    });
  }
  if (decoded.length === 0 || decoded === "/") {
    throw new WorkspaceScanError("VES_WORKSPACE_REMOTE_INVALID", "Remote repository path is missing");
  }
  return decoded.startsWith("/") ? decoded : `/${decoded}`;
}

export function sanitizeRemoteUrl(value: string): string {
  if (value.length === 0 || /[\u0000-\u001f]/u.test(value)) {
    throw new WorkspaceScanError("VES_WORKSPACE_REMOTE_INVALID", "Remote URL is invalid");
  }
  // A Windows drive path matches the SCP-style pattern with the drive letter in
  // the host position, so `C:/Users/...` would otherwise become
  // `ssh://c/users/...` and carry a machine-local path into a portable
  // inventory. A local path is not a remote on any platform.
  if (/^(?:[A-Za-z]:[\\/]|[\\/]|file:)/u.test(value)) {
    throw new WorkspaceScanError("VES_WORKSPACE_REMOTE_INVALID", "Remote is a local filesystem path");
  }
  const scp = /^(?:[^@/:]+@)?([^/:]+):(.+)$/u.exec(value);
  if (scp !== null && !value.includes("://")) {
    const host = scp[1];
    const pathname = scp[2];
    if (host === undefined || pathname === undefined) {
      throw new WorkspaceScanError("VES_WORKSPACE_REMOTE_INVALID", "Remote URL is invalid");
    }
    return `ssh://${host.toLowerCase()}${normalizedRepositoryPath(pathname)}`;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new WorkspaceScanError("VES_WORKSPACE_REMOTE_INVALID", "Remote URL is invalid", { cause: error });
  }
  if (!new Set(["https:", "ssh:", "git:"]).has(url.protocol) || url.hostname.length === 0) {
    throw new WorkspaceScanError("VES_WORKSPACE_REMOTE_INVALID", "Remote URL scheme or host is invalid");
  }
  const host = url.port.length === 0 ? url.hostname.toLowerCase() : `${url.hostname.toLowerCase()}:${url.port}`;
  return `${url.protocol}//${host}${normalizedRepositoryPath(url.pathname)}`;
}

export function parseGitFile(content: string): Readonly<{ gitDir: string }> {
  const match = /^gitdir: ([^\r\n\0]+)\r?\n?$/u.exec(content);
  const gitDir = match?.[1];
  if (gitDir === undefined || gitDir.trim().length === 0 || gitDir !== gitDir.trim()) {
    throw new WorkspaceScanError("VES_WORKSPACE_GITFILE_INVALID", "Gitfile is malformed");
  }
  return Object.freeze({ gitDir });
}

export interface ProjectMarker {
  readonly kind:
    | "node-package"
    | "python-project"
    | "go-module"
    | "rust-crate"
    | "maven-project"
    | "gradle-project"
    | "dotnet-project"
    | "terraform-project";
  readonly file: string;
}

export function detectProjectMarker(files: readonly string[]): ProjectMarker | undefined {
  const ordered: readonly { readonly kind: ProjectMarker["kind"]; readonly match: (file: string) => boolean }[] = [
    { kind: "node-package", match: (file) => file === "package.json" },
    { kind: "python-project", match: (file) => file === "pyproject.toml" },
    { kind: "go-module", match: (file) => file === "go.mod" },
    { kind: "rust-crate", match: (file) => file === "Cargo.toml" },
    { kind: "maven-project", match: (file) => file === "pom.xml" },
    { kind: "gradle-project", match: (file) => file === "build.gradle" || file === "build.gradle.kts" },
    { kind: "dotnet-project", match: (file) => file.endsWith(".csproj") },
    { kind: "terraform-project", match: (file) => file.endsWith(".tf") }
  ];
  for (const rule of ordered) {
    const file = [...files].sort().find(rule.match);
    if (file !== undefined) return Object.freeze({ kind: rule.kind, file });
  }
  return undefined;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)])
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new WorkspaceScanError("VES_WORKSPACE_INVENTORY_INVALID", "Inventory contains a non-finite number");
  }
  return value;
}

export function buildInventoryFingerprint(value: unknown): string {
  const bytes = JSON.stringify(canonical(value));
  if (bytes === undefined)
    throw new WorkspaceScanError("VES_WORKSPACE_INVENTORY_INVALID", "Inventory is not serializable");
  return `sha256:${createHash("sha256").update(bytes, "utf8").digest("hex")}`;
}
