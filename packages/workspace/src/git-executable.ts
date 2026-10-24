import { accessSync, constants, statSync } from "node:fs";
import * as path from "node:path";

import { absoluteExecutableOnPath } from "@verchestra/application";

// why: the rule is absoluteExecutableOnPath in @verchestra/application; this
// adapter supplies the filesystem it reads.
export function resolveGitExecutable(
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform: string = process.platform
): string {
  const file = platform === "win32" ? "git.exe" : "git";
  return absoluteExecutableOnPath(file, env["PATH"], path, { statSync, accessSync, executableMode: constants.X_OK });
}
