# ADR 0105 — Adopt a DCO for contributions and commit to remaining Apache-2.0

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-08-11
- **Issue:** FAFF-589

## Context

The repository is public and licensed under Apache-2.0. Inbound contributions currently stand at zero, which makes this the cheapest moment to set contribution and licensing policy: no existing contributor has yet submitted work under an unstated posture, so the policy can be declared cleanly rather than reconstructed after the fact.

Two gaps in that posture would each erode the trust an open project depends on if left undefended. First, there is no stated rule for how contributed code enters the project, which leaves the provenance of inbound work unattested and the licence it enters under implicit. Second, there is no public commitment on the project's own licence or on the product names, so a future relicense or a trademark dispute would each land as a surprise on contributors and adopters who had assumed continuity.

The project already carries a provenance-hygiene posture — per-commit attestation is the shape it prefers for evidence. The naming programme this record builds on is settled: the [staged-naming decision](./0096-adopt-superdomestique-and-commissaire-through-staged-naming.md) adopted **SuperDomestique** as the umbrella product identity and **Commissaire** as its governance responsibility, while `faff` remains every current technical identifier. Those names are now in public use and need their first-use priority recorded before any fork or dispute makes the dates contestable.

## Decision

**Inbound contributions are gated by a Developer Certificate of Origin, not a CLA.** The project adopts the DCO v1.1 ([developercertificate.org](https://developercertificate.org)), enforced by a per-commit `Signed-off-by` trailer and a CI check. A DCO is a per-commit attestation that the contributor has the right to submit the work under the project's licence; a CLA is a rights-assignment agreement that requires signature infrastructure and a records system. The DCO matches the project's provenance-hygiene posture, adds no friction beyond `git commit -s`, and keeps the attestation attached to each commit rather than held in a separate ledger.

**Contributions are inbound = outbound Apache-2.0.** A contribution enters under the same licence the project ships under. There is no separate rights grant and no assignment of copyright to the project; contributors retain their copyright and license their work to the project on the project's own terms.

**The project commits publicly to remaining Apache-2.0.** It will not relicense to source-available or more-restrictive terms. This covenant is stated in the README and is load-bearing, not decorative: Apache-2.0 accepts inbound contributions under permissive terms, and because there is no separate rights grant, the project holds no mechanism to relicense contributors' work out from under them. The commitment and its enforceability point the same way.

**The SuperDomestique and Commissaire names are documented for first-use priority.** The README trademarks note records the names, their first public appearance, and the associated dates. Apache-2.0 §6 grants no trademark rights, so the names remain the project's regardless of forks of the code. Registration of the marks is out of scope for this decision.

## Consequences

- No CLA infrastructure is built or maintained. There is no signing service, no contributor agreement to track, and no per-contributor records system; the `Signed-off-by` trailer and the CI check are the whole enforcement surface.
- Sign-off is required on every commit from the day the CI check lands, not retroactively. Existing history is not rewritten to add trailers; the gate applies forward to new contributions.
- Relicensing away from Apache-2.0 is foreclosed. The public covenant states the intent and the inbound = outbound posture removes the rights grant that a relicense would need, so a later reversal would require reopening both this decision and the licence every contributor relied on.
- The product names are defensible by dated first-use without registration. The README record fixes the priority dates; a fork of the code inherits no claim to the names, per Apache-2.0 §6.
- A trademark registration or a published names-usage policy is a separate, later decision. This record establishes first-use priority only and does not commit the project to pursue or forgo registration.
- Contributor and adopter trust is the stated basis for the licence covenant and the naming record alike: both defend the expectation of continuity that an open project runs on, independent of any other consideration.
