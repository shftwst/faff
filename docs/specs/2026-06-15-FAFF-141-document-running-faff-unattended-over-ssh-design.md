# Spec: Document running faff unattended over SSH (tmux/mosh)

> Spec: faffter-dark-nlspec · 2026-06-15 · interactive · confidence: high. Full spec on Linear FAFF-141.

This spec governs FAFF-141 — adding operational documentation that tells a user how to keep a `/faff-beep-boop` run alive across SSH disconnects, laptop-lid-close, and network changes. The audience is the build agent implementing the docs change and the human reviewer checking it. It is a **docs-only** change: no faff skill or CLI behaviour is modified.

## 1. WHY — Problem and Principles

**Problem statement.** beep-boop's whole pitch is L3 "safe to stop watching", yet nothing tells a user that a bare SSH session makes `claude` a child of the connection — so a dropped link, a closed laptop lid, or a network change kills the run mid-flight. This change adds a short operational docs section explaining the gap and the fix (run `claude` inside `tmux`, or `mosh` + `tmux` for flaky links), and cross-links it from beep-boop where overnight runs are launched.

**Design principles.**

- **The fix is launch-level, not skill-level.** The remedy lives at the `claude`-launch level, not inside any faff skill — a skill cannot detach its own already-attached process. The docs must say this plainly and must **not** imply a faff command keeps the session alive (no such command ships under this ticket).
- **Proportionate and zero-code.** faff is *adoptable, not all-encompassing* — it should not reinvent `tmux`. The docs point at the standard tools and show the minimal recipe; they do not wrap, install, or manage `tmux`/`screen`/`mosh`.

**Reference context.**

| System | Type | Relevance |
|---|---|---|
| `docs/unattended.md` | Markdown docs | The L3 deep-dive page; the new SSH section is appended here |
| `README.md` ("Going further", lines 67–76) | Markdown | Already links `docs/unattended.md`; the new section lives under that existing link |
| `plugin/skills/faff-beep-boop/SKILL.md` (Notes section) | Skill source | Where the cross-link to the new section is added |

**Scope statement.** This is user-facing operational documentation for the L3 (`/faff-beep-boop`) workflow — it sits alongside the existing unattended-runs deep-dive, not in any skill's runtime behaviour.

## 2. OUT OF SCOPE

- **`faff beep-boop --detached` CLI launcher** — excluded. Why: this ticket is the zero-code docs fix; a launcher (wrapping `tmux new -d -s faff 'claude …'` and printing the attach command) is a *code feature on the `faff` CLI*, not a docs change, and not a skill (a skill can't self-detach). Extension point: a new follow-up ticket against the bundled `faff` CLI (`bin/faff` / its subcommand dispatch). See the decision in §6.
- **A new dedicated docs page** (e.g. `docs/running-unattended-ssh.md`) — excluded in favour of a section in the existing `docs/unattended.md`. Why: ~20 lines of tmux/mosh guidance does not warrant a standalone page, and the content is squarely on-topic for the L3 unattended-runs page its readers already land on. See §6.
- **Automating or managing `tmux`/`screen`/`mosh` from within faff** — excluded; outside faff's remit per the proportionality principle.
- **Editing any skill's runtime behaviour** — excluded; the only skill-source change is a documentation cross-link bullet in beep-boop's Notes section.

## 3. WHAT — Content and Wiring

**Vocabulary.**

| Term | Definition |
|---|---|
| detach / reattach | Leaving a `tmux`/`screen` session running in the background (`Ctrl-b d`) and rejoining it later (`tmux attach`) |
| `mosh` | Mobile shell — survives IP changes and sleep/wake, but does not itself persist a session across server-side process death; paired with `tmux` for persistence |

**Design decisions.** (Full rationale in §6.)

- Docs location. **Chosen:** add a `## Running over SSH` section to the existing `docs/unattended.md`, and cross-link to it from `plugin/skills/faff-beep-boop/SKILL.md`'s Notes section. The README's existing "Unattended runs" link already routes readers to the page that now carries the section.
- CLI launcher. **Chosen:** docs-only for this ticket; defer the `faff beep-boop --detached` launcher to a separate follow-up feature ticket on the CLI.

**Required content of the new `## Running over SSH` section** (in `docs/unattended.md`):

1. **Why it's needed** — one short paragraph: a bare SSH session makes `claude` a child of the connection, so a dropped link / closed lid / network change kills an in-flight run; the fix is at the `claude`-launch level, not in faff.
2. **tmux recipe** — start a named session, run `claude` inside it, detach with `Ctrl-b d`, reattach with `tmux attach -t faff`; note `screen` as the fallback.
3. **mosh + tmux** — for roaming or flaky links, use `mosh` to reach the host and `tmux` inside it for persistence; one sentence on why both (mosh survives the link, tmux survives the disconnect).
4. **Launch-level note** — explicitly state faff can't do this for you (a skill can't detach its already-attached process); this is why it's a launch-time recipe, not a faff flag.

**Cross-link wiring.**

- `plugin/skills/faff-beep-boop/SKILL.md` — add one bullet to the Notes section pointing at the new section (relative link from the skill file to `docs/unattended.md`, anchored at the `Running over SSH` heading; the path is `../../../docs/unattended.md#running-over-ssh` — the build agent verifies it resolves).
- `README.md` — the "Going further" entry for `docs/unattended.md` (line 72) may gain a brief "(incl. running over SSH)" gloss; a *new* top-level README link is **not** added (the section lives under the existing unattended-runs link).

