# Enforce same-turn spec attach in faff-prep (`faff prepcheck` Stop-hook)

> Spec: faffter-dark-nlspec · 2026-06-19 · interactive · confidence: high. Source: Linear FAFF-178.

_Revised 2026-06-19 — the open Punt (enforcement mechanism) was resolved by the maintainer to **(a) a `faff prepcheck` Stop-hook analogue of `runcheck`**; respec to high._

Build spec for **FAFF-178** — makes "attach the produced spec in the same prep turn" a mechanical guarantee (a Stop-hook backstop) instead of prose discipline that has silently failed twice.

## 1. WHY — Problem and Principles

**Problem statement.** When `/faff-prep` delegates to the `spec` slot, the producer's spec renders into the conversation and the turn *feels* done — so prep sometimes stops there, never running stamp → validate → `save_comment` → Todo. The spec lives only in chat; the ticket stays Backlog; the work is silently lost. Step 2's "attach the content" is prose-only with no enforcement — the exact deterministic-tools-over-prose gap `runcheck` already closes for beep-boop.

**Design principles.**

- **Mechanical backstop, mirror `runcheck`.** The guard is a session-end Stop hook (`faff prepcheck --hook`) that *blocks* if a prep produced a spec but recorded no attach — structurally identical to `runcheck --hook` blocking on an admitted-but-undispatched ledger entry.
- **Externalised state is the source of truth.** The CLI has no tracker access (pure function), so — exactly like `runcheck` reads the run-ledger — `prepcheck` reads a marker **prep writes**. The marker is the externalised attach-state; the hook audits it.
- **Pin the marker at produce time.** The marker is written the instant the producer returns (`attached: false`), *before* any rendering, and flipped `true` only after a successful attach. A render-and-pause therefore leaves `attached: false` for the hook to catch — the write-before-render ordering is the mechanical pin.

## 2. OUT OF SCOPE

- **Independent tracker verification** — `prepcheck` does *not* call the tracker to confirm the comment exists (CLI has no tracker access); it trusts prep's marker, same as `runcheck` trusts the ledger.
- **Changing the spec producer's output contract** — the `faff-contract:spec-readiness` block is unchanged; this only adds the attach-state marker + the hook.
- **The other open prep behaviours** — only same-turn attach is in scope.

## 3. WHAT — Vocabulary, Types, and Interfaces

| Term | Meaning |
|---|---|
| attach-state marker | machine-readable record prep writes per (invocation × issue): `{ issue, spec_produced, attached, mode, ts, disposition? }` |
| open marker | a marker with `spec_produced: true` and `attached: false` (and not `disposition: parked`) — a produced-but-not-attached spec |
| prepcheck | the CLI audit: any open marker → block |

**Marker shape:**
```
RECORD PrepAttachMarker:
  issue: string            # e.g. FAFF-178
  spec_produced: bool      # true once the producer returned a spec-readiness block
  attached: bool           # true once save_comment (tracker) or .faff/specs write (git-only) succeeded
  mode: "tracker" | "git-only"
  ts: ISO-8601             # write time
  disposition?: "parked"   # set when a low-confidence spec is parked by design (legitimate non-attach)
```

**Marker location.** Hard-floor, written in **both** interactive and autonomous modes: `.faff/prep/<ISSUE-XX>.json` (latest write wins per issue). Rationale: `prepcheck --hook` must find it regardless of `logging: essential`, which silences the narrative `…prep-ISSUE.md`.

**Decisions.**
- **Chosen:** prep writes the marker at **produce time** with `attached:false`, then flips `attached:true` immediately after a successful `save_comment` / `.faff/specs` write.
- **Chosen:** a `faff prepcheck --hook` Stop-hook analogue of `runcheck --hook` — scans markers; if any is open, emits `{decision:"block", reason}` naming the issue(s); exit 0 (block via decision, like runcheck). A plain `faff prepcheck` prints a human report + non-zero exit for CI/manual use.
- **Chosen:** `attached` is set by prep after the mode-appropriate write; `prepcheck` reads `attached` from the marker — it does not itself touch the tracker (preserves the pure-function CLI invariant).

## 4. HOW — Behavior

```
faff-prep, after the spec slot returns:
  1. WRITE marker .faff/prep/<ISSUE>.json { spec_produced:true, attached:false, mode, ts }  ← before rendering (the pin)
  2. stamp → validate → save_comment (tracker) | write .faff/specs/<issue>.md (git-only)
  3. on success: UPDATE marker attached:true
  (a render-and-pause stops after step 1 → marker stays open → hook catches it)

faff prepcheck --hook  (Stop hook, mirrors runcheck --hook):
  1. find markers under .faff/prep/
  2. open := markers with spec_produced && !attached && disposition != "parked"
  3. if open non-empty → print {decision:"block", reason} naming the issue(s)
  4. exit 0   (block is via the decision payload, not the exit code — same as runcheck)
```

**Anti-pattern:** writing the marker *after* attach — then a render-and-pause writes no marker at all and the hook has nothing to catch. The produce-time write (`attached:false`) is the whole point.

**Anti-pattern:** having `prepcheck` call the tracker to verify the comment — breaks the pure-function CLI invariant.

**Edge cases.**
- Git-only mode: `attached` flips on the `.faff/specs/<issue>.md` write; `mode:"git-only"` recorded.
- Low-confidence **park** (no attach by design): prep records `disposition:"parked"` so the marker is **not** treated as open.
- Multiple issues prepped in one session: one marker per issue; the hook blocks on any open one.
- Staleness: an open marker stays surfaced until resolved (attach, record disposition, or remove the marker) — a genuinely-abandoned spec *should* keep surfacing. The happy-path attach-flip makes false-positives near-zero.

## 8. DONE — Definition of Done

- [ ] prep writes the attach-state marker at produce time (`attached:false`) before rendering, and flips it `true` after a successful tracker/`.faff/specs` write (documented in faff-prep SKILL.md).
- [ ] `faff prepcheck --hook` blocks session-end on any open marker (spec_produced && !attached && !parked), emitting `{decision:"block", reason}` naming the issue(s); plain `faff prepcheck` prints a report + non-zero exit.
- [ ] Cross-mode: `attached` flips on tracker `save_comment` OR git-only `.faff/specs/<issue>.md`; prepcheck reads the marker, never the tracker.
- [ ] Parked (by-design non-attach) is recorded (`disposition:"parked"`) so prepcheck does not false-block.
- [ ] `faff prepcheck --selftest` mirrors `runcheck`/`next` selftests; wired into CI (validate.yml).
- [ ] Behavioural test: open marker → block; attached:true → clean; parked → clean.
- [ ] Stop-hook registration documented (alongside / extending `runcheck --hook`).

confidence: high
