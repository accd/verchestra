// The compiled-in runtime persistence migration registry, extracted from
// runtime-store.ts so it can be observed without importing node:sqlite.
//
// Why the split matters: node:sqlite prints an experimental-feature warning to
// stderr the moment anything imports it (see readonly.ts, which defers
// runtime-store.ts for exactly this reason). The sealed launcher's
// `--activation-health` protocol (packages/platform-node/src/
// activation-launcher-adapters.ts) requires the launcher process to emit one
// JSON object and nothing else, and the gate captures stderr into the same
// parsed buffer - so the health report's migration observation must project
// this registry without loading SQLite. This module therefore imports nothing
// at all; runtime-store.ts re-exports it unchanged, and every registration
// keeps its original identity and order.

export interface RuntimeMigration {
  readonly id: string;
  readonly up: string;
}

const EFFECT_SCHEMA = `
CREATE TABLE effect_intents (
  effect_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  operation_kind TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  run_id TEXT,
  logical_target TEXT NOT NULL,
  canonical_input_digest TEXT NOT NULL,
  semantic_identity TEXT NOT NULL,
  risk_tier TEXT NOT NULL CHECK (risk_tier IN ('low', 'medium', 'high')),
  grant_ref TEXT NOT NULL,
  expected_remote_version TEXT,
  status TEXT NOT NULL CHECK (status IN ('planned', 'ready', 'applying', 'uncertain', 'completed', 'failed')),
  attempt INTEGER NOT NULL CHECK (attempt >= 0),
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, idempotency_key),
  FOREIGN KEY (run_id) REFERENCES runs(run_id)
) STRICT;
CREATE TABLE effect_outbox (
  idempotency_key TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (idempotency_key) REFERENCES effect_intents(idempotency_key)
) STRICT;
CREATE TABLE operation_receipts (
  receipt_id TEXT PRIMARY KEY,
  effect_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  adapter_id TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  outcome TEXT NOT NULL,
  remote_identity TEXT,
  remote_version TEXT,
  output_digest TEXT,
  safe_evidence_refs_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  FOREIGN KEY (effect_id) REFERENCES effect_intents(effect_id),
  FOREIGN KEY (idempotency_key) REFERENCES effect_intents(idempotency_key)
) STRICT;
CREATE TABLE effect_inbox (
  receipt_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  received_at TEXT NOT NULL,
  FOREIGN KEY (receipt_id) REFERENCES operation_receipts(receipt_id)
) STRICT;`;

const MACHINE_PROFILE_SCHEMA = `
CREATE TABLE machine_profiles (
  workspace_id TEXT PRIMARY KEY,
  profile_json TEXT NOT NULL,
  profile_digest TEXT NOT NULL CHECK (length(profile_digest) = 64),
  updated_at TEXT NOT NULL
) STRICT;`;

const SYNC_STATE_SCHEMA = `
CREATE TABLE workspace_sync_states (
  workspace_id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  state_digest TEXT NOT NULL CHECK (length(state_digest) = 64),
  generations_json TEXT NOT NULL,
  ingestion_manifests_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE workspace_projects (
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  logical_path TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('active', 'retired')),
  lineage_json TEXT NOT NULL,
  PRIMARY KEY (workspace_id, project_id),
  UNIQUE (workspace_id, logical_path),
  FOREIGN KEY (workspace_id) REFERENCES workspace_sync_states(workspace_id) ON DELETE CASCADE
) STRICT;
CREATE TABLE projection_mappings (
  workspace_id TEXT NOT NULL,
  projection_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  canonical_digest TEXT NOT NULL,
  observed_remote_digest TEXT NOT NULL,
  observed_remote_version TEXT,
  PRIMARY KEY (workspace_id, projection_id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES workspace_projects(workspace_id, project_id) ON DELETE CASCADE
) STRICT;
CREATE TABLE local_rebuild_state (
  workspace_id TEXT PRIMARY KEY,
  canonical_state_digest TEXT NOT NULL CHECK (length(canonical_state_digest) = 64),
  source_policy TEXT NOT NULL CHECK (source_policy = 'canonical-sources-and-ingestion-manifests'),
  FOREIGN KEY (workspace_id) REFERENCES workspace_sync_states(workspace_id) ON DELETE CASCADE
) STRICT;`;

const POLICY_VIEW_SCHEMA = `
CREATE TABLE active_policy_views (
  workspace_id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL CHECK (generation > 0),
  view_json TEXT NOT NULL,
  view_digest TEXT NOT NULL CHECK (length(view_digest) = 64),
  updated_at TEXT NOT NULL
) STRICT;`;

