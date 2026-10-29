#!/usr/bin/env node

import { checkRepository, repositoryWarnings } from "./agent-readiness.mjs";

const errors = await checkRepository();
// A warning names what a human still owes (today: an unsigned exit record). It
// is printed on every run and never turns a failing check into a pass.
for (const warning of await repositoryWarnings()) process.stderr.write(`agent:check warning: ${warning}\n`);
if (errors.length > 0) {
  for (const error of errors) process.stderr.write(`agent:check ${error}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("agent:check PASS\n");
}
