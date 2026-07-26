#!/usr/bin/env node

import { checkRepository } from "./agent-readiness.mjs";

const errors = await checkRepository();
if (errors.length > 0) {
  for (const error of errors) process.stderr.write(`agent:check ${error}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("agent:check PASS\n");
}
