#!/usr/bin/env node
// Published bin shim. It resolves only compiled JavaScript that travels in the
// same tarball; it never reaches a workspace package or a TypeScript source.
import { runBootstrap } from "../lib/bootstrap.js";

process.exitCode = await runBootstrap(process.argv.slice(2));