## 4. HOW — Behaviour

This is a documentation change; "behaviour" is the prose, the recipes, and the link wiring being correct and resolvable.

**Approach.** Append the new section to `docs/unattended.md` after the existing content, matching the page's house style (`## Topic` headings, prose + fenced code blocks, inline backtick commands). Add the beep-boop Notes cross-link. Optionally gloss the README line.

**Recipe content (illustrative — the implementer writes the final prose).**

```
# start a persistent session and launch claude inside it
tmux new -s faff
claude            # then drive /faff-beep-boop as normal

# detach (leaves it running):  Ctrl-b then d
# reattach later:              tmux attach -t faff
# screen fallback:             screen -S faff  …  detach Ctrl-a d, reattach screen -r faff

# roaming / flaky link: reach the host with mosh, run tmux inside it
mosh user@host -- tmux new -A -s faff
```

**Anti-pattern:** writing the docs as though a faff command (`/faff-beep-boop` or a flag) keeps the session alive. Why: it doesn't — the persistence is provided by `tmux`/`mosh` at launch time, and implying otherwise sends users looking for a faff feature that doesn't exist.

## 5. SCENARIOS

**Behavioural objective.**

```
Given a user reading docs/unattended.md
When they reach the "Running over SSH" section
Then they find: why a bare SSH session kills an unattended run, a copy-pasteable tmux detach/reattach recipe (with screen as fallback), a mosh + tmux note for flaky links, and a statement that the fix is launch-level (not a faff command)
```

**Constraint assertions.**

- Every new cross-link (beep-boop Notes → the new section; any README gloss) resolves to an existing file and a real heading anchor.
- No new top-level README "Going further" entry is added; the section is reached via the existing `docs/unattended.md` link.
- No skill runtime behaviour changes — the only skill-source edit is the Notes cross-link bullet.

## 6. DESIGN DECISION RATIONALE

**Where should the content live — README section, a new dedicated docs page, or the existing unattended page?**

- Options: (a) a section in `docs/unattended.md`; (b) a new `docs/running-unattended-ssh.md`; (c) a README section.
- (b) over-proliferates docs for ~20 lines and splits one L3 topic across two pages; (c) puts deep operational detail in the pitch-level README, against the repo's convention that "everything past the pitch lives in `docs/`".
- **Chosen:** (a) a `## Running over SSH` section in `docs/unattended.md` — it is exactly where an L3 reader looking for "how do I leave a run going" lands, the page is short and on-topic, and it reuses the README's existing link. Cross-linked from beep-boop's Notes so a reader in the skill finds it too.

**Should a `faff beep-boop --detached` CLI launcher ship with this?**

- Options: bundle a launcher now, or keep this docs-only and defer.
- The ticket frames docs as "the proportionate, zero-code fix"; a launcher is a separable CLI feature with its own design (session naming, attach-command output, error handling) and testing surface.
- **Chosen:** docs-only; defer the launcher to a follow-up feature ticket on the `faff` CLI. At the time of writing no such launcher exists, so the docs must not reference one. (Recommend filing the follow-up — surfaced at the build gate, not auto-filed.)

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — both questions the ticket raised are resolved above.

**Assumptions.**

- **Assumes:** `docs/unattended.md`, the `README.md` "Going further" section, and `plugin/skills/faff-beep-boop/SKILL.md`'s Notes section all exist. Validation: the build agent confirms each file and section is present before editing (verified during prep exploration on 2026-06-15).

## 8. DONE — Definition of Done

### From WHY
- [ ] `docs/unattended.md` contains a section explaining that a bare SSH session makes `claude` a child of the connection, so a dropped link/lid/network change kills an unattended run.
- [ ] The section states the fix is launch-level and that faff cannot detach its own session.

### From WHAT / HOW (content)
- [ ] The section includes a copy-pasteable `tmux` recipe: create named session, run `claude`, detach (`Ctrl-b d`), reattach (`tmux attach -t faff`).
- [ ] `screen` is named as the fallback with its detach/reattach commands.
- [ ] A `mosh` + `tmux` note covers roaming/flaky links, with one sentence on why both are used.
- [ ] The docs do **not** imply any faff command/flag keeps the session alive (anti-pattern avoided).

### From WHAT (wiring)
- [ ] `plugin/skills/faff-beep-boop/SKILL.md` Notes section has a bullet cross-linking to the new section, and the relative link resolves.
- [ ] No new top-level README "Going further" entry is added (an inline gloss on the existing unattended-runs line is acceptable).
- [ ] All new/changed relative links resolve to existing files and heading anchors (verified by inspection — no docs link-checker in CI).

**Integration smoke test:**

```
1. Open docs/unattended.md → the "Running over SSH" section is present and complete.
2. From plugin/skills/faff-beep-boop/SKILL.md Notes, follow the cross-link → it lands on that section.
3. grep the repo for the new anchor/path → every reference resolves to a real file + heading.
```

confidence: high

---

## Methodology critique (agile-delivery lens)

- **Right-sized?** Yes. One docs section plus two cross-link edits — a single cohesive concern, well under a 1–3 day unit. No split or merge indicated.
- **Workstream fit?** Yes. Sits cleanly in the *"A newcomer can adopt faff unaided"* project — operational adoption docs.
- **Deps surfaced?** None. No implicit blocker; the follow-up CLI launcher is explicitly out of scope, not a dependency.
- **Risk profile?** Low. Docs-only, no novel integration or external dependency — no de-risking spike needed.
