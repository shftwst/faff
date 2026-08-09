# ADR 0002 — Skill test architecture: determinism seams + test runner

- **Status:** Accepted
- **Date:** 2026-06-11
- **Issue:** FAFF-88 (spike — determinism seams + test-runner tech)
- **Initiative:** faff's skills are verified, not assumed

> Note: `0001` is `0001-contract-as-code-foundations.md` (the contract-as-code work). This is the second ADR in `records/adr/`.

## Context

faff has no way to assert a skill *behaves* correctly. The only tests today are the `faff` CLI's inline `--selftest` fixtures; the LLM-driven skills (wtf / tidy / prep / graft) are untested because their decisions depend on live tracker state and surface as non-reproducible free-text prose. Before any test substrate (FAFF-89 mock-tracker fixture, FAFF-90 seeded repo, FAFF-93 skill-run harness) is built, two unknowns must be settled or that substrate risks being built on the wrong foundation:

1. **What do you assert on an LLM-driven run?**
2. **What test runner, under faff's deliberate zero-dependency constraint?**

This ADR records both decisions plus the seam contract downstream tickets consume, and is proven by one reference fixture.

## Decisions

### 1. Assert at deterministic seams, never on prose

Assertions bind **only** to the structured, reproducible artefacts a skill emits:

- CLI invocations and their args / stdout / exit (especially `faff next` and `faff state` verdicts)
- tracker mutations (status moves, label changes)
- routing verdicts
- bucket membership

Free-text narrative is **never** asserted — it is non-reproducible across runs. This generalises the pattern already proven for contracts by `faff contract <name> --selftest`.

### 2. Runner = Node's built-in `node:test` + `node:assert`

Zero-install: ships in Node ≥ 18 (CI pins Node 20; local dev is Node 22). No `package.json`, no devDependency, no lockfile, same language as the CLI under test, and structured assertions a shell harness can't give. Rejected: shell (brittle structured asserts), Python stdlib (out-of-language, needs an interpreter present), and any third-party framework (jest/mocha/vitest — reintroduces the install/lockfile burden the zero-install decision exists to avoid).

### 3. Test location + CI wiring

Tests live under `test/` at the repo root, run via `node --test test/` (Node's built-in runner — no config file, no `package.json`). CI gains one `node --test test/` step in `.github/workflows/validate.yml` alongside the existing `--selftest` steps.

### 4. Reference-fixture target = the CLI `faff next` routing seam

The trivial proof exercises the already-deterministic CLI seam: provision a fixed issue-state → flags, invoke `faff next`, assert the structured verdict token. This proves "chosen runner + assert-at-seam" end-to-end **without** the unbuilt mock-MCP, because `faff next` is a pure function skills already consult for routing.

### 5. Mock-tracker seam — scoped here, built by FAFF-89

This ADR **states the contract** FAFF-89 must satisfy without building it:

> The mock returns **deterministic responses for a given fixture state**, injected at the **skill→MCP boundary**, such that a skill run over a fixed fixture yields **identical seam outputs every time**.

That contract is what unblocks FAFF-89 to start.

## Open (handed downstream, framed)

- **Mock-MCP fidelity** — hand-written fixtures vs recorded cassettes vs a test-mode MCP server. **FAFF-89** decides, using the seam contract above.
- **Skill-decision capture** for full skill-level tests — structured-output mode vs transcript scrape vs dedicated test-mode. **FAFF-93 / FAFF-95** decide. The reference fixture sidesteps this via the CLI's existing structured stdout/exit.

## Governance

Spec `**Chosen:**` markers are local and ephemeral; an **architecturally-significant** Chosen graduates into an ADR under `records/adr/NNNN-title.md` (Nygard, repo file — it travels with the code and is reviewed in the PR). This ADR is the first such graduation from the test-substrate initiative; the contract-as-code ADR (`0001`) is the precedent.

## Consequences

- The test-substrate tickets (FAFF-91 runner, FAFF-92 coverage, FAFF-96 goldens, FAFF-89 mock, FAFF-90 seeded repo, FAFF-93 harness) all build on `test/` + `node:test` + the CLI-seam assertion pattern recorded here.
- CI now runs `node --test test/`; the first `test/` file (the reference fixture) makes that step non-vacuous.
- No new `faff` subcommand, no `.faffrc` key, no new `.faff/` artefact — the test architecture is purely repo-side tooling.
