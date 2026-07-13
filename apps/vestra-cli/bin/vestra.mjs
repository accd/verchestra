#!/usr/bin/env node
import { main } from "../src/main.ts";

process.exitCode = await main("vestra", process.argv.slice(2));
