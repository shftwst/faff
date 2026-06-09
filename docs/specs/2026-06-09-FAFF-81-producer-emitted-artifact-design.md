# Spec — FAFF-81: producer-emitted contract artifact (spec producer first)

> Spec: faffter-dark-nlspec · 2026-06-09 · interactive · adaptor: faffidavit-spec · confidence: high.

First Path-A adoption: the spec producer emits the contract artifact so faffidavit-spec consumes it deterministically (artifact-preferred branch, FAFF-77 designed it, never ran). Full spec on Linear FAFF-81.

## Decisions (all Chosen)
- D1 Transport: **embedded fenced block** — producer appends one sentinel-tagged fence `faff-contract:<contract-name>` (here `faff-contract:spec-readiness`), single per spec, at the END of the markdown, containing the extraction JSON. Travels with the spec; can't drift; adaptor locates by the info-string. Rejected: sidecar file (extra lifecycle, drift). Recorded in ADR 0001.
- D2 Precedence: faffidavit-spec — present+valid → use it (no LLM); present+malformed → fail-loud; absent → today's LLM prose-extraction (unchanged). Fallback trigger = absence only.
- D3 Producers: both defaults (faffter-dark-nlspec + faffter-noon-spec) emit the block; adaptor is producer-agnostic.
- D4 Format owner: the spec_adaptor (faffidavit-spec).

## Payload = existing extraction JSON (no new shape)
{ confidence: high|medium|low, provenance_present: bool, decisions: [{marker: chosen|punt|assumes|none}] }

## DONE
- Default producer emits a valid faff-contract:spec-readiness block; adaptor uses it (no LLM); malformed→fail-loud; absent→prose still validates; convention in ADR 0001; contract script + validate-adapters unchanged and green.

confidence: high
