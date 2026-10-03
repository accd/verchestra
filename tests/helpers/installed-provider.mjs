import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";

// hazard: a read-only probe of an installed provider CLI runs it by the
// absolute path found on an absolute PATH entry, never by a name a spawn would
// resolve itself. Undefined means the provider is not configured here.
// why: a native Windows install is an `.exe`; an npm cmd-shim cannot be
// spawned without a shell, and the spikes resolve it to its script first.
export async function installedProviderPath(command) {
  if (isAbsolute(command)) return command;
  const names = process.platform === "win32" ? [command, `${command}.exe`] : [command];
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    for (const name of names) {
      const candidate = join(directory, name);
      if (
        await access(candidate, constants.X_OK).then(
          () => true,
          () => false
        )
      )
        return candidate;
    }
  }
  return undefined;
}
