---
sidebar_position: 6
---

# Evidence

SuperDomestique asks people to trust unattended software delivery. The evidence
for that trust belongs in public records, close to the claims it supports.

## Current position

| Area | Status | Record |
|---|---|---|
| L3 parking and run completion | Enforced at the documented ledger boundary | [Public trust-claim audit](https://github.com/shftwst/faff/blob/main/verification/audits/2026-08-07-FAFF-732-public-trust-claims.md) |
| External L3 delivery | Demonstrated on a subject repository. The published Fly.io case study delivered its issue, but two governance controls failed, so it does not support a clean governed delivery | [July L4 capabilities audit](https://github.com/shftwst/faff/blob/main/verification/audits/2026-07-20-l4-capabilities-audit.md); [Fly.io L3 case study](https://github.com/shftwst/faff/blob/main/verification/external-verification/results/2026-08-12-fly-l3-faff-472/README.md) |
| Harness support | Claude Code is the primary supported harness. Codex has completed an interactive run with limitations, and pi.dev is planned | [Harness support](/guide/harness-support); [Harness coupling inventory](https://github.com/shftwst/faff/blob/main/docs/reference/architecture/harness-coupling.md) |
| L4 completion | Unsupported as a complete public claim | [Public trust-claim audit](https://github.com/shftwst/faff/blob/main/verification/audits/2026-08-07-FAFF-732-public-trust-claims.md) |
| Independent governance verification | The external-verification protocol is published. Its first real case did not support a clean governed delivery, and reproducible external proof is still pending | [External-verification protocol v0.1](https://github.com/shftwst/faff/blob/main/verification/external-verification/protocol/v0.1/README.md) |

## Read the records

- The [public trust-claim audit](https://github.com/shftwst/faff/blob/main/verification/audits/2026-08-07-FAFF-732-public-trust-claims.md)
  is the current claim-by-claim status record.
- The [L4 capabilities audit](https://github.com/shftwst/faff/blob/main/verification/audits/2026-07-20-l4-capabilities-audit.md)
  compares shipped mechanisms, documentation claims, and external runs.
- The [MCP call census](https://github.com/shftwst/faff/blob/main/verification/reports/mcp-call-census/report.md)
  is a dated first-party measurement of Linear connector traffic during development.
- The [evidence format guide](https://github.com/shftwst/faff/blob/main/verification/evidence/README.md) describes the records
  emitted by governed runs.
- The [external-verification index](https://github.com/shftwst/faff/blob/main/verification/external-verification/README.md)
  lists the published protocol and each real case.

These records are dated. A later implementation change does not silently update
their findings.
