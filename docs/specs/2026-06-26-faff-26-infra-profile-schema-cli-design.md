# FAFF-26 — Infra profile: schema + `faff profile` CLI (slice 1 of 2)

> Spec: faffter-dark-nlspec · 2026-06-26 · interactive · confidence: medium. Full spec on Linear FAFF-26.

> Slice 1 of 2. The **repo-mining acquirer** is FAFF-231 (slice 2, blockedBy this). This slice ships the schema + `faff profile` CLI only.

Build spec for FAFF-26 slice 1. It defines the **infra profile** — a structured record of a repo's infra world — as a fixed, CLI-validated contract, plus the read path that layers a human override over it. It does **not** acquire a profile (that's an acquirer's job — first acquirer is FAFF-231).

## 1. WHY — Problem and Principles

**The load-bearing idea:** the *schema* is the product, not the acquirer. Everything downstream in the L4 substrate spine (generative architecture FAFF-27, env/data fabric FAFF-30) needs a stable, machine-readable answer to *"what is this team's infra world?"*. Fix the shape of that answer and validate it, and how it gets populated becomes a swappable detail behind a `profile` slot. This slice ships only the contract + CLI; it is independently valuable — a profile can be hand-authored, validated, and read the moment it lands.

**Design principles:**
- **The schema is the contract; the acquirer is a slot.** Schema defined + validated by the `faff` CLI (deterministic-tools-over-prose, like `faff contract`). Acquisition is a separate slot (slice 2).
- **Human intent outranks machine inference.** The profile is a human-editable control surface (FAFF-19); a config-asserted value wins over an inferred one. Resolves the conflict-authority question.
- **Degrade cleanly on absence.** "No profile yet" and "sparse profile" are valid states, never errors.

## 2. OUT OF SCOPE
- **The repo-mining acquirer (and any acquirer)** → FAFF-231. This slice defines the schema an acquirer emits and the CLI that validates it; it ships no miner.
- **Intake-Q&A / learned-over-projects acquisition** — later `profile`-slot occupants.
- **Multi-mode conflict merge** — only the human-override-vs-stored conflict is in scope.
- **Re-acquire-on-drift trigger.**
- **Downstream consumers (FAFF-27, FAFF-30)** — they read via `faff profile show`.
- **Live PaaS-MCP availability probing** — v1 records only a declared/stored `paas_available` list.

## 3. WHAT — schema, storage, decisions

**The profile schema** (every field optional unless marked; a sparse profile is valid):

```
RECORD InfraProfile:
  schema: int                 # currently 1; REQUIRED
  acquired_at: Timestamp      # ISO-8601, set by the acquirer; REQUIRED
  acquired_by: string         # acquirer slot name; REQUIRED
  repo: string                # org/repo slug if resolvable, else ""
  runtimes: List<Runtime>     # {name, version, evidence}
  ci: List<CISystem>          # {name, evidence}
  deploy_targets: List<DeployTarget>   # {kind, evidence}
  datastores: List<Datastore> # {kind, evidence}
  paas_available: List<string>
  prefs: Map<string, string>  # override block only
  notes: List<string>

CONSTRAINT schema == 1
CONSTRAINT acquired_at, acquired_by, schema all present
CONSTRAINT every list element with an `evidence` field has non-empty evidence WHEN the entry is acquirer-sourced (mined)
CONSTRAINT runtimes/ci/deploy_targets/datastores elements carry their required key (name / kind)
```

**Storage + override:**
- **Stored profile** → `.faff/infra-profile.json` (per-repo, machine-owned, regenerable, gitignored). Written by an acquirer (slice 2); this slice only reads it.
- **Human override** → optional `infra:` block in `.faffrc.yaml` (hand-authored, versioned, the FAFF-19 control surface).
- **Effective profile** = stored ⊕ override, override winning **field-by-field**, computed on read, never persisted back.

