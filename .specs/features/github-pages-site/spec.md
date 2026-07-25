# GitHub Pages Website Specification

## Problem Statement

Verchestra has a strong public repository but no product website or browsable documentation portal. AI engineers, technical leaders, and contributors need a fast, accurate public surface that explains the product, exposes its evidence, and remains honest about qualification status.

## Goals

- Publish an English-only product and documentation website at `https://accd.github.io/verchestra/`.
- Keep canonical repository documentation authoritative and auditable.
- Qualify accessibility, performance, content integrity, and deployment before publication.

## Out of Scope

| Feature                                                | Reason                                              |
| ------------------------------------------------------ | --------------------------------------------------- |
| Public package installation                            | Release qualification is incomplete.                |
| Custom domain                                          | The first deployment uses the GitHub Pages domain.  |
| Analytics, forms, authentication, CMS, or runtime APIs | The site is private-data-free static documentation. |
| Translation                                            | English is the public project language.             |

## Assumptions and Open Questions

| Decision         | Chosen default                              | Rationale                                                | Confirmed? |
| ---------------- | ------------------------------------------- | -------------------------------------------------------- | ---------- |
| Primary audience | AI engineers                                | They are the first technical adopters.                   | Yes        |
| Site shape       | Product landing plus documentation          | Balances explanation with practical depth.               | Yes        |
| Visual direction | Dark orchestral with a complete light theme | Matches the Verchestra name without becoming decorative. | Yes        |
| Hosting          | GitHub Pages at `/verchestra/`              | Explicit user requirement.                               | Yes        |

**Open questions:** none.

## Requirements

| ID     | Requirement                                                                            | Status       |
| ------ | -------------------------------------------------------------------------------------- | ------------ |
| WEB-01 | The static site works from the `/verchestra/` base path.                               | Implementing |
| WEB-02 | The first viewport explains the product, status, and purpose.                          | Pending      |
| WEB-03 | Product documentation is searchable and keyboard accessible.                           | Pending      |
| WEB-04 | Root repository documentation remains canonical and is not manually duplicated.        | Pending      |
| WEB-05 | Drivers and databases are accurate, with SAP ASE/Sybase first-class.                   | Pending      |
| WEB-06 | Discovery through human review is explained.                                           | Pending      |
| WEB-07 | Implemented, qualification, and roadmap states are visually distinct.                  | Pending      |
| WEB-08 | Page templates satisfy WCAG 2.2 AA expectations and responsive behavior.               | Pending      |
| WEB-09 | Controlled Lighthouse scores are Performance ≥95 and all other categories 100.         | Pending      |
| WEB-10 | The website has no tracking, forms, authentication, secrets, or runtime API calls.     | Pending      |
| WEB-11 | Only a verified `main` artifact deploys to GitHub Pages.                               | Pending      |
| WEB-12 | Clean-clone site development, checks, tests, and builds are documented and executable. | Pending      |

## Acceptance Criteria

1. WHEN a visitor opens the production URL or a direct documentation URL THEN the site SHALL render with assets and links under `/verchestra/`.
2. WHEN a visitor views the first viewport THEN the site SHALL show the approved headline, definition, `0.0.0-qualification`, and no installation claim.
3. WHEN a visitor searches or navigates using only a keyboard THEN the site SHALL expose documentation and visible focus without a serious or critical Axe violation.
4. WHEN canonical documentation or qualification evidence changes THEN the next build SHALL project that source or fail on an integrity mismatch.
5. WHEN qualification status is compiled THEN the site SHALL report the contiguous T01–T68 evidence set and identify T69 as next.
6. WHEN the site quality gate runs THEN it SHALL validate content, browsers, accessibility, links, base-path behavior, and the defined performance budgets.
7. WHEN changes reach protected `main` THEN GitHub Actions SHALL deploy only the exact artifact produced by the successful site-quality job.

## Edge Cases

- Missing or non-contiguous qualification evidence fails the build.
- Duplicate routes or source paths outside the repository fail the build.
- Reduced-motion users receive no decorative motion.
- Direct deep links and the custom 404 page preserve the Pages base path.
- Failed or superseded qualification work is never presented as completed.

## Success Criteria

- All WEB requirements have file-and-assertion evidence.
- Both required GitHub checks pass.
- The production site is reachable over HTTPS.
- The independent verifier kills all targeted behavior mutations.
