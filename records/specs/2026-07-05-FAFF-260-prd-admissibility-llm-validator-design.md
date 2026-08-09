# PRD-admissibility LLM validator — packaging + L4 run-start wiring

> Spec: faffter-dark-nlspec · 2026-07-05 · autonomous · confidence: high. Full spec on Linear FAFF-260.

The **PRD-admissibility LLM validator**: the missing second half of FAFF-253's split. FAFF-253 shipped the deterministic `faff contract prd-readiness` validator (shape-checks a verdict). This ticket ships the LLM producer that READS the PRD and EMITS that verdict, packages it as a swappable slot-skill, and wires the resulting gate into the L4 run-start sequence.

## 1. WHY

`faff lights-out` guards accountability with 8 CLI-contract guardrails. But none currently checks whether the **project's PRD has machine-verifiable stop-conditions** — the exact precondition that makes an L4 run terminable and auditable. Without this gate, an L4 run can start against a PRD consisting entirely of vague prose-goals ("the product should be stable"), loop indefinitely, and never satisfy a meaningful done-signal.

FAFF-253 defines the shape of the prd-readiness verdict and the contract that validates it. The forward-dependency was the L4 run-start orchestrator; `faff lights-out` (FAFF-225) now exists with a full run-start preflight. Both preconditions are satisfied.

**Principles:** deterministic gate-decision over a structured verdict (LLM judges, script validates); fail-safe toward refusal; L4-only; swappable behind a slot contract (configurable, not opinionated).

## 2. OUT OF SCOPE

- The deterministic contract (`faff contract prd-readiness`) — already shipped by FAFF-253
- `faff prd validate --strict` — FAFF-254
- `creative_licence` propagation INTO `faff prdr yagni --creative-licence` — FAFF-256 follow-on; this ticket stores the signal, not the downstream consumer
- Multi-container PRD admissibility (single container per run; multi-container is a follow-on)
- Adding `prd_admissibility` to `LIGHTS_OUT_GUARDRAILS` — the prd-admissibility check is a prose-layer step (requires an LLM invocation), not a CLI `--selftest`-probeable contract; it therefore does not join the 8-item guardrails array
- Changes to `faff lights-out --check` semantics — structural-preflight-only behaviour is preserved

## 3. WHAT

Three deliverables:

- **Slot-skill `faffter-noon-prd-validator`** — the LLM producer; occupies a new `prd_validator` slot. Reads a PRD document and emits one `faff-contract:prd-readiness` block.
- **Gateway slot entry** — `prd_validator` registered in `faff/SKILL.md`'s Slots table (default `faffter-noon-prd-validator`).
- **Run-start wiring** — a new Step 0a in beep-boop's L4 entry path (documented in `faff-beep-boop/SKILL.md`) and a `--prd-creative-licence` flag on `cmdLightsOut` to carry the verdict into the minted ledger.

## 4. HOW

### 4a. Packaging decision

**Chosen: new slot-skill (`faffter-noon-prd-validator`)** — the slot model. Every LLM producer in faff that emits a `faff-contract:*` block is a slot-skill; making it a slot preserves swappability.

### 4b. `faffter-noon-prd-validator` SKILL.md

A producer doing-skill. Non-user-invocable (`user-invocable: false`). Judgement seam: `prd-readiness`. Code-blind: input is ONLY the PRD document text (a file path). Rubric: stop-conditions verifiable? + creative_licence broad|tight. Emits exactly one `faff-contract:prd-readiness` block matching FAFF-253's `computePrdReadiness` schema.

**Assumes:** `faff contract prd-readiness` (FAFF-253) is the downstream consumer; the block schema matches its `computePrdReadiness` expectations.

### 4c. Run-start wiring (new Step 0a)

Prose-layer pre-step in beep-boop's L4 entry path, before `faff lights-out` mints the ledger. Sequence: resolve container (`faff prd list --json`) → resolve PRD path (`faff prd path <container>`) → validate slot liveness → invoke `prd_validator` slot → pipe its block to `faff contract prd-readiness` → PROCEED (admissible) / REFUSE-before-mint (not-ready / exit 1 / exit 2 / slot unreachable). No-PRD → skip Step 0a.

**`faff lights-out` CLI change:** add `--prd-creative-licence broad|tight` flag. Absent → `prd_creative_licence: null` in ledger. The selftest table gains one row each for `broad` and `tight`.

### 4d. creative_licence forward-carry

Stored in the run-ledger at mint time as `prd_creative_licence: "broad"|"tight"|null`. Wiring it into the YAGNI arbitration is the FAFF-256 follow-on.

### 4e. Gateway slot entry

New `prd_validator` slot entry added to `faff/SKILL.md`'s Slots table. Mirrors the `evaluator` entry: optional, default `faffter-noon-prd-validator`, swappable via `.faffrc`.

**Assumes:** `faff validate-adapters` recognises the new slot (verify during build — either already handles arbitrary `slots.*` entries, or needs a small allowlist addition).

## 5. Scenarios

- PRD with concrete Given/When/Then stop-conditions → validator emits `admissible` block → lights-out run proceeds, ledger carries `prd_creative_licence`.
- PRD with only vague prose goals → validator emits `not-ready`/`no-stop-conditions` → beep-boop REFUSES before minting, surfaces cause.
- No PRD file for the container (or no PRD at all) → Step 0a no-op, run proceeds without prd-admissibility gate.
- `prd_validator` slot unreachable → REFUSE before minting (fail-closed).
- Malformed block (bad verdict enum) → `faff contract prd-readiness` exit 2 → REFUSE.
- L3 run (not lights-out-minted) → Step 0a entirely skipped, L3 behaviour unchanged.

## 6. DONE

- `plugin/skills/faffter-noon-prd-validator/SKILL.md` — new slot-skill (`user-invocable: false`, `judgement_seam: prd-readiness`), rubric, output contract, `faff/SKILL.md` refer-back
- `plugin/skills/faff/SKILL.md` — `prd_validator` row added to Slots table
- `plugin/skills/faff-beep-boop/SKILL.md` — Step 0a (prd-admissibility pre-check, L4 only) documented before Step 1: tidy pass
- `plugin/skills/faff/bin/faff` — `cmdLightsOut` extended: `--prd-creative-licence broad|tight` flag; `prd_creative_licence` field in the minted ledger; `lightsOutSelftest` table updated
- ACs:
  - A lights-out run on a project with a valid PRD (verifiable stop-conditions) proceeds; minted ledger carries `prd_creative_licence`.
  - A lights-out run on a project with a vague PRD is refused before minting; run-ledger is never written; cause surfaces in `/faff-wtf`.
  - A lights-out run on a project with no PRD skips Step 0a and proceeds normally.
  - `faffter-noon-prd-validator` invoked with a sample PRD text emits a conformant `faff-contract:prd-readiness` block.
  - `faff validate-adapters` passes on the new skill.
  - L3 / plain beep-boop runs are unaffected (Step 0a is L4-only).

---

confidence: high
