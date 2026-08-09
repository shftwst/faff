# Strip the operator's private tailnet host from the external-verification scaffolders

> Spec: faffter-dark-nlspec · 2026-07-24 · autonomous · confidence: high. Full spec on Linear FAFF-618.

This is the build spec for FAFF-618. Its audience is the build agent that implements it and the human who reviews the PR. The ticket is discovered scope from FAFF-587's autonomous build: that ticket stripped the same private host from the eval evidence surface but never reached the four SUT scaffolders, so the host is still one `git grep` away in a public repo.

## 1. WHY — Problem and Principles

**The load-bearing idea:** FAFF-587 already built the seam this needs — a gitignored `.faffrc.local.yaml` overlay that carries operator-private config, plus the `FAFF_EVAL_LOCAL_BASE_URL` env var that holds the host value. The scaffolders were simply outside its scope. So this is not new mechanism; it is applying the established pattern to four more files. The overlay is deep-merged over the committed base (`config.js` / `shared-infra.js`): maps merge per-leaf, sequences are replaced wholesale by the overlay — the fact the fix turns on.

**Problem statement.** Each of `scaffold-faff-lab.sh`, `scaffold-p1-link-shortener.sh`, `scaffold-p2-task-api.sh`, and `scaffold-p3-landing-page.sh` writes a `.faffrc.yaml` into a fresh SUT via a quoted heredoc, and that heredoc hardcodes the operator's tailnet host `studio.longhair-escalator.ts.net:11434` on the `ollama-local` backend. A stranger cloning the faff repo finds it via `git grep longhair-escalator verification/external-verification/*.sh`. This change relocates that host to the same gitignored overlay + env-var path FAFF-587 established, so the scaffolders carry no operator host and still produce a working config when the operator supplies the host.

**Design principles.**

- **Move the host, don't just delete it.** The tailnet host is operator-local, not disposable — the operator scaffolds these SUTs on the machine that reaches it. The fix relocates it to the gitignored `.faffrc.local.yaml` overlay written from `FAFF_EVAL_LOCAL_BASE_URL`, so the operator's runs still work while the committed scaffolder carries none of it. A relocation that leaves the value nowhere would break the operator's local backend.
- **The overlay's gitignoring must not depend on a best-effort CLI call.** P1/P2/P3 already run `faff gitignore-ensure`, but it is called `2>/dev/null && … || echo unavailable` — best-effort, and skipped entirely by faff-lab. Since the overlay holds an operator secret, each scaffolder's own `.gitignore` heredoc must list it directly, so the secret is ignored by construction whether or not the faff CLI is on PATH.
- **A fresh clone with no overlay must still be valid.** Mirror FAFF-587: the committed base advertises only the two cloud backends and a two-item refs list. Nobody but the operator runs these SUTs against these backends, so dropping the third from the committed default costs nothing and keeps the base self-consistent.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `verification/external-verification/scaffold-faff-lab.sh` | bash | Host at ~:113; `.gitignore` heredoc at :46; no `gitignore-ensure` (commits `.faff/`) |
| `verification/external-verification/scaffold-p1-link-shortener.sh` | bash | Host at ~:90; calls `gitignore-ensure` at :223 |
| `verification/external-verification/scaffold-p2-task-api.sh` | bash | Host at ~:92; refs list at :100–103 |
| `verification/external-verification/scaffold-p3-landing-page.sh` | bash | Host at ~:84; refs list at :92–95 |
| `.faffrc.local.yaml` (per-SUT, gitignored) | YAML | The overlay each scaffolder writes from `FAFF_EVAL_LOCAL_BASE_URL`; canonical name per `shared-infra.js` `CANONICAL_OVERLAY_CONFIG` |
| `plugin/skills/faff/bin/lib/config.js` | JS | `resolveConfig` deep-merges overlay over base; maps per-leaf, sequences replaced wholesale |
| root `.faffrc.yaml` + `.gitignore` (post-FAFF-587) | YAML | The end-state shape to mirror: base drops the operator backend, overlay restates the full refs list |

**Scope statement.** A docs-surface info-leak hygiene change to four scaffolder scripts; it changes no harness code path, no CLI, and no gate.

## 2. OUT OF SCOPE

