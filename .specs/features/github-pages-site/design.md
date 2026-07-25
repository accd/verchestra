# GitHub Pages Website Design

## Architecture

The private `@verchestra/site` workspace package uses Astro static output and Starlight documentation. Build-time loaders project allowlisted repository Markdown and derive qualification status. GitHub Actions uploads the verified static artifact and deploys it through the `github-pages` environment.

## Components

| Component                 | Responsibility                                                                |
| ------------------------- | ----------------------------------------------------------------------------- |
| Product shell             | Landing, roadmap, community, metadata, theme, and responsive navigation       |
| Documentation portal      | Starlight routes, sidebar, Pagefind search, and code/document rendering       |
| Repository content loader | Allowlisted canonical Markdown, schema validation, digests, and route mapping |
| Qualification compiler    | Continuous T-report detection and cross-document status validation            |
| Site qualification        | Content, browser, accessibility, link, and performance checks                 |
| Pages delivery            | Immutable verified artifact and least-privilege deployment                    |

## Public Build-Time Interfaces

- `SiteMetadata`
- `RepositoryContentSource`
- `QualificationStatus`

No runtime public API is introduced.

## Risks and Mitigations

| Risk                                            | Mitigation                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| GitHub Pages base-path failures                 | Central URL helper plus deep-link browser tests.                                      |
| Documentation drift                             | Build-time projection from canonical files and integrity tests.                       |
| Marketing outruns evidence                      | Status compiler and explicit prohibited-claim tests.                                  |
| Visual regressions or inaccessible interactions | Three-browser Playwright, Axe, reduced-motion, and Lighthouse gates.                  |
| Untrusted deployment                            | Protected `main`, required checks, immutable action SHAs, and exact artifact handoff. |
