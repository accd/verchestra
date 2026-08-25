import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DOCTOR_CAPABILITY_IDS,
  DOCTOR_CHECK_IDS,
  DOCTOR_REMEDIATION_CODES,
  DOCTOR_REPORT_FIELDS,
  assertDoctorCheckFacts,
  assertDoctorReportPayload,
  buildDoctorReport,
  doctorExitCode
} from "../../packages/application/src/index.ts";

const anyRemediation = DOCTOR_REMEDIATION_CODES[0];

function pass(checkId) {
  return { checkId, status: "pass", capabilityId: DOCTOR_CAPABILITY_IDS[checkId] };
}

function allPass() {
  return DOCTOR_CHECK_IDS.map((checkId) => pass(checkId));
}

// Replace the first check with an override, keeping the rest passing.
function withFirst(override) {
  const facts = allPass();
  facts[0] = { ...facts[0], ...override };
  return facts;
}

test("the doctor check catalog is closed and exactly twelve ids", () => {
  assert.equal(DOCTOR_CHECK_IDS.length, 12);
  assert.equal(new Set(DOCTOR_CHECK_IDS).size, 12);
  for (const checkId of DOCTOR_CHECK_IDS) assert.ok(DOCTOR_CAPABILITY_IDS[checkId], `${checkId} has a capability`);
});

test("a complete all-pass catalog produces a PASS report and exit 0", () => {
  const report = buildDoctorReport(allPass(), 42);
  assert.equal(report["doctor.verdict"], "PASS");
  assert.deepEqual(report["doctor.failure_codes"], []);
  assert.deepEqual(report["doctor.blocked_capabilities"], []);
  assert.deepEqual(report["doctor.remediation_codes"], []);
  assert.equal(report["doctor.duration_ms"], 42);
  assert.equal(report["doctor.check_codes"].length, 12);
  assert.equal(doctorExitCode(report["doctor.verdict"]), 0);
});

test("check codes are sorted checkId:status pairs", () => {
  const codes = buildDoctorReport(allPass(), 1)["doctor.check_codes"];
  assert.deepEqual(
    [...codes],
    [...codes].sort((a, b) => a.localeCompare(b))
  );
  assert.ok(codes.every((code) => /^doctor\.[a-z-]+:pass$/u.test(code)));
});

test("a missing check fails the catalog closed", () => {
  assert.throws(() => buildDoctorReport(allPass().slice(1), 1), { code: "VES_DOCTOR_CHECK_CATALOG_INVALID" });
});

// CJ4-05/CJ4-07: the sealed report's code lists are byte-identical regardless
// of the machine's ambient locale.
test("the sealed report's code lists are byte-identical under two different ambient locales", () => {
  const priorLang = process.env.LANG;
  const priorLcAll = process.env.LC_ALL;
  try {
    process.env.LANG = "en_US.UTF-8";
    process.env.LC_ALL = "en_US.UTF-8";
    const first = buildDoctorReport(allPass(), 1);
    process.env.LANG = "fr_FR.UTF-8";
    process.env.LC_ALL = "fr_FR.UTF-8";
    const second = buildDoctorReport(allPass(), 1);
    assert.deepEqual(first["doctor.check_codes"], second["doctor.check_codes"]);
  } finally {
    if (priorLang === undefined) delete process.env.LANG;
    else process.env.LANG = priorLang;
    if (priorLcAll === undefined) delete process.env.LC_ALL;
    else process.env.LC_ALL = priorLcAll;
  }
});

test("an unknown check id fails the catalog closed", () => {
  assert.throws(() => assertDoctorCheckFacts(withFirst({ checkId: "doctor.unknown" })), {
    code: "VES_DOCTOR_CHECK_CATALOG_INVALID"
  });
});

test("a duplicated check id fails the catalog closed", () => {
  const facts = allPass();
  facts.push(facts[0]);
  assert.throws(() => assertDoctorCheckFacts(facts), { code: "VES_DOCTOR_CHECK_CATALOG_INVALID" });
});

test("a malformed fact fails closed", () => {
  const facts = allPass();
  facts[0] = null;
  assert.throws(() => assertDoctorCheckFacts(facts), { code: "VES_DOCTOR_CHECK_FACT_INVALID" });
});

