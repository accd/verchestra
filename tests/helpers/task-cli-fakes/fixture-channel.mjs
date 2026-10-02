// DETERMINISTIC FAKE support - the fixture channel shared by the labeled fake
// provider CLIs in this directory. It never contacts a provider.
import { appendFileSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

// why: the e2e fixture's wrapper names its private log directory and its fake
// keychain store ahead of the provider arguments; neither comes from an
// ambient temp directory, and neither is part of the observed invocation.
const fixture = {};
let remaining = process.argv.slice(2);
while (remaining[0]?.startsWith("--fixture-")) {
  fixture[remaining[0]] = remaining[1];
  remaining = remaining.slice(2);
}
export const providerArguments = remaining;

// hazard: a named path must resolve inside the private temp directory the
// fixture gave this child, so an argument can never aim a read or write
// elsewhere.
function insideTemp(path) {
  const base = `${realpathSync(tmpdir())}${sep}`;
  const target = resolve(realpathSync(dirname(path)), basename(path));
  if (!target.startsWith(base)) throw new Error("fixture path is outside the child temp directory");
  return target;
}

export function fixtureLog(name) {
  return (entry) => {
    if (fixture["--fixture-log"] !== undefined)
      appendFileSync(insideTemp(join(fixture["--fixture-log"], name)), `${JSON.stringify(entry)}\n`);
  };
}

// why: a test steers a fake between two runs of one request by leaving, or
// removing, an empty file of this name in the fixture's private log directory.
export function fixtureFlag(name) {
  return fixture["--fixture-log"] !== undefined && existsSync(insideTemp(join(fixture["--fixture-log"], name)));
}

// why: the observation proves which credential the child received as a
// boolean against the fixture's own keychain store; it never records or
// digests the value.
export function credentialMatchesStore(name, received) {
  if (fixture["--fixture-store"] === undefined || received === undefined) return false;
  const { items } = JSON.parse(readFileSync(insideTemp(fixture["--fixture-store"]), "utf8"));
  return Object.entries(items).some(([key, value]) => key.endsWith(`|${name}`) && value === received);
}
