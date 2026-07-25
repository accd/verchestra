# Verchestra Specification State

## Decisions

### AD-001 — GitHub Pages website architecture

- **Status:** active
- **Decision:** Build the public website as the private `@verchestra/site` Astro workspace package and deploy static output through GitHub Actions to `https://accd.github.io/verchestra/`.
- **Rationale:** The website belongs with the product source, requires no runtime service, and must be reviewed and qualified with the same repository controls.

### AD-002 — Public website truth boundaries

- **Status:** active
- **Decision:** Repository Markdown remains canonical; website-only guides may live in the site package, and build-time adapters may project canonical documents without changing their source.
- **Rationale:** Public presentation must not create a second, drifting architecture or qualification record.

### AD-003 — Public status language

- **Status:** active
- **Decision:** The site describes `0.0.0-qualification`, T68 complete, and T69 next. It must not claim a public installer, production readiness, or a 1.0 release.
- **Rationale:** Evidence and release state take precedence over marketing language.

## Handoff

- **Feature:** `github-pages-site`
- **State:** Independently verified; protected-main publication pending
- **Branch:** `agent/verchestra-github-pages`
- **Completed:** T1–T8, including local content, browser, accessibility, performance, and deployment-workflow gates.
- **Verification:** PASS at `7d0b635`; 12/12 WEB requirements matched and 1/1 discrimination mutation killed.
- **Next:** Publish through protected `main` and verify the production deployment.
