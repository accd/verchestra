// why: decisions D3, D3b, and D9 (SSI-51..53). A coordinated run spends only
// what the owner's subscriptions include. No local read of a provider's paid
// usage setting exists, so the run requires the owner's own statement that it
// is off: a machine-local `task-billing.json` beside `task-providers.json`,
// written by the owner after checking the account, never by Verchestra and
// never by a Task Request. The statement has no expiry; it names what the run
// can verify (the provider and its authentication method) and the regime it
// was made under, so a change of either asks for it again.
import { join } from "node:path";

import type { NormalizedTaskRequestV2 } from "@verchestra/application";
import { PublicErrorException } from "@verchestra/domain";

import { readMachineSetting, type ProviderAuth } from "../task-provider-auth.ts";
import { notConfigured } from "./task-errors.ts";

export const BILLING_FILE = "task-billing.json";

const REQUIREMENT = "extra-usage-confirmation";

export type BillingProvider = "claude-code" | "codex";

// invariant: the authentication method each provider's statement must name,
// which is the one its session proves at run time: Claude Code's
// `apiKeySource` is `none` on a subscription login (SSI-54), and Codex's
// `account/read` reports a `chatgpt` account (SSI-55).
export const BILLING_METHODS: Readonly<Record<BillingProvider, string>> = Object.freeze({
  "claude-code": "subscription",
  codex: "chatgpt"
});

// invariant: decision D9. The billing regime each statement speaks for began at
// this instant: for Claude Code, the plan-usage page updated 2026-06-16 that
// paused the Agent SDK change; for Codex, the pricing page read on 2026-10-03
// (`research.md` F7, S15). A statement made before its provider's regime began
// is about an earlier one and is refused, so moving an instant here in a build
// that follows a regime change asks every owner to confirm again.
export const BILLING_REGIMES: Readonly<Record<BillingProvider, string>> = Object.freeze({
  "claude-code": "2026-06-16T00:00:00.000Z",
  codex: "2026-10-03T00:00:00.000Z"
});

// invariant: SSI-53. Every member is a closed value or a bounded grammar, so no
// token, account identifier, e-mail address, personal name, or path can be
// stored in a statement this reader accepts.
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;
const PLAN_TYPE = /^[a-z][a-z0-9_]{0,31}$/u;
const MEMBERS: Readonly<Record<BillingProvider, readonly string[]>> = Object.freeze({
  "claude-code": Object.freeze(["auth", "extraUsage", "confirmedAt"]),
  codex: Object.freeze(["auth", "planType", "extraUsage", "confirmedAt"])
});

export interface ExtraUsageConfirmation {
  readonly provider: BillingProvider;
  readonly auth: string;
  readonly planType?: string;
  readonly confirmedAt: string;
}

type Row = Readonly<Record<string, unknown>>;

function refused(message: string): never {
  throw notConfigured(REQUIREMENT, message);
}

function exactRow(value: unknown, label: string, members: readonly string[]): Row {
  if (value === null || typeof value !== "object" || Array.isArray(value)) refused(`${label} is not an object`);
  const row = value as Row;
  if (Object.keys(row).some((key) => !members.includes(key))) refused(`${label} has a member it may not hold`);
  return row;
}

function confirmedAt(value: unknown, provider: BillingProvider, now: Date): string {
  const at = typeof value === "string" && INSTANT.test(value) ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(at)) refused(`The ${provider} confirmation time is not a UTC instant`);
  // why: a statement cannot be dated after the clock that reads it, and one
  // dated ahead would outlive the next regime change.
  if (at > now.getTime()) refused(`The ${provider} confirmation is dated in the future`);
  if (at < Date.parse(BILLING_REGIMES[provider]))
    refused(`The ${provider} confirmation predates its current billing regime; confirm again`);
  return value as string;
}

function confirmation(value: unknown, provider: BillingProvider, now: Date): ExtraUsageConfirmation {
  const label = `The ${provider} confirmation`;
  const row = exactRow(value, label, MEMBERS[provider]);
  if (row["auth"] !== BILLING_METHODS[provider])
    refused(`${label} names another authentication method than the one the run uses`);
  if (row["extraUsage"] !== "disabled") refused(`${label} does not state that extra usage is disabled`);
  const at = confirmedAt(row["confirmedAt"], provider, now);
  if (provider === "claude-code") return Object.freeze({ provider, auth: BILLING_METHODS[provider], confirmedAt: at });
  const planType = row["planType"];
  if (typeof planType !== "string" || !PLAN_TYPE.test(planType)) refused(`${label} names no plan type`);
  return Object.freeze({ provider, auth: BILLING_METHODS[provider], planType, confirmedAt: at });
}

