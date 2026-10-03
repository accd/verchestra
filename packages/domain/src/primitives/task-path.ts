// invariant: the one rule for a task path on every stage of the task path:
// the request, the MCP bridge, the executor, the worktree tool, the Git
// adapters, the gate, and the verifier. A stage still validates its own
// untrusted input and keeps its own refusal codes; what a task path is and how
// two of them compare is decided here and nowhere else.
//
// invariant: a letter-case variant never widens what is admitted. A case
// variant of a protected path is protected, a case variant of a scope entry is
// outside the scope, and two scopes that differ only in case overlap. On a
// case-insensitive volume, the macOS default, a variant names the same file;
// on a case-sensitive one it names another. Each test answers for the worse.
// Folding is for comparison only; no path is stored or digested folded.

// hazard: model-supplied paths are checked by linear scans, never by a regular
// expression that can backtrack over a long run of separators.
const TASK_PATH_CHARACTERS = new Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._@+/-");

// invariant: accepts exactly the strings the path pattern of
// schemas/task-request/1.schema.json accepts: non-empty, portable characters
// only, not rooted, and no `..` segment. A backslash, a drive colon, and every
// non-ASCII character, a Unicode lookalike of a protected name included, fall
// outside the character set, so folding below only ever folds ASCII letters.
export function isTaskPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.startsWith("/")) return false;
  for (const character of value) if (!TASK_PATH_CHARACTERS.has(character)) return false;
  return !value.split("/").includes("..");
}

// invariant: a task path names its segments relative to the worktree, without
// the empty and `.` ones a doubled or trailing separator or a `./` leaves, so
// every spelling of a path compares as what it names. `.` names the worktree
// itself, as no segments.
export function taskPathSegments(path: string): readonly string[] {
  return path.split("/").filter((segment) => segment !== "" && segment !== ".");
}

function folded(path: string): readonly string[] {
  return taskPathSegments(path.toLowerCase());
}

function isPrefix(prefix: readonly string[], path: readonly string[]): boolean {
  return prefix.length <= path.length && prefix.every((segment, index) => segment === path[index]);
}

// invariant: a path is within an entry when the entry names the path or one
// of its parents in the letter case the entry is written.
export function isWithinTaskPath(path: string, entry: string): boolean {
  return isPrefix(taskPathSegments(entry), taskPathSegments(path));
}

export function isWithinTaskScope(path: string, scope: readonly string[]): boolean {
  return scope.some((entry) => isWithinTaskPath(path, entry));
}

export function isProtectedTaskPath(path: string, protectedPaths: readonly string[]): boolean {
  const target = folded(path);
  return protectedPaths.some((entry) => isPrefix(folded(entry), target));
}

// invariant: Git metadata is protected at any depth and in any letter case.
export function namesGitMetadata(path: string): boolean {
  return folded(path).includes(".git");
}

// invariant: two scope entries overlap when either contains the other in any
// letter case.
export function taskPathsOverlap(left: string, right: string): boolean {
  const leftSegments = folded(left);
  const rightSegments = folded(right);
  return isPrefix(leftSegments, rightSegments) || isPrefix(rightSegments, leftSegments);
}
