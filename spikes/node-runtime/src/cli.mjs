const VERSION = "0.0.0-qualification";

function releaseDigest() {
  return process.env.VERCHESTRA_RELEASE_DIGEST ?? "unsealed";
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

export async function run(args) {
  const json = args.includes("--output") && args[args.indexOf("--output") + 1] === "json";
  const commandArgs = args.filter((arg, index) => {
    if (arg === "--output") return false;
    if (index > 0 && args[index - 1] === "--output") return false;
    return true;
  });

  if (commandArgs.length === 0 || commandArgs.includes("--help")) {
    if (json) {
      writeJson({ product: "Verchestra", command: "vestra", alias: "verchestra", version: VERSION });
    } else {
      process.stdout.write("Verchestra\n\nUsage: vestra [--version] [--help] [--output json]\nAlias: verchestra\n");
    }
    return 0;
  }

  if (commandArgs.includes("--version")) {
    if (json) {
      writeJson({ product: "Verchestra", version: VERSION, releaseDigest: releaseDigest() });
    } else {
      process.stdout.write(`Verchestra ${VERSION} (${releaseDigest()})\n`);
    }
    return 0;
  }

  process.stderr.write(`VES_CLI_UNKNOWN_ARGUMENT: ${commandArgs.join(" ")}\n`);
  return 64;
}

