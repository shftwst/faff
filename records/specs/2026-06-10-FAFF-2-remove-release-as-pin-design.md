# Spec — Remove the one-time `release-as: 0.1.0` from release-please-config.json

> _Spec · producer: faffter-dark-nlspec · adaptor: faffidavit-spec · 2026-06-10 · mode: interactive · confidence: high_

A one-line release-config cleanup, now that the bootstrap 0.1.0 release has shipped (tag `faff--v0.1.0`, GitHub release published 2026-06-10).

## 1. WHY
`release-please-config.json` pins `release-as: 0.1.0` to force the bootstrap release; with 0.1.0 now cut, the pin is a live footgun — the next release-please run would re-cut 0.1.0 instead of bumping. Deleting the `release-as` key lets normal Conventional-Commit bumps resume from 0.1.0.

**Principle — minimal diff.** The only change is removing the `release-as` key. Every other field (`release-type`, `component`, tag config, `extra-files`) is load-bearing and stays byte-for-byte. Do **not** hand-edit `.release-please-manifest.json` — release-please owns it and has bumped it to `0.1.0` on main.

## 2. OUT OF SCOPE
- Manifest edits (`.release-please-manifest.json` is tool-managed).
- Any other release config key (all correct as-is).
- End-to-end "next release bumps correctly" — only observable on the next post-merge release-please run, not this PR's CI.

## 3. WHAT
The `.` package loses exactly one key: `"release-as": "0.1.0"`. Nothing else.
**Chosen:** delete the key (not re-pin to a higher version — re-pinning reintroduces the same footgun; with the manifest at 0.1.0, release-please bumps unaided).

## 4. HOW
1. Parse `release-please-config.json`. 2. Delete `"release-as"` from `packages."."` only. 3. Re-serialise preserving 2-space indent + trailing newline. 4. Confirm the diff is a single-line deletion.
**Anti-pattern:** editing the manifest by hand (desyncs release-please). **Anti-pattern:** reformatting the whole file (hides the one change).

## 5. RATIONALE
Delete vs re-pin: re-pin forces a version + reintroduces the footgun. **Chosen:** delete — manifest (0.1.0) + commit history is all release-please needs.

## 6. OPEN QUESTIONS / ASSUMPTIONS
Open: none.
- **Assumes:** `faff--v0.1.0` tag on main and manifest reads `0.1.0`. Validate: `jq -r '.["."]' .release-please-manifest.json` → `0.1.0`. **If `0.0.0`, stop — premature.** (Verified met at build time: worktree based on origin/main `8f50315`.)

## 7. DONE
- [ ] `release-as` gone — `jq '.packages["."]["release-as"] // "ABSENT"' release-please-config.json` → `"ABSENT"`.
- [ ] Still valid JSON — `jq -e . release-please-config.json` exits 0.
- [ ] Single-key diff — `git diff release-please-config.json` shows exactly one removed line, no other changes.
- [ ] `.release-please-manifest.json` unchanged — `git diff --quiet -- .release-please-manifest.json`.
- [ ] Built from fresh origin/main where manifest is `0.1.0`.

Smoke test: `jq -e '.packages["."]["release-as"] | not' release-please-config.json` → true; `git diff --stat` → `release-please-config.json | 1 -`. (Next-release bump is a post-merge human observation, not a CI gate.)

confidence: high
