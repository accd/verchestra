if (process.argv.includes("--version")) {
  process.stdout.write(`${process.env.FAKE_OPENCODE_VERSION ?? "1.17.18"}\n`);
  process.exit(0);
}
process.exit(2);
