# Canonical JSON Census Tasks

| Task | Deliverable | Requirements | Verification | Status |
| --- | --- | --- | --- | --- |
| T0 | Census specification, design, task record, and portable handoff | CJC-01–CJC-05 | `pnpm agent:check` | Complete |
| T1 | Mechanical scanner, canonical inventory, and discriminating security test | CJC-01–CJC-04 | focused security + `pnpm gate:security` | Complete — correction covers the omitted local canonicalizer, required entry reasons, and the closed exception boundary; `pnpm gate:security` passed. |
| T2 | Compatibility-matrix reconciliation and next-vertical handoff | CJC-05 | `pnpm agent:check` + `pnpm gate:quick` | Complete — 77-source inventory and portable handoff reconciled; `pnpm gate:quick` passed. |