- **`scaffold-p4-stripe-testmode.sh` and `scaffold-p5-brownfield.sh`.** — Excluded: neither defines an `ollama-local` backend, so neither carries the host (confirmed by grep). Nothing to strip. **Extension point:** if either later gains a local ollama backend, apply this same overlay block to it.
- **The host in test fixtures and frozen design specs.** — Excluded, exactly as FAFF-587 carved out: `test/*.mjs`, `plugin/skills/faff/bin/lib/backends.js`, and the frozen `records/specs/*.md` use the host as a tailnet-detection fixture or a historical record. The acceptance grep is scoped to `verification/external-verification/*.sh`, so these are untouched. **Extension point:** a separate hygiene ticket could swap the fixtures to a generic `*.ts.net` placeholder that preserves the suffix-detection assertions.
- **Changing the eval-surface fix FAFF-587 shipped.** — Excluded: `eval/README.md` and the root `.faffrc.yaml` are already clean. This ticket only extends the same pattern to the scaffolders. **Extension point:** none needed — FAFF-587 is Done.

## 3. WHAT — the surface that changes

No new types or interfaces. The change is a repeated edit to four bash scripts. Two reference facts govern it:

**The env-var the overlay is written from** (already shipped, holds the full URL including scheme + port):

```
FAFF_EVAL_LOCAL_BASE_URL = http://studio.longhair-escalator.ts.net:11434   # operator's shell / .faffrc.local.yaml
```

It maps directly onto the backend `host:` field — no reconstruction, the value is the host line verbatim.

**The overlay merge the base + overlay split relies on** (`config.js` `resolveConfig` → `deepMergeConfig`):

```
merged := deepMerge(base = .faffrc.yaml, overlay = .faffrc.local.yaml)
  # maps merge per-leaf: overlay `backends.ollama-local` is ADDED alongside the base's two cloud backends
  # sequences replace wholesale: overlay `faffter_dark.adversarial.refs` REPLACES the base's two-item list
```

**Design decisions.**

**How is the host supplied to the scaffolded SUT?**

- Options: (a) inline-expand `$FAFF_EVAL_LOCAL_BASE_URL` into the committed `.faffrc.yaml` heredoc (switch it to an unquoted heredoc); (b) drop the host from the committed base and write it into a gitignored `.faffrc.local.yaml` overlay from the env var, mirroring FAFF-587.
- **Chosen:** (b). Option (a) would put the operator's host straight back into the SUT's *committed* `.faffrc.yaml` — and faff-lab commits its config as a public gallery repo, so that just relocates the leak into a second public repo. (b) keeps every committed file clean and matches the pattern the ticket explicitly names.

**What does the committed base `.faffrc.yaml` heredoc carry for the ollama backend?**

- Options: (a) keep `ollama-local` in the base with a placeholder host and let the overlay override just the `host:`; (b) drop `ollama-local` from the base's `backends:` and `refs:` entirely, and have the overlay add the backend and restate the full three-item refs list.
- **Chosen:** (b) — mirror FAFF-587's root-config end-state exactly. Under (a) a fresh clone with no overlay would carry an `ollama-local` in its refs chain pointing at a placeholder host — a broken backend in the adversarial fallback. Under (b) the base is self-consistent with two working cloud backends, and because sequences replace wholesale, the overlay's three-item refs list cleanly restores all three when the operator has the env var set.

**Where is the overlay gitignored?**

- Options: (a) rely on the existing best-effort `faff gitignore-ensure` call in P1/P2/P3 (and add nothing to faff-lab); (b) add the overlay to each scaffolder's own `.gitignore` heredoc directly.
- **Chosen:** (b). The overlay holds an operator secret; its gitignoring must not hinge on whether the faff CLI happens to be on PATH at scaffold time (the call is `|| echo unavailable`), and faff-lab runs no such call at all. Listing `.faffrc.local.yaml` in each `.gitignore` heredoc makes each scaffolder self-contained. The existing `gitignore-ensure` call stays as belt-and-braces where present.

**What happens when `FAFF_EVAL_LOCAL_BASE_URL` is unset at scaffold time?**

- Options: (a) fail the scaffold loudly; (b) warn and skip the overlay, leaving the valid two-backend base.
- **Chosen:** (b) — matches the scaffolders' existing degrade-and-warn behaviour for a missing `.env.claude-box` (they warn that the adversarial backend will refuse until it is supplied, and carry on). A missing env var leaves the SUT with a working two-backend config and a clear warning that the local ollama backend is unavailable until the operator exports the host and re-scaffolds or writes the overlay by hand. Failing hard would block a stranger from scaffolding at all, which the ticket's "still produces a working `.faffrc`" acceptance forbids.

## 4. HOW — Behavior

Each of the four scaffolders gets the same three edits, adapted to that file's existing text.

**Edit 1 — the base `.faffrc.yaml` heredoc.** Remove the `ollama-local:` entry from `backends:` and remove `- ollama-local` from `faffter_dark.adversarial.refs:`. Replace the deleted backend with a short comment mirroring the root config's, explaining that the operator's ollama backend is relocated to the gitignored `.faffrc.local.yaml` overlay and that the overlay's refs list restates all three (sequences replace wholesale). The literal host string must not survive anywhere in the heredoc.

