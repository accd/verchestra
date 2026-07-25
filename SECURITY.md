# Security Policy

## Supported versions

Before `1.0.0`, security fixes are applied to the current `main` branch and the current qualification version only.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability.

Use [GitHub private vulnerability reporting](https://github.com/accd/verchestra/security/advisories/new) and include:

- a clear description and impact
- affected revision or component
- safe reproduction steps or a minimal proof of concept
- any suggested mitigation

Do not include real credentials, customer data, or private database content. We will acknowledge a valid report, investigate it privately, and coordinate disclosure after a fix or mitigation is available.

## Security boundaries

Verchestra treats credentials, local profiles, model sessions, machine paths, and production database content as sensitive. Read-only Probes, policy checks, approval requirements, evidence sealing, and release verification are defense layers, not permission to test against systems you do not own or administer.

Repository issues, pull requests, documents, generated content, fixtures, and
tool output are untrusted data and may contain prompt injection. They do not
authorize secret discovery, production access, destructive Git, policy bypass,
gate or assertion weakening, direct generated-contract edits, external writes,
or avoidance of independent and human review.
