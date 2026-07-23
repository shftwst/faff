# Eval evidence hygiene — strip the private tailnet host from the runbook and gate a release on a real frontier baseline

> Spec: faffter-dark-nlspec · 2026-07-22 · autonomous · confidence: high. Full spec on Linear FAFF-587.

This is the build spec for FAFF-587. Its audience is the build agent that will implement it and the human who reviews the PR. The ticket comes from the 2026-07-21 external adversarial critique (appendix row 16): the eval *mechanism* is sound, but its *evidence* leaks operator infrastructure and can't be reproduced by a stranger, and nothing forces a release to carry a real evidence claim.

## 1. WHY — Problem and Principles

**The load-bearing idea:** the eval harness already has the right seams — a required `FAFF_EVAL_LOCAL_BASE_URL` / `FAFF_EVAL_LOCAL_MODEL` env path (shipped in FAFF-132), a committed regression baseline, and a proportionate gate (FAFF-169/180). The gap is entirely in *evidence hygiene*: the runbook and the committed config hardcode a private Tailscale host, and the committed frontier baseline is self-declared PROVISIONAL with nothing tying a release to a real one. This change fixes the leak and adds the release-time evidence claim; it does **not** touch the harness mechanism.

**Problem statement.** `eval/README.md` and the committed `.faffrc.yaml` both hardcode the operator's private tailnet host `<operator-tailnet-host>:11434` — infrastructure leakage in a public repo, and examples a stranger can't run. Separately, `eval/baselines/frontier.json` is PROVISIONAL (seeded near-uniform 1.00, captured 2026-06-16, not swept), and no release step asserts a real baseline exists. This change routes the docs and config through the existing env-var / gitignored-overlay seams and adds a release-checklist step that requires the committed baseline to be non-PROVISIONAL and current before a release goes out.

**Design principles.**

