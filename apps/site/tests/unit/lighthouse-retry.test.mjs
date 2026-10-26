import assert from "node:assert/strict";
import test from "node:test";

import { isTransientWindowsCleanupFailure } from "../../scripts/lighthouse-retry.mjs";

const DENIED =
  "Runtime error encountered: EPERM, Permission denied: C:\\Users\\runneradmin\\AppData\\Local\\Temp\\lighthouse.36589126";

test("retries only the Windows cleanup denial on Lighthouse's own temporary directory", () => {
  assert.equal(isTransientWindowsCleanupFailure(`audit output\n${DENIED}\n`, "win32"), true);
  // The system temporary directory's location is irrelevant; the name is not.
  assert.equal(
    isTransientWindowsCleanupFailure(
      "Runtime error encountered: EPERM, Permission denied: D:\\a\\_temp\\lighthouse.1234",
      "win32"
    ),
    true
  );
});

test("every other failure is final", () => {
  assert.equal(isTransientWindowsCleanupFailure(DENIED, "linux"), false, "Windows only");
  assert.equal(isTransientWindowsCleanupFailure("Assertion failed: performance score 0.82 < 0.9", "win32"), false);
  assert.equal(
    isTransientWindowsCleanupFailure(
      "Runtime error encountered: EPERM, Permission denied: C:\\Users\\runneradmin\\project\\report.html",
      "win32"
    ),
    false,
    "a denial on any other path is not the cleanup race"
  );
  assert.equal(
    isTransientWindowsCleanupFailure("Runtime error encountered: ENOENT: C:\\Temp\\lighthouse.36589126", "win32"),
    false,
    "only a permission denial is transient"
  );
});
