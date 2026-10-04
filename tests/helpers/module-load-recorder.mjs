// DETERMINISTIC PROBE - test support, preloaded with `--import`. Records the
// URL of every module the process loads whose path names the Strands SDK,
// Zod, or the MCP SDK, and writes the list to the file named by
// VERCHESTRA_LOAD_RECORD when the process exits. It changes no module.
import { writeFileSync } from "node:fs";
import { registerHooks } from "node:module";

const WATCHED =
  /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(@strands-agents|zod|@modelcontextprotocol)[\\/]/u;
const loaded = new Set();
const record = process.env.VERCHESTRA_LOAD_RECORD;

registerHooks({
  load(url, context, nextLoad) {
    const match = WATCHED.exec(url);
    if (match !== null) loaded.add(match[1]);
    return nextLoad(url, context);
  }
});

process.on("exit", () => {
  if (record !== undefined)
    writeFileSync(
      record,
      JSON.stringify([...loaded].sort((left, right) => Number(left > right) - Number(left < right)))
    );
});