const AUTHORITY_SCHEMA = `
CREATE TABLE authority_approvals (
  approval_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  action TEXT NOT NULL,
  record_json TEXT NOT NULL,
  record_digest TEXT NOT NULL CHECK (length(record_digest) = 64),
  revoked_at TEXT,
  revocation_reason TEXT,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(run_id)
) STRICT;
CREATE TABLE authority_grants (
  grant_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  action TEXT NOT NULL,
  record_json TEXT NOT NULL,
  record_digest TEXT NOT NULL CHECK (length(record_digest) = 64),
  revoked_at TEXT,
  revocation_reason TEXT,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(run_id)
) STRICT;`;

const RUN_CAPSULE_SCHEMA = `
CREATE TABLE run_capsule_seals (
  run_id TEXT PRIMARY KEY,
  state_version INTEGER NOT NULL CHECK (state_version > 0),
  terminal_status TEXT NOT NULL CHECK (terminal_status IN (
    'COMPLETED', 'HANDED_OFF', 'FAILED', 'ABORTED', 'INTERRUPTED', 'RECOVERED'
  )),
  capsule_id TEXT NOT NULL UNIQUE CHECK (length(capsule_id) = 64),
  payload_digest TEXT NOT NULL CHECK (length(payload_digest) = 64),
  sealed_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(run_id)
) STRICT;`;

const RUNTIME_SCHEMA = `
CREATE TABLE runs (
  run_id TEXT PRIMARY KEY,
  run_kind TEXT NOT NULL CHECK (run_kind IN ('feature', 'recovery')),
  state TEXT NOT NULL CHECK (state IN (
    'CREATED', 'INTAKE_REQUIRED', 'READY', 'DISCOVERY_REQUIRED', 'RECONNING',
    'SPECIFYING', 'SPEC_REVIEW', 'DESIGNING', 'DESIGN_REVIEW', 'TASKING',
    'EXECUTION_READY', 'AWAITING_EXECUTION_APPROVAL', 'EXECUTION_AUTHORIZED',
    'IMPLEMENTING', 'VERIFYING', 'REPAIRING', 'HUMAN_RESOLUTION_REQUIRED',
    'HUMAN_REVIEW', 'HANDOFF_PREPARING', 'AWAITING_HANDOFF_PUBLICATION_APPROVAL',
    'COMPLETED', 'HANDED_OFF', 'FAILED', 'ABORTED', 'INTERRUPTED', 'RECOVERED'
  )),
  state_version INTEGER NOT NULL CHECK (state_version >= 0),
  repair_cycles INTEGER NOT NULL CHECK (repair_cycles >= 0),
  approval_binding_digest TEXT,
  implementation_actor_id TEXT,
  terminal_capsule_required INTEGER NOT NULL CHECK (terminal_capsule_required IN (0, 1)),
  predecessor_run_id TEXT,
  successor_run_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE state_events (
  event_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  expected_state_version INTEGER NOT NULL CHECK (expected_state_version >= 0),
  previous_state TEXT NOT NULL,
  next_state TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_digest TEXT NOT NULL CHECK (length(payload_digest) = 64),
  actor_kind TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  UNIQUE (run_id, sequence),
  FOREIGN KEY (run_id) REFERENCES runs(run_id)
) STRICT;
CREATE TABLE approvals (
  approval_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  action TEXT NOT NULL,
  binding_digest TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (run_id) REFERENCES runs(run_id)
) STRICT;
CREATE TABLE grants (
  grant_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  action TEXT NOT NULL,
  binding_digest TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(run_id)
) STRICT;
CREATE TABLE leases (
  workspace_id TEXT PRIMARY KEY,
  lease_id TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  fencing_token INTEGER NOT NULL CHECK (fencing_token > 0),
  expires_at TEXT NOT NULL
) STRICT;
CREATE TABLE claims (
  claim_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  scope_digest TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE (workspace_id, scope_digest)
) STRICT;
CREATE TABLE artifact_refs (
  ref_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  digest TEXT NOT NULL,
  logical_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(run_id)
) STRICT;`;

