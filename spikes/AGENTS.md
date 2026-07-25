# Qualification Spike Instructions

Apply the root `AGENTS.md` first.

- Spikes qualify a bounded dependency or runtime behavior; they are not
  production implementation or vendor-wide approval.
- Record exact tool, model, runtime, and dependency versions and the tested
  environment. Unavailable tooling is `not configured`, never a pass.
- Keep fixtures synthetic, local, disposable, and free of credentials,
  production data, provider sessions, usernames, home directories, and
  absolute paths.
- Fail closed on missing capability, authority, integrity, or cleanup.
- Tests must cover expected behavior and discriminating failure modes without
  network or provider requirements in mandatory gates.
- Run the matching `pnpm qualify:*` command and `pnpm test:qualification`; add
  security or fault gates when the spike crosses those boundaries.

