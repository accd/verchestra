// The read-only observation port for deep doctor. Application owns the port and
// the pure probe -> fact mapping; the CLI composition root supplies real,
// read-only probes (AD-010). A probe reports only presence and health as
// booleans, never a value, path, or error string, so nothing a check observes
// can leak into the sealed report.

import {
  DOCTOR_CAPABILITY_IDS,
  DOCTOR_CHECK_IDS,
  type DoctorCheckFact,
  type DoctorCheckId,
  type DoctorRemediationCode
} from "./doctor.ts";

export interface DoctorObservation {
  readonly present: boolean;
  readonly healthy: boolean;
}

// A probe may observe synchronously or asynchronously (DDL-04, #207 — a live
// subsystem observation such as opening a database read-only cannot complete
// synchronously). `collectDoctorFacts` awaits each one in turn.
export type DoctorSubsystemProbe = () => DoctorObservation | Promise<DoctorObservation>;

export type DoctorProbeSet = Readonly<Record<DoctorCheckId, DoctorSubsystemProbe>>;

// The registered remediation each check names when it is not passing.
export const DOCTOR_REMEDIATION_BY_CHECK: Readonly<Record<DoctorCheckId, DoctorRemediationCode>> = Object.freeze({
  "doctor.installation": "reinstall-cli",
  "doctor.contract-schema": "regenerate-contracts",
  "doctor.cedar-policy": "provision-policy-bundle",
  "doctor.sqlite-durable-state": "initialize-runtime-store",
  "doctor.native-asset": "restore-native-asset",
  "doctor.git": "install-git",
  "doctor.secret-presence": "configure-secret",
  "doctor.clock": "correct-system-clock",
  "doctor.driver": "install-driver",
  "doctor.connector": "configure-connector",
  "doctor.probe": "provision-probe-fixture",
  "doctor.sandbox": "enable-sandbox"
});

// A probe that neither settles nor rejects within this bound is treated as
// present-but-unhealthy (DDL-04) — the sentinel bracket around fact
// collection (doctor-composition.ts) must close deterministically, so a
// diagnostic can never hang on one broken observer.
export const DOCTOR_PROBE_TIMEOUT_MS = 5_000;

function observeToFact(checkId: DoctorCheckId, observation: DoctorObservation): DoctorCheckFact {
  const capabilityId = DOCTOR_CAPABILITY_IDS[checkId];
  if (observation.present && observation.healthy) return { checkId, status: "pass", capabilityId };
  // Absent subsystem -> blocked (the capability cannot run until provisioned);
  // present but unhealthy -> fail (it is there and wrong).
  return {
    checkId,
    status: observation.present ? "fail" : "blocked",
    capabilityId,
    remediationCode: DOCTOR_REMEDIATION_BY_CHECK[checkId]
  };
}

function withTimeout(observation: DoctorObservation | Promise<DoctorObservation>): Promise<DoctorObservation> {
  // A synchronous probe cannot hang, so it needs no timer race — every
  // synchronous check (currently 5 of 12) skips this entirely.
  if (!(observation instanceof Promise)) return Promise.resolve(observation);
  return new Promise((resolveObservation, rejectObservation) => {
    const timer = setTimeout(() => rejectObservation(new Error("doctor probe timed out")), DOCTOR_PROBE_TIMEOUT_MS);
    observation.then(
      (value) => {
        clearTimeout(timer);
        resolveObservation(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        rejectObservation(error);
      }
    );
  });
}

// Runs each registered read-only probe, in order, and returns exactly one
// fact per check. Sequential, not concurrent (DDL-05): the doctor composition
// root brackets this call between two sentinel captures to prove nothing
// changed during the diagnostic, and a well-defined serial interval is what
// makes that bracket meaningful — concurrent probes would make a detected
// mutation unattributable to any one probe's window. A probe that throws,
// rejects, or exceeds DOCTOR_PROBE_TIMEOUT_MS is recorded as a
// present-but-unhealthy subsystem (fail) with no error text, so a broken or
// hanging observer degrades to a stable code instead of crashing or stalling
// the diagnostic.
export async function collectDoctorFacts(probes: DoctorProbeSet): Promise<DoctorCheckFact[]> {
  const facts: DoctorCheckFact[] = [];
  for (const checkId of DOCTOR_CHECK_IDS) {
    try {
      const observation = await withTimeout(probes[checkId]());
      facts.push(observeToFact(checkId, observation));
    } catch {
      facts.push(observeToFact(checkId, { present: true, healthy: false }));
    }
  }
  return facts;
}