**Edit 2 — the `.gitignore` heredoc.** Add `.faffrc.local.yaml` (the canonical overlay name) so the operator secret is ignored by construction. For faff-lab this is the only place it is ignored; for P1/P2/P3 it complements the existing `gitignore-ensure` call.

**Edit 3 — write the overlay, guarded on the env var.** Immediately after the base `.faffrc.yaml` is written, add a guarded block. Because the base heredoc is quoted (no expansion), the overlay is written by its own unquoted heredoc so `${FAFF_EVAL_LOCAL_BASE_URL}` interpolates:

```
PROCEDURE write_local_overlay(model_id):
  1. IF FAFF_EVAL_LOCAL_BASE_URL is set and non-empty:
       a. write .faffrc.local.yaml containing:
            backends:
              ollama-local:
                provider: ollama
                model: <this SUT's model_id>
                host: ${FAFF_EVAL_LOCAL_BASE_URL}
                auth: none
                egress: local
            faffter_dark:
              adversarial:
                refs:                      # sequence — replaces the base two-item list wholesale
                  - nvidia-glm
                  - gemini-gemma
                  - ollama-local
       b. echo that the local ollama backend overlay was written (host from env, gitignored)
  2. ELSE:
       a. echo a WARNING: FAFF_EVAL_LOCAL_BASE_URL unset — the SUT runs with the two cloud
          backends only; export it and re-scaffold (or hand-write .faffrc.local.yaml) to add
          the local ollama backend.
```

The model id per SUT is the value currently on that scaffolder's `ollama-local.model` line — carried into the overlay verbatim so the backend definition moves wholesale, nothing about it changes but its location.

**Anti-pattern:** switching the base `.faffrc.yaml` heredoc to unquoted to interpolate the host inline. Why: it reintroduces the host into the committed config (and faff-lab commits that config publicly), and unquoting risks other `$`-bearing lines in that large heredoc expanding unexpectedly. Keep the base heredoc quoted; interpolate only in the small overlay heredoc.

**Failure modes.**

- **The failure:** the host survives in a second heredoc in the same file (a RUNBOOK or BRIEF block) so the leak-census still hits. **How you'd know:** `git grep longhair-escalator verification/external-verification/*.sh` returns a hit after the edits. **What it means:** not done — the grep is the acceptance; every occurrence in the four files must go (grep confirms today the only occurrence per file is the `host:` line, so this is a guard, not an expected extra edit).
- **The failure:** the overlay is written but not ignored, so a scaffolded SUT commits the operator host. **How you'd know:** in a freshly scaffolded SUT, `git check-ignore .faffrc.local.yaml` prints nothing, or `git status` shows it staged. **What it means:** the `.gitignore` heredoc edit did not land; the overlay must be ignored by construction.
- **The failure:** the overlay adds `ollama-local` but the refs list still reads two items (base not restated), so the adversarial chain never reaches the local backend. **How you'd know:** in a scaffolded SUT with the env set, `faff adversarial-backends` (or `faff config`) resolves only two backends. **What it means:** the overlay must restate the full three-item refs list, since sequences replace rather than append.

## 5. SCENARIOS

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a clone of the faff repo
When a stranger greps the four scaffolders for the operator host
Then `git grep longhair-escalator verification/external-verification/*.sh` returns no matches
```

```
Given FAFF_EVAL_LOCAL_BASE_URL is exported to the operator's tailnet host
When scaffold-p2-task-api.sh runs
Then the produced SUT has a gitignored .faffrc.local.yaml carrying host: <that URL>, git check-ignore prints its path, and the merged config resolves the three-backend adversarial chain including ollama-local at that host
```

```
Given FAFF_EVAL_LOCAL_BASE_URL is unset
When any of the four scaffolders runs
Then it prints a warning, writes no overlay, and the produced .faffrc.yaml is a valid two-cloud-backend config the SUT can run with
```

## 6. DESIGN DECISION RATIONALE

**How is the host supplied to the SUT?** Inline-expand into the committed config, or relocate to a gitignored overlay from the env var. **Chosen:** relocate to the overlay — inline-expansion re-commits the host, and faff-lab commits its config publicly.

**What does the base carry for the ollama backend?** Keep it with a placeholder host, or drop it from base backends + refs and restate in the overlay. **Chosen:** drop and restate — a fresh clone with no overlay stays self-consistent on two working backends, and wholesale-sequence-replace cleanly restores all three. This is FAFF-587's committed end-state, reused verbatim.

**Where is the overlay gitignored?** Best-effort `gitignore-ensure`, or the scaffolder's own `.gitignore` heredoc. **Chosen:** the `.gitignore` heredoc — an operator secret must not depend on a best-effort CLI call, and faff-lab runs none.

**Env var unset at scaffold time.** Fail, or warn-and-skip. **Chosen:** warn-and-skip — matches the existing `.env.claude-box`-missing behaviour and satisfies "still produces a working `.faffrc`".

At the time of writing, `FAFF_EVAL_LOCAL_BASE_URL` carries the full `http://host:port` URL, so it drops straight onto the backend `host:` field; if that env contract ever splits scheme/host/port, the overlay heredoc would need to recompose it.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — the pattern, the base/overlay split, the gitignore placement, and the unset-env behaviour are all settled against FAFF-587's shipped precedent.

