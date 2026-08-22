# Live Doctor Probes — Context

Issue #207 replaces the seven presence-only deep-doctor probes introduced by
T72 with genuine, read-only observations. T72 remains qualified and is not
rewritten: source mode continues to return `blocked` whenever an installed
subsystem is not provisioned.

The affected checks are `cedar-policy`, `sqlite-durable-state`,
`secret-presence`, `driver`, `connector`, `probe`, and `sandbox`. The first
four now use bounded adapters: defensive read-only SQLite inspection,
presence-only secret lookup, a manifest-only driver probe, and a protected-path
traversal rejection. The remaining three remain blocked until their direct
package dependencies are approved and wired.

The diagnostic is bracketed by sentinel capture. Every asynchronous operation
must complete before the after-sentinel capture; no read-only work may continue
after the report is sealed.

The CLI already declares direct dependencies on application, drivers, and
platform-node. Policy, connectors, and data-probe are not direct CLI
dependencies; adding those package edges requires explicit human approval
under the repository dependency rule.
