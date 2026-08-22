// The single authority for where a workspace keeps the subsystem state deep
// doctor observes (DDL-01, #207). Both sides of that observation read this
// record: `vestra init` provisions into it, and the doctor's read-only probes
// watch it.
//
// It exists because the two sides previously carried independent literals and
// drifted. The doctor watched `.vestra/` while init wrote `.verchestra/`; when
// that root was corrected, every leaf path below it was still named nowhere
// else in the repository, so a fully provisioned machine kept reporting the
// same subsystems as absent. One record plus a static agreement test
// (tests/architecture/doctor-workspace-root.test.mjs) makes that drift a gate
// rather than a convention.
//
// Values are POSIX-style paths relative to WORKSPACE_ROOT_DIRNAME. Domain takes
// no `node:` import, so joining them onto a control root is the caller's job.

export const WORKSPACE_ROOT_DIRNAME = ".verchestra" as const;

export const SUBSYSTEM_OBSERVATION_PATHS = Object.freeze({
  "cedar-policy": "policy/active.bundle",
  "sqlite-durable-state": "runtime.db",
  "secret-presence": "secrets",
  driver: "drivers",
  connector: "connectors",
  probe: "probe/fixtures",
  sandbox: "sandbox"
} as const);

export type SubsystemId = keyof typeof SUBSYSTEM_OBSERVATION_PATHS;
