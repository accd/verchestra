// invariant: a child process sees an explicit environment, or only the
// variables it needs to start and find the user's home; nothing else of the
// parent's environment is inherited.
// why: every adapter that starts a child shares this one rule; each passes its
// own environment, so the rule reads no process state.
export type EnvironmentSource = Readonly<Record<string, string | undefined>>;

const PROCESS_VARIABLES = ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE"] as const;

export function childEnvironment(
  source: EnvironmentSource,
  explicit?: Readonly<Record<string, string>>
): Record<string, string> {
  if (explicit !== undefined) return { ...explicit, CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" };
  const result: Record<string, string> = { CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" };
  for (const key of PROCESS_VARIABLES) {
    const value = source[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}

// why: the scrub must not cost git what it legitimately needs. These locate
// the user's own configuration when it is not under HOME, and name the commit
// identity when it is given by environment instead of configuration; none of
// them can aim git at another repository or change what it executes.
const GIT_VARIABLES = [
  "XDG_CONFIG_HOME",
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL"
] as const;

// hazard: git reads its repository, index, object store, configuration, and
// helper programs from GIT_* variables before it looks at its working
// directory. An inherited GIT_DIR, GIT_CONFIG_* or GIT_EXEC_PATH would turn an
// operation on one repository into one on another, or under other rules, so
// git never inherits the parent's environment.
export function gitChildEnvironment(source: EnvironmentSource): Record<string, string> {
  const environment = childEnvironment(source);
  for (const key of GIT_VARIABLES) {
    const value = source[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}
