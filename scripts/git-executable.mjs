// invariant: repository scripts start git by an absolute path found on an
// absolute PATH entry, the same rule production follows (see
// tests/architecture/absolute-child-executables.test.mjs). A bare name, or a
// relative entry such as `.`, lets resolution reach into the repository the
// script inspects, where a planted `git` would run in place of the real one.
// why: the rule lives in @verchestra/application; it imports nothing, so a
// script can load it by path and stay usable before dependencies are installed.
import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";

import { absoluteExecutableOnPath } from "../packages/application/src/execution/executable-path.ts";

export function gitExecutable(env = process.env, platform = process.platform) {
  const file = platform === "win32" ? "git.exe" : "git";
  return absoluteExecutableOnPath(file, env.PATH, path, {
    statSync,
    accessSync,
    executableMode: constants.X_OK
  });
}
