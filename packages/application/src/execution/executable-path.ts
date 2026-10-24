// invariant: a program starts by an absolute path found on an absolute PATH
// entry only. A bare name is resolved by the operating system, and a relative
// entry such as `.` makes that resolution reach into the repository a command
// inspects, where a planted binary would run in its place.
// why: every adapter that starts git shares this one rule; each passes its
// own path and filesystem functions, so the rule imports no node: module.
export interface ExecutablePathApi {
  readonly delimiter: string;
  readonly isAbsolute: (path: string) => boolean;
  readonly join: (directory: string, file: string) => string;
}

export interface ExecutableFileSystem {
  readonly statSync: (path: string) => { isFile(): boolean };
  readonly accessSync: (path: string, mode: number) => void;
  readonly executableMode: number;
}

function isExecutableFile(path: string, fs: ExecutableFileSystem): boolean {
  try {
    if (!fs.statSync(path).isFile()) return false;
    fs.accessSync(path, fs.executableMode);
    return true;
  } catch {
    return false;
  }
}

export function absoluteExecutableOnPath(
  file: string,
  pathValue: string | undefined,
  path: ExecutablePathApi,
  fs: ExecutableFileSystem
): string {
  for (const directory of (pathValue ?? "").split(path.delimiter)) {
    if (!path.isAbsolute(directory)) continue;
    const candidate = path.join(directory, file);
    if (isExecutableFile(candidate, fs)) return candidate;
  }
  throw Object.assign(new Error(`${file} is not on an absolute PATH entry`), { code: "ENOENT" });
}
