# Versioning

Verchestra follows [Semantic Versioning](https://semver.org/).

The current source version is `0.0.0-qualification`: the published qualification line. Its `.N` builds are signed public releases of a candidate the signed 1.0.0 decision holds; they are not a stable package release and not a compatibility promise. The conditions under which a public `0.x` line or a second 1.0.0 decision round would open are recorded in [docs/qualification/qualification-line-exit-record.md](docs/qualification/qualification-line-exit-record.md).

Before `1.0.0`, public versions may change interfaces, artifact schemas, and operational behavior when qualification evidence requires it. A `1.0.0` release requires the final acceptance decision described in [ROADMAP.md](ROADMAP.md).

After `1.0.0`:

- Patch releases fix compatible defects.
- Minor releases add backward-compatible capabilities.
- Major releases document breaking changes and migration guidance.

Every release must have signed provenance, SBOM and license evidence, and release notes in [CHANGELOG.md](CHANGELOG.md).
