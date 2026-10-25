import { accessSync, constants, statSync } from "node:fs";
import * as path from "node:path";

import { absoluteExecutableOnPath, gitChildEnvironment } from "@verchestra/application";

// why: the rule is absoluteExecutableOnPath in @verchestra/application; this
// adapter supplies the filesystem it reads.
export function resolveGitExecutable(
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform: string = process.platform
): string {
  const file = platform === "win32" ? "git.exe" : "git";
  return absoluteExecutableOnPath(file, env["PATH"], path, { statSync, accessSync, executableMode: constants.X_OK });
}

// invariant: init and the scanner start git with the task path's scrubbed
// environment (gitChildEnvironment), so an inherited GIT_DIR or GIT_CONFIG_*
// cannot make them read another repository or other rules. A read-only
// inspection also takes no optional lock.
export function gitInspectionEnvironment(): Record<string, string> {
  return { ...gitChildEnvironment(process.env), GIT_OPTIONAL_LOCKS: "0" };
}
