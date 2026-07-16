# Authoring and admitting a PRD leash (external-verification SUTs)

A SUT keeps a **hand-authored root `PRD.md`** as the human setpoint. That file is **not** a
`faff prd` record — `faff prd` (`path | new | link | list | validate [--strict]`) manages the
`docs/prd/` container namespace and structurally cannot see a root-level file. The correct
admission mechanism for a setpoint *file* is the **`prd` slot → `faff-contract:prd-readiness`
contract**, which takes a PRD file's *content*, not a container slug.

## What NOT to run (removed / never existed)

- A `prd new` invocation carrying a **`--from` flag**, pointed at an existing file (e.g.
  `PRD.md`) — **wrong on three counts**: `new` takes a `<container>` slug positional, no
  `--from` flag exists on it, and it scaffolds a *fresh template* into `docs/prd/<slug>.md`
  rather than ingesting an existing file.
- An **`admit` verb under `prd`** — no such subcommand exists. (`admit` lives on `prdr`, for a
  PRDR *record* — a different object.)

## The current verb surface

- `faff prd path|new|link|list|validate [--strict]` — the `docs/prd/` **container-record**
  namespace. Not what admits a root `PRD.md`.
- `faff prdr path|new|list|supersede|validate|admit|yagni|coverage` — the PRDR **admission +
  coverage** namespace: `prdr admit <prdr-id> --actor loop|human --supersedes-provenance
  human|loop|none` (the two-gate admission verdict, report-only — exit 0 either way, the
  disposition is in the payload); `prdr coverage --prd-goals '<JSON array>' --dod-verdicts
  '<JSON object>'` (the lower-gate coverage roll-up — **`--prd-goals` is parser-optional but
  semantically load-bearing**: omit it and `coverage` silently defaults to an empty goal set and
  reports vacuous "covered": true).
- `faff-contract:prd-readiness` — the block a `prd`-slot occupant (default `faffter-noon-prd`)
  emits after reading a PRD **file's content**: `{ verdict: admissible|not-ready, reason,
  stop_conditions_verifiable, creative_licence: broad|tight }`. Pipe it to `faff contract
  prd-readiness`: exit 0 + `admissible` → proceed; exit 0 + `not-ready`, or exit 1/2 (violations /
  fail-loud) → refuse. This is what actually gates a PRD as-a-file — it never touches `docs/prd/`.

## Two admission paths, by level

- **L4 lights-out (`/faff-beep-boop --converge`) — the automatic gate.** faff-beep-boop step 0a
  (`faff-beep-boop/SKILL.md` → *0a. PRD-admissibility pre-check*) resolves a container via `faff
  prd list --json`, gets its path via `faff prd path <container>`, invokes the `prd` slot on that
  file, and pipes the block to `faff contract prd-readiness` — refusing the run on `not-ready`.
  **This resolution is `docs/prd/`-scoped** (confirmed against `prd.js`: `prdDir()` always joins
  the configured `tracking.prd_docs_path`, default `docs/prd`). A bare root `PRD.md` is invisible
  to it — `faff prd list --json` returns zero entries for a SUT that only has a root file, which
  step 0a treats as the **no-PRD case** (skip, no gate fires) rather than admit/refuse.
  **P2 (FAFF-524, post this doc's original writing):** registered — its PRD now lives at
  `docs/prd/task-api.md` with a `- **Container:** task-api` line matching `tracking.container` in
  `.faffrc.yaml`, so `faff prd list` sees it and the automatic gate fires for real on a P2
  lights-out run. **P4** stays on the manual path below — it runs interactively (gated, autonomous
  OFF by construction), so the L4 auto-gate never fires for it regardless of registration, and its
  root `PRD.md` is left untouched (out of scope for FAFF-524, which only registered P2).
- **Any level — the manual path.** Invoke the `prd` slot directly against `PRD.md` (no `docs/prd/`
  involvement at all — the slot just reads the file's content) and pipe its block to `faff contract
  prd-readiness` by hand. This is the one every SUT can run today, and it's what a PRD's
  Stop-conditions are actually checked against. If a PRDR *record* is also wanted (tracking
  the two-gate admission decision itself, not just readiness), `faff prdr admit <prdr-id> --actor
  human|loop --supersedes-provenance human|loop|none` records that.

## Sanity-checked verbs (this doc's own commands, run against the live CLI)

Every verb this doc recommends was run against the live CLI while authoring it:

```
$ faff prd path task-api
docs/prd/task-api.md

$ faff prd validate --strict
OK — 0 PRD(s) in docs/prd valid (strict: born-verifiable).

$ faff prdr admit p2-i1 --actor human --supersedes-provenance none
{"disposition":"admit", ...}

$ faff prdr coverage --prd-goals '["..."]' --dod-verdicts '{}'
{"covered":true, ...}

$ echo '{"verdict":"admissible","reason":"","stop_conditions_verifiable":true,"creative_licence":"broad"}' \
  | faff contract prd-readiness
(exit 0)
```

(The two commands under "What NOT to run" above were also run against the live CLI, each
confirmed to error exactly as described — a positional-argument error and an unrecognised-verb
error respectively — which is *why* they're listed here as removed/never-existed.)