test("an invalid status fails closed", () => {
  assert.throws(() => assertDoctorCheckFacts(withFirst({ status: "degraded" })), {
    code: "VES_DOCTOR_CHECK_FACT_INVALID"
  });
});

test("a mismatched capability fails closed", () => {
  assert.throws(() => assertDoctorCheckFacts(withFirst({ capabilityId: "some.other" })), {
    code: "VES_DOCTOR_CHECK_FACT_INVALID"
  });
});

test("a passing check carrying a remediation fails closed", () => {
  assert.throws(() => assertDoctorCheckFacts(withFirst({ remediationCode: anyRemediation })), {
    code: "VES_DOCTOR_CHECK_FACT_INVALID"
  });
});

test("a failing check without a remediation fails closed", () => {
  assert.throws(() => assertDoctorCheckFacts(withFirst({ status: "fail" })), {
    code: "VES_DOCTOR_REMEDIATION_MISSING"
  });
});

test("a blocked check without a remediation fails closed", () => {
  assert.throws(() => assertDoctorCheckFacts(withFirst({ status: "blocked" })), {
    code: "VES_DOCTOR_REMEDIATION_MISSING"
  });
});

test("a check naming an unregistered remediation fails closed", () => {
  assert.throws(() => assertDoctorCheckFacts(withFirst({ status: "fail", remediationCode: "just-fix-it" })), {
    code: "VES_DOCTOR_REMEDIATION_UNKNOWN"
  });
});

test("a raw-prose remediation cannot smuggle a path or secret", () => {
  assert.throws(() => assertDoctorCheckFacts(withFirst({ status: "fail", remediationCode: "C:\\Users\\me\\secret" })), {
    code: "VES_DOCTOR_REMEDIATION_UNKNOWN"
  });
});

test("a single failing check makes the verdict FAIL and exit 1", () => {
  const report = buildDoctorReport(withFirst({ status: "fail", remediationCode: "reinstall-cli" }), 5);
  assert.equal(report["doctor.verdict"], "FAIL");
  assert.deepEqual(report["doctor.failure_codes"], ["reinstall-cli"]);
  assert.equal(doctorExitCode(report["doctor.verdict"]), 1);
});

test("a blocked check with no failures makes the verdict BLOCKED and exit 4", () => {
  const report = buildDoctorReport(withFirst({ status: "blocked", remediationCode: "install-git" }), 5);
  assert.equal(report["doctor.verdict"], "BLOCKED");
  assert.deepEqual(report["doctor.blocked_capabilities"], [DOCTOR_CAPABILITY_IDS["doctor.installation"]]);
  assert.deepEqual(report["doctor.remediation_codes"], ["install-git"]);
  assert.equal(doctorExitCode(report["doctor.verdict"]), 4);
});

test("failure dominates blocked in the verdict", () => {
  const facts = allPass();
  facts[0] = { ...facts[0], status: "fail", remediationCode: "reinstall-cli" };
  facts[1] = { ...facts[1], status: "blocked", remediationCode: "regenerate-contracts" };
  const report = buildDoctorReport(facts, 9);
  assert.equal(report["doctor.verdict"], "FAIL");
  assert.deepEqual(report["doctor.remediation_codes"], ["regenerate-contracts", "reinstall-cli"]);
});

test("a negative or non-integer duration fails closed", () => {
  assert.throws(() => buildDoctorReport(allPass(), -1), { code: "VES_DOCTOR_CHECK_FACT_INVALID" });
  assert.throws(() => buildDoctorReport(allPass(), 1.5), { code: "VES_DOCTOR_CHECK_FACT_INVALID" });
});

test("the report allowlist rejects an unknown field", () => {
  const report = buildDoctorReport(allPass(), 1);
  assert.throws(() => assertDoctorReportPayload({ ...report, "doctor.extra": "x" }), {
    code: "VES_DOCTOR_REPORT_FIELD_UNKNOWN"
  });
});

test("the report allowlist rejects a missing field", () => {
  const report = { ...buildDoctorReport(allPass(), 1) };
  delete report["doctor.duration_ms"];
  assert.throws(() => assertDoctorReportPayload(report), { code: "VES_DOCTOR_REPORT_FIELD_UNKNOWN" });
});

