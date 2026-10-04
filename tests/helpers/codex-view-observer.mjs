// DETERMINISTIC FAKE support - not Codex. Started in place of the spike's fake
// Codex app server, it records what a Codex node's session can reach from its
// working directory (each entry's path, kind, write permission, and a file's
// text) in the directory FAKE_CODEX_OBSERVATIONS names, and then runs that
// fake. It never contacts a provider.
import { lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";

const byText = (left, right) => Number(left > right) - Number(left < right);

function kind(metadata) {
  if (metadata.isSymbolicLink()) return "link";
  return metadata.isDirectory() ? "directory" : "file";
}

if (!process.argv.includes("--version")) {
  const root = process.cwd();
  const entries = [".", ...readdirSync(root, { recursive: true }).map(String).sort(byText)].map((path) => {
    const absolute = join(root, path);
    const metadata = lstatSync(absolute);
    return {
      path: path.split(sep).join("/"),
      kind: kind(metadata),
      writable: (metadata.mode & 0o222) !== 0,
      ...(metadata.isFile() ? { text: readFileSync(absolute, "utf8") } : {})
    };
  });
  writeFileSync(
    join(process.env.FAKE_CODEX_OBSERVATIONS, `codex-view-${process.pid}.json`),
    JSON.stringify({ cwd: root, entries })
  );
}
await import("../../spikes/codex-driver/test/fake-codex-app-server.mjs");
