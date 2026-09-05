# Installed task delivery (#405)

The complete issue remains open. The first implementation slice supplies the
explicit Codex process context needed before composing a governed task command.
This slice adds no public command and does not claim live-provider qualification.

- TDC-01: an explicitly configured Codex driver uses the selected directory for
  version probing, app-server spawn and thread/start, without changing controller cwd.
- TDC-02: that mode excludes controller identity, search paths and provider state;
  HOME, USERPROFILE and CODEX_HOME must be explicitly supplied absolute directories.
  Session/turn reuse keys are removed. Windows platform-loader SYSTEMROOT,
  SYSTEMDRIVE and WINDIR remain native runtime inputs; this is not OS isolation.
- TDC-03: reject malformed contexts and relative executables before spawning;
  snapshot the supplied context so caller mutation cannot redirect execution.
- TDC-04: preserve existing callers without a process context, including their
  qualified read-only and ephemeral protocol behavior.

The composition root must eventually supply an approved worktree, absolute
executable and dedicated local provider configuration. A process context is not
an OS sandbox or authorization grant and is never a portable artifact.

Per-operation environments are validated too. Invalid/empty identity-directory
overrides cannot re-enable fallback. Windows names are case-normalized and
ambiguous case variants are rejected before execution.