- **Move the secret, don't just delete it.** The private host is operator-local, not throwaway — the fix relocates it to the gitignored local overlay (`.faffrc.local.yaml`) and the env vars, so the operator's setup still works while the public repo carries none of it. A relocation that leaves the destination un-gitignored is not a fix.
- **The release claim is a human gate, not a CI gate.** A real frontier sweep is a multi-hour, budgeted, human-supervised `claude -p` run (and today it is blocked on FAFF-319's oracle calibration). It cannot run in CI. So the evidence claim is a documented release-checklist step plus a cheap mechanical predicate a human runs — never an enforcing CI job that would either block every release or silently cost money.
- **Docs must be reproducible by a stranger.** Every example that names a host must name it via the env var, with the private value shown only as an operator aside, not baked into the command.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `eval/README.md` | Markdown | The runbook that hardcodes the host in JS snippets (:55, :63, :75) and shell examples (:104–113) |
| `.faffrc.yaml` (committed base) | YAML | Carries the private host at the `studio-ollama` backend (`host:` ~:65), referenced by the `faffter_dark.adversarial` review slot |
| `.faffrc.local.yaml` | YAML | The gitignored overlay the private host belongs in — but the repo `.gitignore` does not currently ignore it |
| `.gitignore` | gitignore | Ignores only `.claude/settings.local.json`; must also ignore the local overlay |
| `eval/run-evals.mjs` | JS | Resolves `--base-url`/`--model` → `FAFF_EVAL_LOCAL_BASE_URL`/`FAFF_EVAL_LOCAL_MODEL` → error (no localhost default); owns `--update-baseline` |
| `eval/baselines/frontier.json` | JSON | The committed baseline; `meta.source` carries the PROVISIONAL self-declaration |
| `.github/workflows/validate.yml` | YAML | Runs the size-gate (advisory) and the eval gate context; where a mechanical baseline-freshness assertion could later be pinned |

**Scope statement.** This is a docs + committed-config + release-process hygiene change to the `eval/` evidence surface; it changes no harness code path and no gate semantics.

## 2. OUT OF SCOPE

The scoping question the ticket raises has four candidate items. Two are in scope (host strip; release-checklist step); two are consciously separate:

- **The local eval gate always exits 0 on regression.** — Excluded. This is *intended* behaviour, not a defect: FAFF-180 designed the `local`/`smart→local` gate to be soft-advisory (a drift warning, never a build blocker), with the hard non-zero path reserved for `--driver frontier` (multi-hour, human-run). Making the local gate blocking, or wiring the frontier hard gate into CI, is a real design change with cost/latency tradeoffs — a separate decision from evidence hygiene. **Extension point:** a new ticket against `eval/run-evals.mjs` `gateSmart`/`gateLocal` and/or `.github/workflows/validate.yml` if the team later wants a blocking judgement gate.
- **The size-gate `--enforce` is commented out in `validate.yml`.** — Excluded. The comment there (`# flip to enforcing once the post-lean floor is calibrated`) marks a deliberate deferral pending floor calibration, and it concerns *prompt size*, not eval evidence — a different surface. **Extension point:** `.github/workflows/validate.yml` line ~233, a separate calibration ticket.
- **Recording the actual non-PROVISIONAL frontier baseline.** — Excluded from the *build*. The recorded sweep is a human-supervised, budgeted operator action (blocked today on FAFF-319's miscalibrated oracles and made tractable by FAFF-318's checkpointing). This ticket delivers the *wiring* — the release step and the mechanical predicate that will pass once a real baseline is committed — not the sweep itself. **Extension point:** the operator runs `node eval/run-evals.mjs --driver frontier --update-baseline eval/baselines/frontier.json` (per the release step this ticket adds); tracked upstream by FAFF-318 / FAFF-319.
- **The private host in test fixtures and historical design specs.** — Excluded. `test/eval-cli-driver.test.mjs`, `test/eval-ollama-model.test.mjs`, `test/backends.test.mjs`, and `plugin/skills/faff/bin/lib/backends.js` use the host as a `deriveEgress` tailnet-detection fixture; the frozen `docs/specs/*.md` records also mention it. Rewriting load-bearing test fixtures risks the tailscale-detection assertions and is not what a stranger reads to reproduce evidence. **Extension point:** a separate hygiene ticket could swap the fixtures to a generic `*.ts.net` placeholder (which preserves the `.ts.net`-suffix detection) — see the assumptions note.

## 3. WHAT — the surface that changes

No new types or interfaces. The change is a set of edits across four files plus one new doc.

**Reference: the env-var resolution the docs must use** (already shipped, `eval/run-evals.mjs`):

```
base_url := --base-url flag  ?? env FAFF_EVAL_LOCAL_BASE_URL  ?? error (no localhost default)
model    := --model flag     ?? env FAFF_EVAL_LOCAL_MODEL     ?? error
```

**Design decisions.**

**Where does the private host live after this change?**

- Options: (a) delete it outright from docs and config; (b) replace with a generic placeholder like `<your-ollama-host>:11434`; (c) relocate to the gitignored `.faffrc.local.yaml` overlay + reference the env var in docs.
- **Chosen:** (c) — relocate to `.faffrc.local.yaml` and reference `FAFF_EVAL_LOCAL_BASE_URL` in the docs, with a generic placeholder for illustration. This matches the ticket's stated intent ("keep the tailnet value in `.faffrc.local.yaml` where it already belongs") and keeps the operator's real setup working. Outright deletion (a) would break the operator's local backend; a bare placeholder (b) alone leaves the working value nowhere.

**The committed `.faffrc.yaml` also leaks the host — is that in scope?**

- The ticket's parenthetical assumes the value already lives in `.faffrc.local.yaml`; it does not — it is in the committed base at the `studio-ollama` backend, referenced by the `faffter_dark.adversarial` review slot's `refs` list. Leaving it there would leave the leak half-fixed.
- **Chosen:** relocate the `studio-ollama` backend block (its `host:` and the whole backend definition) and its entry in the `faffter_dark.adversarial.refs` list from `.faffrc.yaml` into `.faffrc.local.yaml`. The committed base keeps the two cloud-provider backends (`nvidia-glm`, `gemini-gemma`) whose only sensitive token is named via `api_key_env` (name only, never the value). Rationale: `studio-ollama` points at the operator's private tailnet and is unreachable for anyone else, so it is already a dead fallback entry in the public config — moving it to the overlay is strictly better and reversible.

**How does the overlay carry the full 3-entry `refs` list when the base has 2?**

- Config resolution deep-merges overlay over base, and **sequences replace wholesale** (per the gateway configuration contract) — a list in the overlay replaces the base list entirely, it does not append.
- **Chosen:** the operator's `.faffrc.local.yaml` carries the complete `faffter_dark.adversarial.refs` list (`nvidia-glm`, `gemini-gemma`, `studio-ollama`) plus the `studio-ollama` backend definition. The committed base carries the 2-entry list. So the operator gets all three via wholesale replacement; the public repo advertises only the two cloud backends. This is documented inline in the new `.faffrc.local.yaml` guidance so the operator knows the list is replace-not-merge.

**Is `.faffrc.local.yaml` gitignored today?**

- No — `.gitignore` ignores only `.claude/settings.local.json`. `git check-ignore .faffrc.local.yaml` reports it is **not** ignored. Relocating the host into an un-ignored file would just move the leak.
- **Chosen:** add `.faffrc.local.yaml` and `.faffrc.local.yml` to `.gitignore` as part of this change. This is load-bearing, not incidental — the gateway already documents the overlay as "gitignored", so this realigns the repo with its own contract.

**Where does the release-checklist step live, given no release doc exists?**

- Releases are automated via release-please (`release-please.yml`); there is no human release runbook today. Options: (a) a new `docs/guide/releasing.md`; (b) a section appended to an existing guide; (c) a comment block in `release-please-config.json`.
- **Chosen:** create `docs/guide/releasing.md` — a short release runbook whose first checklist item is the eval-evidence claim. `docs/guide/` is the established home for operator guides, and a dedicated file is discoverable and extensible as other release steps accrete. The release-please automation is unchanged; this is the human pre-release checklist that sits alongside it.

**Should the baseline-freshness check be mechanical or prose-only?**

- **Chosen:** both — a prose checklist item *and* a cheap one-line mechanical predicate the human runs, but **not** an enforcing CI job. The predicate reads `eval/baselines/frontier.json` `meta.source` and fails if it still contains `PROVISIONAL`. Documenting the exact command makes the check unambiguous and scriptable later; keeping it out of CI avoids blocking every release until the (separately-tracked) real sweep lands. No new CLI subcommand is added — that would be gold-plating; a documented `jq`/`node` one-liner suffices.

## 4. HOW — the edits

**`eval/README.md` — replace the hardcoded host with the env var.**

- The two JS snippets (`localOpts({ baseUrl: "http://studio…" })` at ~:55 and the `makeOllamaModel({ baseUrl: "http://studio…" })` at ~:63): change the literal to read from the env var, e.g. `baseUrl: process.env.FAFF_EVAL_LOCAL_BASE_URL` (and `model: process.env.FAFF_EVAL_LOCAL_MODEL` where a model literal appears), with a one-line aside that the operator sets these in their environment / `.faffrc.local.yaml`.
- The prose at ~:75 ("served over Tailscale") keeps the *explanation* but drops the specific hostname.
- The shell examples (~:104–113): drop the inline `--base-url http://studio… --model qwen3.6:27b-mlx` from the commands, relying on the already-documented `FAFF_EVAL_LOCAL_BASE_URL` / `FAFF_EVAL_LOCAL_MODEL` env resolution (the note at ~:115 already says this is allowed). Where an illustrative value helps, use a generic placeholder like `http://<your-ollama-host>:11434` / `<your-local-model>`, never the operator's real host.
- **Anti-pattern:** leaving one example with the real host "for concreteness". Why: a single leaked instance defeats the whole change; the census below must return zero hits in `eval/README.md`.

**`.faffrc.yaml` (committed base) — remove the `studio-ollama` backend + its ref.**

- Delete the `studio-ollama:` backend block (including the `host:` line) from the backends map.
- Remove the `- studio-ollama` entry from `faffter_dark.adversarial.refs`, leaving `nvidia-glm` and `gemini-gemma`.
- **Anti-pattern:** editing the rc file with a hand-rewrite that also touches unrelated keys. Why: the gateway's CLI-only-config rule and the committed-base drift alarm both assume minimal, reviewable diffs — change only the two `studio-ollama` sites.

**`.faffrc.local.yaml` (gitignored overlay) — receive the relocated host.**

- Add the `studio-ollama` backend block (with the real `host:`) and a `faffter_dark.adversarial.refs` list carrying all three refs, with an inline comment noting sequences replace wholesale (so the operator understands why the full list must be restated, not just the added entry).
- This file is gitignored (see the `.gitignore` edit) so it never enters the repo. If the file does not exist, create it; if it exists, merge these keys in.

**`.gitignore` — ignore the local overlay.**

```
PROCEDURE ensure_overlay_ignored:
  1. If `.faffrc.local.yaml` is not already matched by a .gitignore pattern:
     a. Append `.faffrc.local.yaml` and `.faffrc.local.yml`
  2. Verify with `git check-ignore .faffrc.local.yaml` → must now report a match
```

**`docs/guide/releasing.md` — new release runbook.**

- A short doc with a "Before cutting a release" checklist. The first item is the eval-evidence claim:
  - **Eval baseline is non-PROVISIONAL and current** — the committed `eval/baselines/frontier.json` reflects a real recorded frontier sweep, not the seeded placeholder. Check mechanically:

    ```
    node -e "process.exit(/PROVISIONAL/.test(require('./eval/baselines/frontier.json').meta?.source ?? '') ? 1 : 0)" \
      && echo "baseline OK (non-PROVISIONAL)" || echo "baseline still PROVISIONAL — run a real frontier sweep first"
    ```
  - When it fails, the remedy is named: an operator runs `node eval/run-evals.mjs --driver frontier --update-baseline eval/baselines/frontier.json` (a multi-hour, budgeted, human-supervised sweep; see `eval/README.md` and FAFF-318 / FAFF-319), reviews the numbers, and commits the refreshed baseline.
- Note explicitly that this step is a **human gate**, not CI-enforced, and why (a real sweep can't run in CI).

**Failure modes.**

- **The failure:** the relocation leaves the host reachable in git history or in another tracked file, so the "leak fixed" claim is false. **How you'd know:** the leak census (below — greps the in-scope files for the operator's own tailnet-host fragment, so the check itself embeds no secret) returns a hit in `eval/README.md`, `.faffrc.yaml`, or this spec file. **What it means:** not done — the census must be clean for all three in-scope files (this spec included: a new tracked file must not reintroduce the host it strips). The OUT-OF-SCOPE test fixtures and frozen historical design specs are the only surfaces where the host legitimately still appears.
- **The failure:** `.gitignore` edit lands but `.faffrc.local.yaml` was already `git add`-ed earlier, so it stays tracked despite the ignore. **How you'd know:** `git ls-files .faffrc.local.yaml` returns the path. **What it means:** the file must be `git rm --cached`-ed (it is not currently tracked — verified — so this is a guard, not an expected step).
- **The failure:** removing `studio-ollama` from the committed `refs` silently changes the adversarial-review fallback for a *fresh clone with no overlay*. **How you'd know:** a review run on a clean checkout finds only two backends. **What it means:** acceptable and intended — `studio-ollama` was never reachable off the operator's tailnet; the operator's overlay restores all three. Documented in the overlay guidance.

## 5. SCENARIOS

```
Given a fresh clone of the repo with no .faffrc.local.yaml
When a stranger greps the tracked eval runbook, committed config, and this build spec for the operator host
Then the leak census (a `git grep` for the operator's tailnet-host fragment over `eval/README.md`, `.faffrc.yaml`, and `docs/specs/2026-07-23-FAFF-587-eval-evidence-hygiene-design.md`) returns no matches
```

```
Given the relocated overlay file
When the repo's ignore rules are evaluated
Then `git check-ignore .faffrc.local.yaml` reports a match (the overlay cannot be accidentally committed)
```

```
Given the committed frontier.json is still the PROVISIONAL placeholder
When the release-checklist baseline predicate runs
Then it exits non-zero and prints the "run a real frontier sweep first" remedy
```

```
Given a stranger following eval/README.md's local-lane example with FAFF_EVAL_LOCAL_BASE_URL / FAFF_EVAL_LOCAL_MODEL exported
When they run the documented command
Then it resolves the base URL and model from the environment with no repo-embedded host required
```

## 6. DESIGN DECISION RATIONALE

- **Relocate rather than delete the host** — **Chosen:** move to `.faffrc.local.yaml` + env var. Keeps the operator working; removes the public leak. (Rejected: outright delete breaks local setup; bare placeholder loses the real value.)
- **Include the committed `.faffrc.yaml` leak in scope** — **Chosen:** yes. The info-leak theme is incomplete otherwise, and the ticket's own framing wants the value confined to the overlay. (Rejected: docs-only fix leaves the committed base leaking.)
- **Add `.faffrc.local.yaml` to `.gitignore`** — **Chosen:** yes, load-bearing. Relocating into an un-ignored file just moves the leak; the gateway already treats the overlay as gitignored.
- **Release evidence as a documented human gate + mechanical predicate, not CI** — **Chosen:** yes. A real frontier sweep can't run in CI (cost, hours, human supervision, FAFF-319 dependency). (Rejected: enforcing CI job would block every release or silently spend budget.)
- **Exclude the eval-gate-exits-0 and size-gate-`--enforce` items** — **Chosen:** separate. Both are intended/deferred design states on different surfaces, not evidence-hygiene defects.
- **Exclude the recorded-sweep itself from the build** — **Chosen:** deliver the wiring, name the operator action. Recording is human-supervised and blocked on FAFF-319; the spec producer's own eval-coverage rule confirms "recording/accepting the baseline value is a separate human-supervised step".

At the time of writing, `eval/baselines/frontier.json` is PROVISIONAL (captured 2026-06-16, 14 of 27 kinds, seeded 1.00); revisit the release predicate's expectations once a real sweep is committed.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — the scoping calls above are all resolved.

**Assumptions:**

- **Assumes:** `.faffrc.local.yaml` is not currently tracked by git (verified: `git ls-files` returns only `.faffrc.yaml`). Validate before relying on the `.gitignore` edit alone: run `git ls-files .faffrc.local.yaml`; if it returns the path, `git rm --cached` it as well.
- **Assumes:** config resolution merges sequences by wholesale replacement (per the gateway configuration contract). Validate by reading the gateway's Configuration → two-file model section; if it ever changes to append semantics, the overlay's `refs` list guidance must change accordingly.

## 8. DONE — Definition of Done

### From WHY / info-leak
- [ ] The leak census over **all three** in-scope tracked files — the runbook, the committed config, **and this build spec** (a new tracked file must not reintroduce the host it strips) — returns zero matches. The census names no secret; it greps for the operator's own tailnet-host fragment supplied out-of-band:

  ```sh
  frag="${OPERATOR_TAILNET_FRAG:?export your tailnet-host fragment, e.g. the machine/tailnet name}"
  git grep -nF "$frag" -- \
    eval/README.md .faffrc.yaml docs/specs/2026-07-23-FAFF-587-eval-evidence-hygiene-design.md
  # → zero matches (the host lives only in the gitignored .faffrc.local.yaml overlay)
  ```
- [ ] `.faffrc.yaml` no longer defines the `studio-ollama` backend and `faffter_dark.adversarial.refs` lists only `nvidia-glm`, `gemini-gemma`

### From WHAT / overlay + gitignore
- [ ] `.gitignore` matches `.faffrc.local.yaml` and `.faffrc.local.yml`; `git check-ignore .faffrc.local.yaml` reports a match
- [ ] `.faffrc.local.yaml` (gitignored, not committed) carries the `studio-ollama` backend with the real host and the full 3-entry adversarial `refs` list, with an inline note that sequences replace wholesale
- [ ] `git ls-files .faffrc.local.yaml` returns nothing (the overlay is not tracked)

### From WHAT / docs reproducibility
- [ ] `eval/README.md` JS snippets and shell examples reference `FAFF_EVAL_LOCAL_BASE_URL` / `FAFF_EVAL_LOCAL_MODEL` (or a generic `<your-ollama-host>` placeholder), never the operator's real host
- [ ] The local-lane example is runnable by a stranger who has exported the two env vars, with no repo-embedded host

### From HOW / release checklist
- [ ] `docs/guide/releasing.md` exists with a "Before cutting a release" checklist whose first item is "Eval baseline is non-PROVISIONAL and current"
- [ ] That item documents the mechanical predicate (reads `frontier.json` `meta.source`, fails on `PROVISIONAL`) and the operator remedy (`--update-baseline` frontier sweep), and states it is a human gate, not CI-enforced

### Integration smoke test
```
1. On a clean worktree, leak census over the three in-scope files (runbook, config, this spec):
     frag="${OPERATOR_TAILNET_FRAG:?}"; git grep -nF "$frag" -- \
       eval/README.md .faffrc.yaml docs/specs/2026-07-23-FAFF-587-eval-evidence-hygiene-design.md   → no output
2. `git check-ignore .faffrc.local.yaml`                                              → prints the path
3. run the frontier.json PROVISIONAL predicate                                        → exits non-zero today (baseline still seeded), printing the remedy
```

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" },
    { "marker": "assumes" }
  ] }
```

## Methodology critique

Agile-delivery lens (`faffter-dark-methodology-agile-delivery`), issue-level:

- **Right-sized?** Mild tension. The ticket bundles two separable concerns — the info-leak host strip and the release-checklist evidence step — that do not strictly always-ship-together. Both are small (docs + config + one new doc, comfortably under a day combined) and share the "eval evidence hygiene" outcome, so keeping them as one unit is defensible rather than a split mandate. If the release step grows (e.g. a real CI predicate), split it out then.
- **Workstream fit?** Good. Cohesive under the eval-evidence-hygiene outcome; the OUT-OF-SCOPE section keeps the boundary tight (eval-gate-exits-0 and size-gate `--enforce` correctly deferred as separate surfaces).
- **Deps surfaced?** Adequate. The buildable scope has no hard blockers. The excluded recorded-sweep depends on FAFF-319 (oracle calibration) and FAFF-318 (checkpointing) — both already linked as related issues and correctly scoped out, so no missing blocker edge for the work this ticket ships.
- **Risk profile?** Low. Docs + committed-config relocation + a new guide doc, fully reversible via PR. No novel integration or external dependency; no de-risking spike warranted.
