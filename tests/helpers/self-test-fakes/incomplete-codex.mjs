// DETERMINISTIC FAKE - not Codex. A labeled stand-in for a `codex app-server`
// that reports a qualified version and then ends before it answers anything,
// so a session with it never completes. It never contacts a provider.
if (process.argv.includes("--version")) process.stdout.write("codex-cli 0.115.0\n");
process.exit(0);
