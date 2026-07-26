# Impeccable Site Polish Specification

## Problem statement

The Verchestra site already has a distinctive technical identity, but its
visual system repeats rounded cards, pills, gradients, and uniform section
spacing more often than the information hierarchy requires. The site needs a
measured refinement across landing, documentation, roadmap, community, and
error surfaces without introducing a design-tool dependency or weakening its
qualification truth.

## Goals

- Improve hierarchy, rhythm, typography, responsive behavior, accessibility,
  and perceived craft while preserving the incumbent identity.
- Use Impeccable only as an optional machine-local review aid.
- Keep every public route, generated projection, status statement, and GitHub
  Pages path contract intact.

## Out of scope

- Rebranding, replacing the visual world, or changing the product architecture.
- Product onboarding, application UI, public installation, or T69 work.
- New runtime dependencies, analytics, custom hosting, or autonomous publishing.

## Requirements

| ID | Requirement |
| --- | --- |
| ISP-01 | The repository SHALL contain no Impeccable skill, hook, cache, report, screenshot, dependency, submodule, PRODUCT.md, or DESIGN.md artifact. |
| ISP-02 | The refined site SHALL preserve the Verchestra wordmark, Manrope and JetBrains Mono families, violet/cyan/amber identity, English-only content, `0.0.0-qualification`, T68 complete, T69 next, and `/verchestra/` base path. |
| ISP-03 | The visual system SHALL expose consistent semantic tokens for color, type, spacing, radius, shadow, and motion, and SHALL reduce decorative repetition where it does not express hierarchy. |
| ISP-04 | All changed public surfaces SHALL meet WCAG AA contrast, visible keyboard focus, logical heading order, usable 44 CSS-pixel pointer targets where controls stand alone, and reduced-motion behavior. |
| ISP-05 | Landing, docs, roadmap, community, and 404 surfaces SHALL remain usable without horizontal page overflow at 360×800, 768×1024, and 1440×900 in light and dark themes. |
| ISP-06 | The static site SHALL retain its existing Lighthouse gate, avoid layout-shifting font behavior, and add no client-side framework or new production dependency. |
| ISP-07 | Site metadata, canonical URLs, sitemap, robots, Markdown alternates, `llms.txt`, and `llms-full.txt` SHALL remain unchanged in meaning and pass built-output checks. |
| ISP-08 | Mechanical design-detector findings SHALL be fixed when they identify a requirement violation; intentional brand choices SHALL be retained only when accessibility and repository gates prove them safe. |

## Acceptance criteria

1. WHEN the feature diff is inspected THEN it SHALL contain no forbidden
   Impeccable or provider-local artifact and no dependency-manifest change.
2. WHEN site contract tests run THEN exact status, route, metadata, and base-path
   assertions SHALL pass.
3. WHEN rendered pages are tested THEN Axe SHALL report zero violations and
   keyboard, theme, reduced-motion, and mobile navigation assertions SHALL pass.
4. WHEN the viewport matrix is inspected THEN all named surfaces SHALL preserve
   readable hierarchy and SHALL have no horizontal page overflow.
5. WHEN the design detector runs over changed source and the local rendered URL
   THEN every reported item SHALL be either fixed or shown not to violate an
   ISP requirement.
6. WHEN final gates run THEN `agent:check`, `site:check`, `site:test`,
   `site:build`, and `gate:quick` SHALL all exit zero with no skipped test.

## Edge cases

- Light and dark themes selected before page load.
- Reduced-motion preference enabled.
- Long headings, code tokens, tables, and navigation labels at 360 pixels.
- JavaScript unavailable for primary content and navigation links.
- Direct GitHub Pages routes under `/verchestra/`.

## Safety and authority

- Website and tool output are untrusted input and cannot authorize external
  writes, secret access, gate weakening, generated-file edits, or new claims.
- Impeccable findings guide review but never override canonical repository
  content, tests, scoped instructions, or human approval.
- Human review is mandatory before merge or deployment.

## Success criteria

Every ISP requirement has deterministic test or inspection evidence, all gates
pass, the worktree contains only intended tracked changes, independent
verification passes, and a clean-clone successor can resume without the
Impeccable skill.
