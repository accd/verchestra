const modeIndex = process.argv.indexOf("--mode");
process.exit(process.argv[modeIndex + 1] === "crash" ? 86 : 0);