**Assumptions:**

- **`FAFF_EVAL_LOCAL_BASE_URL` holds the full `http://host:port` URL.** Validate: `eval/run-evals.mjs` and `eval/README.md` (post-FAFF-587) resolve the ollama base URL from exactly this env var as a full URL; confirm before writing the overlay `host:` line.
- **The canonical overlay filename faff reads is `.faffrc.local.yaml`.** Validate: `shared-infra.js` `CANONICAL_OVERLAY_CONFIG` — confirmed `.faffrc.local.yaml`; the legacy names (`.faffrc.local.yml`, `.faffrc.local`) are accepted for read but the scaffolder writes only the canonical name.
- **The host appears once per file, on the `ollama-local.host` line.** Validate: `git grep -n longhair-escalator verification/external-verification/*.sh` before editing — confirmed four hits, one per file.

## 8. DONE — Definition of Done

### From WHY / info-leak
- [ ] `git grep longhair-escalator verification/external-verification/*.sh` returns zero matches.
- [ ] None of the four scaffolders' committed `.faffrc.yaml` heredocs contain the host or an `ollama-local` backend; each `backends:` block carries only `nvidia-glm` + `gemini-gemma` and each `refs:` list is the two-item `[nvidia-glm, gemini-gemma]`.

### From WHAT / overlay + gitignore
- [ ] Each of the four scaffolders writes `.faffrc.local.yaml` (canonical name) from `FAFF_EVAL_LOCAL_BASE_URL` when it is set, containing the `ollama-local` backend (host from the env var, this SUT's model id) and a three-item refs list restating `nvidia-glm`, `gemini-gemma`, `ollama-local`.
- [ ] When `FAFF_EVAL_LOCAL_BASE_URL` is unset, each scaffolder prints a warning, writes no overlay, and the base config is still valid.
- [ ] Each scaffolder's `.gitignore` heredoc lists `.faffrc.local.yaml` (including faff-lab, which runs no `gitignore-ensure`).

### From HOW / behaviour
- [ ] The base `.faffrc.yaml` heredoc stays quoted; only the overlay heredoc is unquoted, so no other `$`-bearing line in the base expands.
- [ ] The `# operator's tailnet host; cage reaches it` inline comment is gone from all four files.

### Integration smoke test
```
1. On a clean clone: git grep longhair-escalator verification/external-verification/*.sh          → no output
2. FAFF_EVAL_LOCAL_BASE_URL=http://example-host:11434 SUT_ROOT=/tmp/sut-p2 \
     bash verification/external-verification/scaffold-p2-task-api.sh
   then in /tmp/sut-p2:
     git check-ignore .faffrc.local.yaml                                                  → prints the path
     grep -c longhair /tmp/sut-p2/.faffrc.yaml                                             → 0
     faff config get faffter_dark.adversarial.refs (or faff adversarial-backends)         → three backends incl. ollama-local
3. unset FAFF_EVAL_LOCAL_BASE_URL; scaffold again into a fresh dir                         → warns, no overlay, base config valid (two backends)
```

confidence: high
spec-review: approve

## Methodology critique

Agile-delivery lens (issue-critique):

- **Right-sized?** Yes. Four near-identical mechanical edits to one file-family, all shipping together against a single acceptance grep — one 1–3 day unit, not splittable, nothing to merge.
- **Workstream fit?** Yes. Info-leak hygiene, cohesive with the FAFF-587 pattern it extends; sits cleanly under the `faff-chain-gap-fill` origin.
- **Deps surfaced?** Yes. It builds on FAFF-587's shipped overlay + env-var seam (Done, already linked as related) — the dependency is satisfied, not implicit.
- **Risk profile?** Low. No novel integration, no new external dependency, no schema or interface change. No de-risking spike warranted.

No issues.