// #58 T4b migrated `scopeDigest` from a locale-sorting private encoder to the
// qualified canonical contract, which changes the digest a given scope produces.
// Exclusivity here is a pure digest-equality lookup over UNIQUE (workspace_id,
// scope_digest) — there is no target-overlap computation — so a claim written
// under the old encoding would never collide with the same logical scope under
// the new one, and two runs could hold the same scope exclusively for as long as
// the TTL allows (up to 24 hours).
//
// Clearing the table is what makes T4b's "transient, not archival"
// classification true rather than merely argued: a claim is a short-lived
// authorization token, so discarding it costs a re-acquire, while leaving it
// orphaned costs the mutual exclusion it exists to provide.
const CLAIM_DIGEST_REENCODING = "DELETE FROM claims;";

// #58 T4b (PR #259) also migrated authority.ts's bindingDigest from the same
// locale-sorting private encoder to the qualified canonical contract.
// authority_approvals/authority_grants have no exclusivity property keyed by
// the digest (unlike claims' UNIQUE (workspace_id, scope_digest)) — rows are
// keyed by approval_id/grant_id, a StableId — so an orphaned row here cannot
// silently break mutual exclusion the way an orphaned claim could. But
// ApprovalService.verify() (packages/application/src/authority/authority.ts)
// recomputes bindingDigest fresh from the stored binding and compares it by
// equality against the persisted value: a bindingDigest stored under the old
// encoding would never match a fresh recomputation again, so every
// verification would report VES_APPROVAL_STALE for a record that was never
// tampered with -- correct in the sense that it still fails closed, but wrong
// in the sense that "stale" is meant to mean "content changed", not
// "algorithm changed". Same principle as the claims fix: transient is only
// true if the transition invalidates the old records rather than orphaning
// them into a confusing, misattributed failure.
const AUTHORITY_BINDING_DIGEST_REENCODING = "DELETE FROM authority_approvals; DELETE FROM authority_grants;";
// #58 T4d migrated the active-policy-view digest (cedar-policy.ts's `digest()`
// plus this file's own reverification in getActivePolicyView) from the same
// locale-sorting private encoder to the qualified canonical contract.
// getActivePolicyView recomputes the digest on every load and compares it by
// equality against the stored value -- a view saved under the old encoding
// would never match a fresh recomputation again, and every read would throw
// VES_RUNTIME_CORRUPT for a view that was never tampered with. Nothing in the
// product wires RuntimePolicyViewStore into a composition root yet (confirmed
// by search), so this is workspace-local cache state with no installed base,
// same reasoning as the claims and authority fixes -- and, same principle,
// transient is only true if the transition invalidates the old rows rather
// than leaving them to fail closed for the wrong reason.
const POLICY_VIEW_DIGEST_REENCODING = "DELETE FROM active_policy_views;";
const EFFECT_IDENTITY_CANONICALIZATION = `
ALTER TABLE effect_intents ADD COLUMN canonicalization_version INTEGER NOT NULL DEFAULT 1
  CHECK (canonicalization_version IN (1, 2));
CREATE UNIQUE INDEX effect_intents_logical_identity
  ON effect_intents(workspace_id, operation_kind, logical_target, canonical_input_digest, semantic_identity);`;

export const DEFAULT_RUNTIME_MIGRATIONS: readonly RuntimeMigration[] = Object.freeze([
  Object.freeze({ id: "001_runtime", up: RUNTIME_SCHEMA }),
  Object.freeze({ id: "002_effects", up: EFFECT_SCHEMA }),
  Object.freeze({ id: "003_machine_profiles", up: MACHINE_PROFILE_SCHEMA }),
  Object.freeze({ id: "004_sync_state", up: SYNC_STATE_SCHEMA }),
  Object.freeze({ id: "005_policy_views", up: POLICY_VIEW_SCHEMA }),
  Object.freeze({ id: "006_authority", up: AUTHORITY_SCHEMA }),
  Object.freeze({ id: "007_run_capsules", up: RUN_CAPSULE_SCHEMA }),
  Object.freeze({ id: "008_claim_digest_reencoding", up: CLAIM_DIGEST_REENCODING }),
  Object.freeze({ id: "009_authority_binding_digest_reencoding", up: AUTHORITY_BINDING_DIGEST_REENCODING }),
  // 009 is reserved by #268 (authority binding-digest re-encoding, pending
  // review at the time this migration was written); this follows at 010 to
  // avoid a numbering collision regardless of merge order.
  Object.freeze({ id: "010_policy_view_digest_reencoding", up: POLICY_VIEW_DIGEST_REENCODING }),
  Object.freeze({ id: "011_effect_identity_canonicalization", up: EFFECT_IDENTITY_CANONICALIZATION })
]);
