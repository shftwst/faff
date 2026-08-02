# Spec — FAFF-664: job-surface-probe's hosted-container job uploads an incomplete bundle and goes green

> Spec: faffter-dark-nlspec · 2026-08-02 · interactive · confidence: medium. Full spec on Linear FAFF-664.

## 1. WHY — problem and principle

`.github/workflows/job-surface-probe.yml`'s `hosted-container` job declares three output files to `upload-artifact` but uploaded **one** (run `30372295195`) and went green. Two independent faults, both the "fails silently, not loudly" class faff hunts:

1. **Wrong upload paths on the container shape.** The steps write to `$RUNNER_TEMP` **inside the container** (a non-host-shaped fs — the probe measured `/__w/faff`), but the upload `path:` uses `${{ runner.temp }}`, which GitHub interpolates to the **host** path `/home/runner/work/_temp/…`. So the declared paths don't describe where the files are. `hosted-direct` is correct (steps run on the host, paths match — 4/4).
2. **`if-no-files-found: error` is a zero-check, not an all-declared-matched check.** One file matched, so it didn't fire → green on a partial bundle. There is no `upload-artifact` setting that asserts "all declared paths matched"; the count must be checked by something else.

This blocks **FAFF-657**, whose acceptance requires both transcripts *committed verbatim from the workflow artifacts* — the container transcript isn't in any artifact. It is fixed here (not inside 657) so the fix lands on `main` first, then 657 dispatches against `main` and its readings are trustworthy (the FAFF-654 circularity, avoided).

## 2. WHAT — design

**Chosen: add a fail-closed bundle-completeness assertion before upload, both shapes.** A step that checks every declared output file exists and **fails the job on a short list** — the deterministic guard that closes the silent-green defect *independent of the path fix*. Assert the explicit expected files (not just a non-zero count), so a future partial upload fails loudly instead of looking like today's green run. This is the load-bearing, in-repo, testable core.

**Chosen: fix the container shape's upload so all three files reach the bundle.** Write the container job's probe/self-test/pre-checkout outputs to a **host-visible location** and upload from there, so the host-run `upload-artifact` action sees them. `hosted-direct` (currently 4/4) must not regress.

**Punt (decides: eng at build — requires a live hosted-container dispatch):** the exact host-visible path expression. The ticket forbids guessing, and the two shapes differ. The strong candidate is writing outputs under `$GITHUB_WORKSPACE` (the checkout is bind-mounted host↔container for container jobs, so a file written there by a container step is visible to the host-side action at the mapped host path) and uploading workspace-relative — but **which expression is correct must be confirmed by a live dispatch**, not asserted from the run log. This is the one genuinely open decision; it cannot be closed from a build session (the same substrate split that made 657 its own ticket).

**Chosen: apply the same fail-loud treatment to the `Tool presence check` step.** It prints `(absent)` and exits 0 — same defect class, same file (the ticket's item 3). Make a missing required tool fail the step, so a hand-picked minimal base image is caught before checkout, loudly.

**Assumes:** `probe.sh` is **unmodified** — its `probe_sha256` is what proves a transcript came from the committed instrument, and FAFF-656 takes its columns with the same one. This fix is workflow-only (`.github/workflows/job-surface-probe.yml`).

## 3. HOW — acceptance

**Deterministic (mergeable, verifiable in-repo / by a short dispatch):**
- A bundle-completeness step fails the job when any declared output file is missing — demonstrated by a test or a deliberate short-bundle dispatch, not by inspection.
- The `Tool presence check` fails the step on a missing required tool (no longer `(absent)` + exit 0).
- `probe.sh` is byte-unchanged (its `probe_sha256` unchanged).
- `hosted-direct`'s declared upload set is unchanged (still 4 files).

**Live-verified (operator AC — needs a hosted-container dispatch against `main`):**
- A `hosted-container` dispatch produces a bundle containing **all three** declared files.
- A `hosted-direct` dispatch still produces all four.
- The completeness guard is confirmed firing green on a full bundle and red on a short one.

### Scenarios

```
Given a hosted-container job whose steps wrote all three outputs
When the pre-upload completeness step runs and a declared file is missing from the bundle path
Then the job fails (not green), naming the missing file.
```

```
Given the container upload paths are corrected to a host-visible location
When a hosted-container dispatch runs against main
Then the artifact bundle contains all three files (verbatim), confirmed by file count.
```

```
Given the Tool presence check on a minimal base image missing git
When it runs
Then the step fails loudly before checkout, rather than printing (absent) and continuing.
```

## 4. DONE — definition of done

- [ ] Pre-upload completeness assertion (explicit expected files) fails the job on a short bundle — both shapes; test/short-dispatch demonstrates the failure.
- [ ] `Tool presence check` fails on a missing required tool.
- [ ] Container upload paths corrected to a host-visible location (expression confirmed by a live dispatch, per the Punt).
- [ ] `hosted-container` dispatch → 3 files; `hosted-direct` → 4 (unchanged) — **live-verified against `main`**.
- [ ] `probe.sh` byte-unchanged.

confidence: medium

```faff-contract:spec-readiness
{"confidence":"medium","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"punt"},{"marker":"chosen"},{"marker":"assumes"}]}
```
