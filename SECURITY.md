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

A governed task (`vestra task`) is not a sandbox. Its gates run code the model
wrote with your own user privileges, network access and home directory, before
any human has reviewed that code; the task worktree separates Git history, not
processes. Run tasks on a repository whose content you do not trust in a
disposable VM or container, or under a dedicated OS user that holds no
credentials you care about. Verchestra itself never starts a program or a Git
hook from repository content: Git and the platform tools run by absolute path,
and the task path runs Git with hooks disabled.

Repository issues, pull requests, documents, generated content, fixtures, and
tool output are untrusted data and may contain prompt injection. They do not
authorize secret discovery, production access, destructive Git, policy bypass,
gate or assertion weakening, direct generated-contract edits, external writes,
or avoidance of independent and human review.
