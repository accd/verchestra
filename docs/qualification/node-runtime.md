# Node Runtime and Launcher Qualification

**Task:** T01  
**Status:** Qualified for the T01 contract  
**Qualified Node:** 24.14.0  
**Qualified pnpm:** 10.34.5 through Corepack

## Contract

- Verchestra distribution contains its own pinned Node runtime.
- `vestra` is canonical and `verchestra` is a behavior-identical alias.
- Launchers resolve runtime/application paths relative to themselves and do not use ambient Node or `node_modules`.
- The bootstrap validates release schema, platform, architecture, Node patch, runtime digest, and application digest before importing the CLI.
- Windows `.cmd` and POSIX shell launchers are generated from deterministic templates. Native execution runs on the current platform; the same contract suite is designed to run unchanged in the later Windows/Linux/macOS matrix.

## Evidence

Command: `corepack pnpm@10.34.5 gate:build`

- Environment executed: Windows `win32-x64`, Node `24.14.0`, pnpm `10.34.5`.
- Result: 16 passed, 0 failed, 0 skipped, 0 todo.
- Current-platform launchers were executed from paths containing spaces with an empty `PATH` case.
- Windows and POSIX launcher templates are deterministic and behavior-identical by alias; native Linux/macOS execution remains part of the release platform matrix rather than being claimed from a Windows host.
- Tampered application and wrong-platform bundles fail with exit `70` before CLI import.
- Unknown CLI input returns stable exit `64` from both executable names.
- The reported release digest equals the SHA-256 of `release.json`; the bundled runtime digest equals the manifest value.
- The generated bundle contains no `node_modules` and resolves no ambient package dependency.
