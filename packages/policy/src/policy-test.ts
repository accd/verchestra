// Policies are code that governs everything else, yet nothing could test them
// declaratively. This runner evaluates principal/action/resource/expected
// cases through the same CedarPolicyAdapter path production uses - never a
// parallel evaluator - so a passing case measures real behavior, including the
// diagnostic-deny paths.

import type { CedarPolicyAdapter, PolicyView } from "./cedar-policy.ts";

export type PolicyTestErrorCode = "VES_POLICY_TEST_INVALID";

export class PolicyTestError extends Error {
  readonly code: PolicyTestErrorCode;

  constructor(code: PolicyTestErrorCode, message: string) {
    super(message);
    this.name = "PolicyTestError";
    this.code = code;
  }
}

function fail(message: string): never {
  throw new PolicyTestError("VES_POLICY_TEST_INVALID", message);
}

export interface PolicyTestCase {
  readonly name: string;
  readonly principal: { readonly type: string; readonly id: string };
  readonly action: { readonly type: string; readonly id: string };
  readonly resource: { readonly type: string; readonly id: string };
  readonly context?: Readonly<Record<string, unknown>>;
  readonly expect: "allow" | "deny";
  readonly expectCode?: string;
}

export interface PolicyTestCaseResult {
  readonly name: string;
  readonly expected: "allow" | "deny";
  readonly actual: "allow" | "deny";
  readonly code: string;
  readonly passed: boolean;
}

export interface PolicyTestReport {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly results: readonly PolicyTestCaseResult[];
}

const NAME = /^[\x20-\x7e]{1,120}$/u;
const ENTITY_KEYS = ["type", "id"] as const;

function entity(value: unknown, label: string): { readonly type: string; readonly id: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !(ENTITY_KEYS as readonly string[]).includes(key)))
    fail(`${label} contains unknown fields`);
  if (typeof row["type"] !== "string" || row["type"].length === 0) fail(`${label}.type is invalid`);
  if (typeof row["id"] !== "string" || row["id"].length === 0) fail(`${label}.id is invalid`);
  return Object.freeze({ type: row["type"], id: row["id"] });
}

export function normalizePolicyTestCase(value: unknown): PolicyTestCase {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("test case must be an object");
  const row = value as Record<string, unknown>;
  const allowed = ["name", "principal", "action", "resource", "context", "expect", "expectCode"];
  const extras = Object.keys(row).filter((key) => !allowed.includes(key));
  if (extras.length > 0) fail(`test case contains unknown fields: ${extras.sort().join(", ")}`);
  if (typeof row["name"] !== "string" || !NAME.test(row["name"])) fail("test case name is invalid");
  // "expect" is a closed literal on purpose: a typo like "alow" must fail the
  // case format, never silently read as deny-and-pass.
  if (row["expect"] !== "allow" && row["expect"] !== "deny")
    fail(`case ${row["name"]}: expect must be "allow" or "deny"`);
  if (
    row["expectCode"] !== undefined &&
    (typeof row["expectCode"] !== "string" || !/^VES_[A-Z0-9_]+$/u.test(row["expectCode"]))
  )
    fail(`case ${row["name"]}: expectCode must be a VES_ error code`);
  if (
    row["context"] !== undefined &&
    (row["context"] === null || typeof row["context"] !== "object" || Array.isArray(row["context"]))
  )
    fail(`case ${row["name"]}: context must be an object`);
  return Object.freeze({
    name: row["name"],
    principal: entity(row["principal"], `case ${row["name"]}: principal`),
    action: entity(row["action"], `case ${row["name"]}: action`),
    resource: entity(row["resource"], `case ${row["name"]}: resource`),
    ...(row["context"] === undefined ? {} : { context: Object.freeze({ ...(row["context"] as object) }) }),
    expect: row["expect"],
    ...(row["expectCode"] === undefined ? {} : { expectCode: row["expectCode"] })
  });
}

export function runPolicyTestCases(
  caseValues: readonly unknown[],
  options: { readonly adapter: CedarPolicyAdapter; readonly view: PolicyView; readonly entities?: readonly unknown[] }
): PolicyTestReport {
  if (!Array.isArray(caseValues) || caseValues.length === 0)
    fail("at least one policy test case is required; an empty suite proves nothing");
  const cases = caseValues.map(normalizePolicyTestCase);
  const names = new Set<string>();
  for (const testCase of cases) {
    if (names.has(testCase.name)) fail(`duplicate case name: ${testCase.name}`);
    names.add(testCase.name);
  }
  const results = cases.map((testCase) => {
    const decision = options.adapter.authorize({
      view: options.view,
      request: {
        principal: testCase.principal,
        action: testCase.action,
        resource: testCase.resource,
        context: testCase.context ?? {}
      },
      ...(options.entities === undefined ? {} : { entities: options.entities })
    });
    const passed =
      decision.decision === testCase.expect &&
      (testCase.expectCode === undefined || decision.code === testCase.expectCode);
    return Object.freeze({
      name: testCase.name,
      expected: testCase.expect,
      actual: decision.decision,
      code: decision.code,
      passed
    });
  });
  const passed = results.filter((result) => result.passed).length;
  return Object.freeze({
    total: results.length,
    passed,
    failed: results.length - passed,
    results: Object.freeze(results)
  });
}
