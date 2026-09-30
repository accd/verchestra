import { existsSync } from "node:fs";
import { join } from "node:path";

// hazard: test fixtures run git from a fixed system location, never from a
// PATH entry that a writable directory could shadow.
const CANDIDATES =
  process.platform === "win32"
    ? [join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "cmd", "git.exe")]
    : ["/usr/bin/git", "/bin/git"];
let resolved;

export function systemGit() {
  resolved ??= CANDIDATES.find((candidate) => existsSync(candidate));
  if (resolved === undefined) throw new Error("git is not installed in a fixed system location");
  return resolved;
}
