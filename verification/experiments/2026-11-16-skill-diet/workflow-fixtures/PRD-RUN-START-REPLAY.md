# PRD artifact run-start replay

After the fresh Astra V2 comparison completes, feed all sixty actual PRD artifacts
through the real prd-readiness validator and use its admissibility output as the
run-start signal. Compute covered and uncovered examples with the real PRDR
coverage CLI. Exercise each artifact under uncovered, covered, inward and
unmeasurable-coverage contexts, then validate every run-start result through the
run-trigger contract.

Require the independently specified verdict and reason in all 240 combinations.
Inward refuses before PRD readiness; an inadmissible PRD refuses before coverage;
an admissible PRD plans uncovered work, drains covered work, and refuses unknown
coverage. A forged contrary verdict must be rejected and corrected by the
run-trigger validator in every case. Bind source artifact, native audit and
runtime hashes, and preserve all CLI inputs and outputs.

This is deterministic downstream consumption of measured artifacts. Target and
coverage inputs are controlled. It proves no run mint, live tracker acquisition,
model-driven caller wiring or complete beep-boop workflow.
