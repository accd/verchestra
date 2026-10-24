#!/usr/bin/env node
// Published bin shim. It resolves only compiled JavaScript that travels in the
// same tarball; it never reaches a workspace package or a TypeScript source.
//
// why: the bundle targets the Node the package declares (engines >=24.14.0),
// and npm only warns on a lower one, so the shim refuses it before it loads the
// bundle: an older Node would otherwise fail inside it with no public code.
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 24 || (major === 24 && minor < 14)) {
  process.stderr.write(
    `VES_VESTRA_HOST_UNSUPPORTED: this release needs Node 24.14.0 or later, not ${process.versions.node}. ` +
      "Install Node 24.14.0 or later and run vestra again.\n"
  );
  process.exitCode = 64;
} else {
  const { runBootstrap } = await import("../lib/bootstrap.js");
  process.exitCode = await runBootstrap(process.argv.slice(2));
}
