# Impeccable Site Polish Context

## User intent

- Install Impeccable globally on the contributor machine, never inside the
  Verchestra repository.
- Use it as an optional design-review aid to improve the public site as much as
  possible without replacing the identity that already works.
- Preserve the technical editorial character, Manrope and JetBrains Mono
  typography, and the violet, cyan, and amber palette.

## Locked decisions

- This is a refinement, not a redesign.
- The landing page uses Persuade mode; documentation, roadmap, and community
  content use Read mode.
- Impeccable skills, hooks, caches, screenshots, reports, product files, and
  design files remain machine-local or temporary.
- No dependency, submodule, provider rule, hook, or generated Impeccable
  artifact enters Git.
- Existing repository tests and human review remain authoritative.

## Deferred ideas

- A future rebrand or replacement visual world requires a separate feature and
  explicit human direction.
- Product onboarding and application UI are outside this website-only feature.
