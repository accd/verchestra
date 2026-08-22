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

// Runs each registered read-only probe and returns exactly one fact per check.
// A probe that throws is recorded as a present-but-unhealthy subsystem (fail)
// with no error text, so a broken observer degrades to a stable code instead of
// crashing the diagnostic or leaking a message.
export async function collectDoctorFacts(probes: DoctorProbeSet): Promise<DoctorCheckFact[]> {
  const facts: DoctorCheckFact[] = [];
  for (const checkId of DOCTOR_CHECK_IDS) {
    try {
      facts.push(observeToFact(checkId, await probes[checkId]()));
    } catch {
      facts.push(observeToFact(checkId, { present: true, healthy: false }));
    }
  }
  return facts;
}
