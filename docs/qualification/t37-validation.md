# T37 OpenCode/Qwen Driver Validation

## Scope

- Task: T37 — Implement OpenCode/Qwen Driver
- Requirements: VES-MDL-001…005, VES-BST-002, VES-HOF-003…004, VES-TST-005/008
- Commit target: `feat(drivers): add opencode qwen adapter`
- Focused evidence: 28 cases (18 contract, 5 integration, 5 security)
- Spec deviations: none

T37 adapts OpenCode's model catalog, loopback SDK events, permissions, usage, and session lifecycle to the common Driver port. Routing remains provider/model-generic: Qwen is proven as a real corporate fixture, not a hard-coded exception. The production server is spawned directly with a safe environment allowlist, then the SDK client connects to that isolated loopback server; this closes an ambient-credential inheritance weakness in the qualification spike's convenience factory.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/contract/opencode-driver.test.mjs tests/integration/opencode-driver-lifecycle.test.mjs tests/security/opencode-driver-security.test.mjs` | PASS — 28 passed, 0 failed/skipped |
| `node scripts/gate.mjs security` | PASS — format, lint, typecheck/build, 1,418 unit, 10 architecture, 248 qualification, 230 security, and 49 fault cases |

## Adequacy matrix

| Criterion | Evidence | Covered |
| --- | --- | --- |
| Version/capabilities | Compatible, unsupported, unavailable probes | Yes |
| Generic discovery | Qwen plus non-Qwen catalog and execution cases | Yes |
| Qwen-only operation | Complete integration lifecycle with only company/Qwen | Yes |
| Exact identity | Passport revision, provider/model, connected-catalog miss | Yes |
| Reasoning/usage | Input/output/reasoning/cache common usage event | Yes |
| Tool mediation | Allow-once, reject, undeclared/built-in bridge rejection | Yes |
| Session/cancellation | Abort race regression, SDK abort-before-close, local refs, idempotent close | Yes |
| Corporate secrets | Real spawn environment allowlist, ambient/explicit session negatives | Yes |
| Redaction/isolation | Content, permission metadata, provider session, foreign event cases | Yes |
| Minimum floor | 28 focused cases versus required 22 | Yes |

## Non-shallow checks

- The production path does not call the SDK convenience server launcher because it inherits all of `process.env`; Verchestra owns the spawn environment and connects the client afterward.
- Only `127.0.0.1`, ephemeral port, disabled sharing, and ask-all permissions are permitted.
- Both Qwen and another model family pass through the same catalog/Passport resolver.
- Tool names and schema digests match the canonical manifest; non-`vestra_*` tools fail before server creation.
- Permission metadata is redacted before controller authorization, not only before logging.
- Events carrying a different provider session ID are discarded.
- Abort is rechecked after asynchronous probe/resolution and after listener registration, closing the lost-abort race found by the first corpus run.

## Verdict

PASS. Tests preceded implementation, the T05 behavior and T33 common contract are preserved, the Qwen-only work environment is fully covered without special routing, corporate credentials are isolated at the actual process boundary, the test floor is exceeded, and the security gate passes.
