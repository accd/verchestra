#!/usr/bin/env node
import { main } from "../src/main.ts";

process.exitCode = await main("verchestra", process.argv.slice(2));
