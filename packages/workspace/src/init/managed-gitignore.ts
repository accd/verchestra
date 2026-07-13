import { WorkspaceScanError } from "../scanner/scanner-primitives.ts";

const START = "# >>> verchestra managed: local safety fallback";
const END = "# <<< verchestra managed";

export const MANAGED_GITIGNORE_LINES = Object.freeze([
  START,
  ".verchestra/.local/",
  ".verchestra/.runtime/",
  ".verchestra/.cache/",
  ".verchestra/.sessions/",
  ".verchestra/.worktrees/",
  ".verchestra/.secrets/",
  END
]);

export interface ManagedGitignoreEdit {
  readonly changed: boolean;
  readonly content: string;
  readonly newline: "lf" | "crlf";
}

function newlineOf(content: string): { readonly value: "\n" | "\r\n"; readonly name: "lf" | "crlf" } {
  const hasCrLf = content.includes("\r\n");
  const hasBareLf = /(^|[^\r])\n/u.test(content);
  const hasBareCr = /\r(?!\n)/u.test(content);
  if ((hasCrLf && hasBareLf) || hasBareCr) {
    throw new WorkspaceScanError("VES_INIT_GITIGNORE_NEWLINE_AMBIGUOUS", "Gitignore newline style is ambiguous");
  }
  return hasCrLf ? { value: "\r\n", name: "crlf" } : { value: "\n", name: "lf" };
}

export function editManagedGitignore(existing: string | undefined): ManagedGitignoreEdit {
  const original = existing ?? "";
  if (original.includes("\0")) {
    throw new WorkspaceScanError("VES_INIT_GITIGNORE_AMBIGUOUS", "Gitignore contains invalid control data");
  }
  const newline = newlineOf(original);
  const block = `${MANAGED_GITIGNORE_LINES.join(newline.value)}${newline.value}`;
  if (original.length === 0) return Object.freeze({ changed: true, content: block, newline: newline.name });

  const lines = original.split(newline.value);
  const starts = lines.flatMap((line, index) => (line === START ? [index] : []));
  const ends = lines.flatMap((line, index) => (line === END ? [index] : []));
  if (starts.length > 1 || ends.length > 1 || starts.length !== ends.length) {
    throw new WorkspaceScanError("VES_INIT_GITIGNORE_AMBIGUOUS", "Gitignore managed delimiters are ambiguous");
  }

  let content: string;
  if (starts.length === 0) {
    content = original.endsWith(newline.value) ? `${original}${block}` : `${original}${newline.value}${block}`;
  } else {
    const start = starts[0] as number;
    const end = ends[0] as number;
    if (end < start) {
      throw new WorkspaceScanError("VES_INIT_GITIGNORE_AMBIGUOUS", "Gitignore managed delimiters are reversed");
    }
    content = [...lines.slice(0, start), ...MANAGED_GITIGNORE_LINES, ...lines.slice(end + 1)].join(newline.value);
  }
  return Object.freeze({ changed: content !== original, content, newline: newline.name });
}