**Decisions:**
- **Chosen:** storage split — `.faff/infra-profile.json` (machine) + `.faffrc.yaml infra:` (human override), effective computed on read with override winning. (Matches faff's `.faffrc`=human / `.faff/`=machine split; answers human-editability + conflict-authority.)
- **Chosen:** validation in the `faff` CLI (`faff profile validate`), mirroring `faff contract <name>` — deterministic, dependency-free, `node --test`-covered.
- **Chosen:** the acquirer↔CLI contract — an acquirer emits a `faff-contract:infra-profile` block; the orchestrator validates via `faff profile validate` and writes `.faff/infra-profile.json`. This slice owns the validate side; the emitter is FAFF-231.
- **Chosen:** field-wholesale override (human wins per field) — predictable + auditable; finer merge deferred.
- **Punt:** the exact field set FAFF-27/30 will consume. Superset believed sufficient; schema is versioned + additive, so growth is non-breaking. A human should confirm adequacy before downstream build.

## 4. HOW — Behavior

Two CLI surfaces under a new top-level `faff profile` command, no skill:

1. **`faff profile validate`** — reads a profile JSON (stdin or `--file PATH`), checks schema + constraints, exits `0` valid / `1` invalid-with-reasons / `2` malformed-input. Matches `faff contract`'s convention.
2. **`faff profile show`** — reads `.faff/infra-profile.json` (if present) + the `.faffrc.yaml infra:` override, prints the **effective** profile JSON. Exit `3` when no profile exists (mirrors `config path` absent).

```
PROCEDURE validate(input):
  parse JSON; on parse error → exit 2 ("malformed profile input")
  violations := []
  - schema != 1 → violation
  - missing any of {schema, acquired_at, acquired_by} → violation
  - any acquirer-sourced list entry with empty `evidence` → violation
  - any runtimes/ci/deploy_targets/datastores element missing its required key → violation
  IF violations: print them; exit 1
  exit 0

PROCEDURE show():
  stored   := read_json(".faff/infra-profile.json")   # absent → {}; malformed → exit 2
  override := structured read of `.faffrc.yaml` infra: # absent → {}
  IF both absent: exit 3 ("no infra profile; run acquisition")
  effective := stored
  FOR each field in override: effective[field] := override[field]   # wholesale per field
  IF override non-empty: effective.notes += "override applied: <fields>"
  print effective as JSON; exit 0
```

**Override read (the folded-in dependency):** `faff config get` stringifies objects (`[object Object]`), so a **structured read** is added — `faff config get --json <key>` prints `JSON.stringify(value)` (and `null`/exit 3 when absent). `faff profile show` uses it to read the `infra:` block.

**Edge cases:**
- No stored + no override → `show` exit 3 (not an error).
- Stored file malformed JSON → `validate`/`show` exit 2 (fail-loud, never silently empty).
- Override present, no stored file → effective = override alone.
- Sparse/empty profile (lists empty, required fields present) → validates (exit 0).

**Anti-pattern:** deep-merging stored + override lists element-by-element — hides human intent. v1 overrides at field granularity (a human's `datastores:` *replaces* the stored one).

## 5. SCENARIOS
- Valid profile (schema:1 + required fields + evidenced runtime) → `validate` exit 0.
- Profile missing `acquired_by`, or acquirer-sourced entry with empty evidence → `validate` exit 1, names the violation.
- Stored datastores [postgres] + `.faffrc.yaml infra: { datastores: [mongo] }` → `show` effective datastores == [mongo], "override applied" note.
- Malformed `.faff/infra-profile.json` → exit 2 (fail-loud).
- No stored + no override → `show` exit 3.
- Non-functional: `faff profile validate|show` deterministic + dependency-free, runs under `node --test` offline.

## 6. DONE
- [ ] `faff profile validate` exits 0/1/2 per the rules; missing required field → 1; bad evidence → 1; `schema != 1` → 1; malformed input → 2.
- [ ] `faff profile show` prints effective (stored ⊕ override) profile; exit 3 when none; override wins per field with "override applied" note.
- [ ] `faff config get --json <key>` returns structured JSON (and the `infra:` override is read via it).
- [ ] `.faff/infra-profile.json` is the stored location; `.faffrc.yaml infra:` is the override.
- [ ] All scenarios pass under `node --test`, offline.

**Punt (for human review before downstream build):** schema sufficiency for the unstarted FAFF-27/30 — versioned + additive mitigates.
