# Impeccable Site Polish Design

## Architecture

The existing Astro/Starlight static site remains unchanged structurally.
Canonical repository Markdown and typed product data continue to feed generated
website projections. Refinement is implemented in the existing global style
layer, Astro product layout, landing page, and their behavior-focused tests.

Impeccable runs outside the repository as a temporary reviewer. Its output is
translated into ordinary code and test changes; no runtime or contribution path
depends on it.

## Components and responsibilities

| Component | Responsibility |
| --- | --- |
| Semantic CSS tokens | Keep color, type, spacing, radius, elevation, focus, and motion consistent across product and Starlight surfaces. |
| Product layout | Provide accessible shared header, navigation, theme control, and footer. |
| Landing composition | Express product truth with varied editorial hierarchy instead of repeated containers. |
| Starlight presentation | Keep long-form documentation readable, navigable, and visually aligned with the product shell. |
| Site tests | Prove routes, status, metadata, accessibility, responsive behavior, theme, and reduced motion. |

## Public interfaces

No package API, schema, CLI, route, or content interface changes. Existing public
URLs and generated LLM-readable artifacts remain stable.

## Canonical sources and generated projections

- Repository Markdown and `src/data/product.ts` remain canonical.
- Astro pages and built HTML/Markdown/LLM outputs remain projections.
- `dist`, browser output, screenshots, and Impeccable state remain untracked.

## Dependency direction

No new dependency is introduced. Site code continues to consume canonical
repository content through the existing loaders and Starlight integration.

## Security and trust boundaries

The external design tool has no repository hook, credential access, production
access, or write authority. Only explicit source edits are reviewed and tracked.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Refinement erases brand character | Lock the incumbent fonts, palette, wordmark, and technical editorial tone in ISP-02. |
| Detector treats intentional brand color as generic AI styling | Require accessibility and hierarchy evidence before retaining any flagged choice. |
| CSS changes regress documentation | Test both custom product pages and representative Starlight pages in both themes. |
| Mobile polish causes desktop drift | Validate the fixed three-viewport matrix and built output. |
| Tool artifacts leak into Git | Add explicit diff checks and agent-readiness coverage. |
