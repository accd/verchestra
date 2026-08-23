import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SUBSYSTEM_OBSERVATION_PATHS,
  WORKSPACE_ROOT_DIRNAME
} from "../../packages/domain/src/workspace-layout/subsystem-layout.ts";

// DDL-01 (#207): one inward contract names the workspace root dirname and all
// seven subsystem observation paths. Before it, the doctor and `vestra init`
// each carried their own literals and drifted — the doctor watched `.vestra/`
// while init wrote `.verchestra/`, and after that root was corrected every leaf
// path was still named nowhere else in the repository.

test("the contract names the directory init actually writes", () => {
  assert.equal(WORKSPACE_ROOT_DIRNAME, ".verchestra");
});

test("the contract names exactly the seven observed subsystems and their paths", () => {
  assert.deepEqual(SUBSYSTEM_OBSERVATION_PATHS, {
    "cedar-policy": "policy/active.bundle",
    "sqlite-durable-state": "runtime.db",
    "secret-presence": "secrets",
    driver: "drivers",
    connector: "connectors",
    probe: "probe/fixtures",
    sandbox: "sandbox"
  });
});

test("the catalog is closed at seven subsystems", () => {
  assert.equal(Object.keys(SUBSYSTEM_OBSERVATION_PATHS).length, 7);
});

test("the record is frozen, so no consumer can retarget a probe at runtime", () => {
  assert.equal(Object.isFrozen(SUBSYSTEM_OBSERVATION_PATHS), true);
  assert.throws(() => {
    "use strict";
    SUBSYSTEM_OBSERVATION_PATHS.sandbox = "elsewhere";
  }, TypeError);
  assert.equal(SUBSYSTEM_OBSERVATION_PATHS.sandbox, "sandbox");
});

// Every value is joined onto a control root by its consumer. A value that is
// absolute, or that escapes upward, would place a probe outside the workspace
// the contract exists to describe.
test("every path stays inside the workspace root when joined", () => {
  for (const [subsystem, path] of Object.entries(SUBSYSTEM_OBSERVATION_PATHS)) {
    assert.equal(path.startsWith("/"), false, `${subsystem} must be relative`);
    assert.equal(path.endsWith("/"), false, `${subsystem} must not be a directory reference`);
    assert.equal(path.includes("\\"), false, `${subsystem} must use POSIX separators`);
    assert.equal(/^[A-Za-z]:/u.test(path), false, `${subsystem} must not be a drive-qualified path`);
    assert.equal(
      path.split("/").some((segment) => segment.length === 0 || segment === "." || segment === ".."),
      false,
      `${subsystem} must not contain an empty, current, or parent segment`
    );
  }
});
