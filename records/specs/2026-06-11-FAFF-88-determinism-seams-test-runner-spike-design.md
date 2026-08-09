# Spec — FAFF-88: Spike — determinism seams + test-runner tech (ADR + reference fixture)

> Spec by faffter-dark-nlspec · adaptor faffidavit-spec · 2026-06-11 · autonomous · confidence: high.

The spike settles two load-bearing unknowns for the "faff's skills are verified, not assumed" initiative and proves the chosen approach with one runnable reference fixture — it does **not** build the substrate itself. Decisions are recorded in `records/adr/0002-skill-test-architecture.md`.

## 1. WHY

faff has no way to assert a skill *behaves* correctly — the only tests are the CLI's inline `--selftest` fixtures; LLM-driven skills are untested because their decisions depend on live tracker state and surface as free-text prose. Before any test substrate (FAFF-89/90/93) is built, two unknowns must be settled: (1) *what* you assert on an LLM-driven run, and (2) *what runner* under faff's zero-dependency constraint.

**Principles:** assert at deterministic seams never prose; zero-install honours the zero-dep ethos; a spike is de-risking (ADR + smallest proof), not delivery.

## 2. OUT OF SCOPE

- Mock-tracker fixture format + loader — FAFF-89 (this scopes the seam contract).
- Seeded-repo substrate — FAFF-90.
- Skill-run harness — FAFF-93. Decision-assertion / first behavioural test — FAFF-95/94.
- Broadening CLI selftest coverage — FAFF-91/92.

## 3. WHAT — the ADR's decisions

- **Runner:** Node's built-in `node:test` + `node:assert` (zero-install, Node ≥ 18).
- **Assertion scope:** deterministic seams (CLI verdicts, mutations, routing, bucket membership) — never prose.
- **Reference-fixture target:** the CLI `faff next` routing seam.
- **Test location + CI:** `test/` at repo root, `node --test test/`, one CI step in `validate.yml`.
- **ADR location:** `records/adr/NNNN-title.md` (Nygard). 0001 was taken by the contract-as-code ADR, so this is `0002`.
- **Mock-tracker seam:** scoped (contract stated for FAFF-89), not built.

**Punts (deferred by design):** mock-MCP fidelity → FAFF-89; skill-decision capture → FAFF-93/95.

## 4. HOW

Two artefacts: the ADR (`records/adr/0002-skill-test-architecture.md`) and one `node:test` reference fixture (`test/cli-next-seam.test.mjs`) that invokes `faff next` with fixed flags and asserts the structured verdict token (`{next: "graft"}` for todo+high; `{next: "prep"}` for todo+none), plus a discriminating negative case. The fixture depends on nothing unbuilt (no mock-tracker).

## 7. DONE

- [x] `records/adr/0002-skill-test-architecture.md` records runner / assertion-scope / reference-fixture target / test+CI location / ADR convention / the mock-tracker seam contract for FAFF-89.
- [x] The ADR states the two deferred Punts (FAFF-89 fidelity; FAFF-93/95 capture) + the governance note.
- [x] `test/cli-next-seam.test.mjs` invokes the CLI `faff next` seam and asserts the structured verdict + exit, with a discriminating negative case, asserting the token not the reason string.
- [x] `node --test test/` runs green; `validate.yml` gains a `node --test test/` step.
- [x] The fixture imports no unbuilt mock-tracker machinery.

confidence: high