// invariant: the one reader of the statement. A provider the run uses must
// have an entry of exactly the closed shape; anything else is `not
// configured`, never guessed or defaulted.
export function normalizeExtraUsageConfirmations(
  value: unknown,
  providers: readonly BillingProvider[],
  now: Date
): readonly ExtraUsageConfirmation[] {
  const row = exactRow(value, "The extra-usage confirmation", ["schemaVersion", "providers"]);
  if (row["schemaVersion"] !== 1) refused("The extra-usage confirmation schemaVersion must be 1");
  const entries = exactRow(row["providers"], "providers", Object.keys(BILLING_METHODS));
  return Object.freeze(
    providers.map((provider) => {
      if (!Object.hasOwn(entries, provider)) refused(`No extra-usage confirmation names ${provider}`);
      return confirmation(entries[provider], provider, now);
    })
  );
}

// invariant: the providers a coordinated run uses: every node's driver and the
// independent Codex verifier.
export function billingProviders(request: NormalizedTaskRequestV2): readonly BillingProvider[] {
  const used = new Set<string>(request.execution.nodes.map((node) => node.driver.driverId));
  used.add(request.verifier.driverId);
  return (["claude-code", "codex"] as const).filter((provider) => used.has(provider));
}

function entryTemplate(provider: BillingProvider): string {
  const plan = provider === "codex" ? ', "planType": "<your ChatGPT plan, e.g. plus>"' : "";
  return `"${provider}": { "auth": "${BILLING_METHODS[provider]}"${plan}, "extraUsage": "disabled", "confirmedAt": "<UTC time of your check>" }`;
}

// why: the owner is told the one step that provisions the requirement. The
// path is machine-local, so it is shown on the terminal only, never in a
// public error or a record.
function explain(workspaceRoot: string, providers: readonly BillingProvider[], stderr: (value: string) => void) {
  const entries = providers.map((provider) => `    ${entryTemplate(provider)}`).join(",\n");
  stderr(
    "A coordinated run needs your statement that paid usage beyond your plan is turned off for each provider it uses.\n" +
      "Only after checking each account's usage settings, write this file:\n" +
      `  ${join(workspaceRoot, BILLING_FILE)}\n` +
      `{\n  "schemaVersion": 1,\n  "providers": {\n${entries}\n  }\n}\n`
  );
}

export interface SubscriptionPreflight {
  readonly workspaceRoot: string;
  readonly auth: ProviderAuth;
  readonly request: NormalizedTaskRequestV2;
  readonly stderr: (value: string) => void;
  readonly now?: () => Date;
}

function requireSubscriptionAuth(auth: ProviderAuth): void {
  if (auth.implementer !== "subscription" || auth.verifier !== "subscription")
    throw notConfigured("coordinated-run-subscription", "A coordinated run uses subscription authentication only");
}

async function requireConfirmations(
  preflight: Omit<SubscriptionPreflight, "stderr">,
  providers: readonly BillingProvider[]
): Promise<void> {
  const stored = await readMachineSetting(
    join(preflight.workspaceRoot, BILLING_FILE),
    REQUIREMENT,
    "The extra-usage confirmation"
  );
  if (stored === undefined) refused("No extra-usage confirmation exists for this Workspace");
  normalizeExtraUsageConfirmations(stored, providers, preflight.now?.() ?? new Date());
}

// invariant: SSI-51 and SSI-52, at `start` and at `resume`, before any
// credential is read, any transition is applied, or any worktree exists. Every
// provider of a coordinated run authenticates by subscription, and each has
// the owner's extra-usage confirmation for that method under the current
// regime; otherwise the run is `not configured` and nothing changed.
export async function requireSubscriptionPreflight(preflight: SubscriptionPreflight): Promise<void> {
  requireSubscriptionAuth(preflight.auth);
  const providers = billingProviders(preflight.request);
  try {
    await requireConfirmations(preflight, providers);
  } catch (error) {
    explain(preflight.workspaceRoot, providers, preflight.stderr);
    throw error;
  }
}

// invariant: SSI-30. What `plan` shows of the subscription preconditions: the
// method each provider of the run must prove and its statement must name, the
// file that holds the statement, and the requirement the preflight of `start`
// would refuse now, or `ready`. Informational and machine-local, as the
// provider modes are: `start` and `resume` run the preflight again.
export async function subscriptionPreconditions(preflight: Omit<SubscriptionPreflight, "stderr">) {
  const providers = billingProviders(preflight.request);
  let state = "ready";
  try {
    requireSubscriptionAuth(preflight.auth);
    await requireConfirmations(preflight, providers);
  } catch (error) {
    if (!(error instanceof PublicErrorException) || error.envelope.code !== "VES_TASK_NOT_CONFIGURED") throw error;
    state = String(error.envelope.safeDetails["requirement"]);
  }
  return {
    auth: Object.fromEntries(providers.map((provider) => [provider, BILLING_METHODS[provider]])),
    extraUsage: "disabled",
    statement: BILLING_FILE,
    preflight: state
  };
}

export type SubscriptionPreconditions = Awaited<ReturnType<typeof subscriptionPreconditions>>;
