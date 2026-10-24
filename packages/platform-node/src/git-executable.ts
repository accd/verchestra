import { accessSync, constants, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

// invariant: git starts by an absolute path found on an absolute PATH entry
// only. A bare name is resolved by the operating system, and a relative entry
// such as `.` makes that resolution reach into the repository the command
// inspects, where a planted binary would run in git's place.
// why: each adapter package that starts git keeps its own copy, since none may
// import a sibling adapter; tests/unit/git-executable.test.mjs holds the
// copies to one behaviour.
export function resolveGitExecutable(
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform: string = process.platform
): string {
  const file = platform === "win32" ? "git.exe" : "git";
  for (const directory of (env["PATH"] ?? "").split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    const candidate = join(directory, file);
    if (isExecutableFile(candidate)) return candidate;
  }
  throw Object.assign(new Error("git is not on an absolute PATH entry"), { code: "ENOENT" });
}

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
