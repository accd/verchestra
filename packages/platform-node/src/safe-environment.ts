import { childEnvironment } from "@verchestra/application";

// invariant: a child process the task path starts sees an explicit environment
// or only the variables it needs to start and find the user's home; nothing
// else of this process's environment is inherited. The rule is
// childEnvironment in @verchestra/application.
export function safeEnvironment(explicit?: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  return childEnvironment(process.env, explicit);
}
