# First slice: explicit Codex process context

Add an optional CodexProcessContext to CodexDriverDependencies, carrying cwd and
an explicit environment. Validate and snapshot it at construction. When present,
probe/start/thread use its cwd and environment construction skips ambient values.
Per-operation explicit environment overlays are validated; thread/turn reuse
keys are removed case-insensitively. Require an absolute executable to prevent ambient
executable lookup. Preserve legacy behavior when the option is absent.

Use synthetic child-process fixtures to observe actual cwd/environment for probe
and execution, rather than only checking parameter builders. Existing fixtures
cover read-only protocol and lifecycle regressions. No dependency changes.

The initial subprocess test exposed libuv Windows required-variable fallback.
Require explicit absolute HOME/USERPROFILE/CODEX_HOME and supply empty defaults
for omitted Windows identity/search/temp variables. Preserve native loader roots
(SYSTEMROOT/SYSTEMDRIVE/WINDIR); blank SYSTEMROOT makes Node CSPRNG initialization
abort. The test now asserts exact selected identity directories and disabled
search paths in addition to absence of synthetic controller identity. Merely
passing env={} is not a sufficient isolation claim. Source:
https://github.com/libuv/libuv/blob/v1.x/src/win/process.c (required_vars).

Follow-up slices: choose the public input/authority contract; connect a real
driver to mediated tools and durable executor ports; compose gates and review;
add source/built CLI tests and quick-start. #406 supplies separately authorized
live evidence. #379 owns production secret-store bridges.
