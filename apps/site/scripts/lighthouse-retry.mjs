// invariant: Lighthouse is retried once only for the Windows failure where its
// own cleanup of a `lighthouse.*` temporary directory is denied while another
// process still holds a handle. Any other failure, on any platform, is final.
// why: the directory is recognised by Lighthouse's own name for it, not by the
// location of the system temporary directory, which this script never uses.
const CLEANUP_DENIED = /Runtime error encountered: EPERM, Permission denied: [^\n]*[\\/]lighthouse\.[^\\/\s]+/u;

export function isTransientWindowsCleanupFailure(output, platform = process.platform) {
  return platform === "win32" && CLEANUP_DENIED.test(output);
}
