const PROCESS_VARIABLES = ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE"] as const;

// invariant: a child process the task path starts sees an explicit environment
// or only the variables it needs to start and find the user's home; nothing
// else of this process's environment is inherited.
export function safeEnvironment(explicit?: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  if (explicit !== undefined) return { ...explicit, CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" };
  const result: NodeJS.ProcessEnv = { CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" };
  for (const key of PROCESS_VARIABLES) {
    if (process.env[key] !== undefined) result[key] = process.env[key];
  }
  return result;
}