test("a prohibited content value is rejected before sealing", () => {
  const report = buildDoctorReport(allPass(), 1);
  assert.throws(() => assertDoctorReportPayload({ ...report, "doctor.failure_codes": ["/home/user/.secret"] }), {
    code: "VES_DOCTOR_REPORT_CONTENT_PROHIBITED"
  });
});

test("an out-of-range verdict is rejected", () => {
  const report = buildDoctorReport(allPass(), 1);
  assert.throws(() => assertDoctorReportPayload({ ...report, "doctor.verdict": "DEGRADED" }), {
    code: "VES_DOCTOR_REPORT_CONTENT_PROHIBITED"
  });
});

test("the report fields are exactly the six-field allowlist", () => {
  assert.deepEqual([...DOCTOR_REPORT_FIELDS].sort(), Object.keys(buildDoctorReport(allPass(), 1)).sort());
});

// VES-TST-008 / DOC-03: "WHEN a check observes a missing or unhealthy subsystem
// THEN the report SHALL name the exact blocked capability id and a registered
// remediation code, and SHALL never carry a raw error message, secret, or
// machine-local path."
//
// "Exact" is per check, so it is asserted for the whole catalog rather than for
// one representative: an operator told `state.durable` is blocked when the
// unhealthy subsystem was Git has been told the wrong thing, and the report
// carries no prose that could correct it.
test("VES-TST-008: every unhealthy subsystem names its own capability and a registered remediation", () => {
  for (const [index, checkId] of DOCTOR_CHECK_IDS.entries()) {
    for (const status of ["blocked", "fail"]) {
      const facts = allPass();
      facts[index] = { ...facts[index], status, remediationCode: "install-git" };
      const report = buildDoctorReport(facts, 3);
      assert.equal(report["doctor.verdict"], status === "fail" ? "FAIL" : "BLOCKED", checkId);
      assert.deepEqual(report["doctor.remediation_codes"], ["install-git"], checkId);
      assert.deepEqual(
        report["doctor.blocked_capabilities"],
        status === "blocked" ? [DOCTOR_CAPABILITY_IDS[checkId]] : [],
        checkId
      );
    }
  }
});

// A capability borrowed from another check is the case the report's own
// allowlist cannot catch: it is a registered, well-formed id, so only the exact
// per-check binding rejects it. Without that binding a blocked subsystem could
// be reported under a healthy one's capability and still seal.
test("VES-TST-008: a check naming another check's registered capability fails closed", () => {
  for (const [index, checkId] of DOCTOR_CHECK_IDS.entries()) {
    const borrowed = DOCTOR_CAPABILITY_IDS[DOCTOR_CHECK_IDS[(index + 1) % DOCTOR_CHECK_IDS.length]];
    assert.notEqual(borrowed, DOCTOR_CAPABILITY_IDS[checkId]);
    const facts = allPass();
    facts[index] = { ...facts[index], status: "blocked", remediationCode: "install-git", capabilityId: borrowed };
    assert.throws(() => buildDoctorReport(facts, 3), { code: "VES_DOCTOR_CHECK_FACT_INVALID" }, checkId);
  }
});

// The other half of DOC-03: neither channel a non-passing check writes to can
// carry raw text. The remediation channel is closed by the registry, and the
// capability channel is closed by the sealing allowlist.
test("VES-TST-008: neither the remediation nor the capability channel can carry a raw error or path", () => {
  for (const raw of [
    "ENOENT: no such file or directory, open '/home/user/.vestra/state.db'",
    "C:\\Users\\me\\AppData\\Local\\vestra",
    "token=sk-live-0123456789"
  ]) {
    assert.throws(
      () => assertDoctorCheckFacts(withFirst({ status: "blocked", remediationCode: raw })),
      { code: "VES_DOCTOR_REMEDIATION_UNKNOWN" },
      raw
    );
    const report = buildDoctorReport(allPass(), 1);
    assert.throws(
      () => assertDoctorReportPayload({ ...report, "doctor.blocked_capabilities": [raw] }),
      { code: "VES_DOCTOR_REPORT_CONTENT_PROHIBITED" },
      raw
    );
  }
});
