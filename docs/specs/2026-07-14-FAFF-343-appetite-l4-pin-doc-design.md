# FAFF-343 — Gateway Appetite section: document the L4 appetite pin + the resolveAppetite resolution channel

> Spec: faffter-dark-nlspec · 2026-07-14 · autonomous · confidence: high. Full spec on Linear FAFF-343.

This spec defines a single documentation edit: one paragraph added to the gateway's **Appetite for destruction** section (`plugin/skills/faff/SKILL.md`, the block spanning lines 676–734) documenting that appetite is **level-scoped** — a fact already implemented in the CLI (`resolveAppetite`, FAFF-308) but not yet taught by the one prose surface every consumer reads. Small doc slice (~hour); SCENARIOS omitted per the small-slice convention — the DONE section's substring assertions are the born-verifiable check.

## 1. WHY — Problem and Principles

Audit finding **R6** (drift, `docs/audits/2026-07-04-faff-323-whole-system-coherence.md`): the appetite pin is implemented (`resolveAppetite`/`FAFF_APPETITE`, `plugin/skills/faff/bin/lib/config.js`) but the gateway still teaches the un-pinned single-dial model ("global per project", no L4 mention). The deciding ADR's own Consequences warn that a consumer bypassing the resolution channel would leak the pin; teaching the bypass model in the one shared prose surface is itself a leak risk.

**Design principles:**

- **Teach the channel, not just the outcome.** The paragraph names the single resolution channel (`faff config get appetite` → `resolveAppetite`) so a reader understands *why* every consumer sees the same answer, not just that L4 happens to be `full`.
- **Accurate to the live-run nuance.** `resolveAppetite`'s L4 branch only pins `full` for a *live* L4 run (FAFF-378: running owner + fresh heartbeat); a done/abandoned/stale L4 ledger falls through to config. The paragraph must not overstate this as an unconditional per-ledger pin — staleness only de-escalates, never escalates.
- **No new mechanism.** This is a prose-only correction of an existing, already-shipped behaviour. No CLI change, no schema change, no config key.

## 2. OUT OF SCOPE

- Any change to `resolveAppetite`, `config.js`, `lights-out.js`, or any other CLI/runtime code — the behaviour being documented is already shipped and correct.
- Rewriting the existing Appetite for destruction tables (build-pipeline modulation, topology-write authority, hard floor) — those stay as-is; this adds one new paragraph, it does not restructure the section.
- The ADR-status sweep mentioned in the ticket's "Why" (the ADR still `Proposed`) — separately ticketed, out of scope here.

## 3. WHAT — The one paragraph

Insert a new paragraph in `plugin/skills/faff/SKILL.md`, immediately after the existing "**Switching appetite.**" paragraph (the last paragraph of the **Appetite for destruction** section, ending "...explicit Punts are non-negotiable.") and before the `### Resolve-attempt before park` heading that follows it.

**Chosen:** the paragraph states, in this order:
1. Appetite is level-scoped, not a single global dial.
2. At **L4** (a live `faff lights-out` run), appetite resolves to `full` unconditionally; config `appetite` is not consulted for that run.
3. The single resolution channel every consumer reads through: `faff config get appetite`, backed by `resolveAppetite`, resolving in order — env `FAFF_APPETITE` (valid token wins) → the active-L4 run's ledger (live only) → config `appetite` → the baked default.
4. For **L1–L3**, config `appetite` stays authoritative exactly as documented above in this section — unchanged.
5. The hard floor (destructive/irreversible operations always park) is unaffected by the level scoping — `full` at L4 is still bounded by the same floor documented below.

**Chosen — exact insertion point:** after the "Switching appetite" paragraph (current final paragraph of the section), immediately before `### Resolve-attempt before park`. This keeps the paragraph adjacent to the dial-switching mechanics it qualifies, without disturbing the tables above.

**Chosen — source of truth for the resolution order:** `plugin/skills/faff/bin/lib/config.js` lines 230–270 (`resolveAppetite` + its doc comment) and `plugin/skills/faff/bin/lib/lights-out.js` lines 726–730 (the mint-time `appetite = "full"` literal + comment). Confirmed live against the current branch at spec time — the precedence is env → live-L4-ledger → config → default, and the L4 branch is gated on `ledger.level === "L4" && runIsHeld(...)`.

## 4. HOW

1. Read the current section (`plugin/skills/faff/SKILL.md` lines 676–734) to reconfirm the exact "Switching appetite" paragraph text and the following heading, so the insertion is anchored precisely (line numbers may have drifted since the ticket was filed).
2. Insert the new paragraph verbatim per WHAT above.
3. Run `faff validate-adapters` and the repo's `lint-refs` check over the touched file — must PASS.
4. Run `node --test` — must stay green (a prose-only change; no test should reference the new paragraph's exact wording, so this is a regression check, not new coverage).

**Anti-patterns:** rewording any existing sentence in the section beyond inserting the new paragraph; restating the resolution order elsewhere in the gateway (single home only); adding a new `.faffrc` key or CLI flag.

**Build note (discovered at build time):** the gateway file (`faff`) carries a hard, file-specific `validate-adapters` line-cap override of 1100 lines (FAFF-120 charter); origin/main's copy sat exactly at that cap (1099 newline-terminated lines), leaving zero headroom for a new blank-line-separated paragraph. Resolved by appending the level-scoping content as a new sentence onto the end of the existing "Switching appetite" paragraph's line (same paragraph, no new line added) rather than as its own visually-separated paragraph — net zero new lines, well under the 200-word single-line paragraph cap (123 words combined). This is a formatting adaptation only; every content point in WHAT below is still covered verbatim.

## 8. DONE

- [ ] `plugin/skills/faff/SKILL.md` carries new prose, appended to the end of the "Switching appetite" sentence (see Build note above) and still before `### Resolve-attempt before park`, that: (a) states appetite is level-scoped, (b) states L4 resolves `full` unconditionally for a live run, (c) names the single channel `faff config get appetite` / `resolveAppetite` and its env → ledger → config → default order, (d) states config `appetite` stays authoritative for L1–L3, (e) states the hard floor is unchanged.
- [ ] No other line in the section is altered.
- [ ] `faff validate-adapters` passes.
- [ ] `lint-refs` passes.
- [ ] `node --test` stays green.
- [ ] PR touches only `plugin/skills/faff/SKILL.md` (plus the committed spec doc) — no CLI/code files.

confidence: high
spec-review: approve
