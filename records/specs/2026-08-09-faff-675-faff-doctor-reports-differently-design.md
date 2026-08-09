# Build spec — FAFF-675: `faff doctor` must not report a copied marketplace-plugin install as a COPY failure with an unrunnable repair

> Spec: faffter-dark-nlspec · 2026-08-06 · interactive · confidence: high. Full spec on Linear FAFF-675.
> Revised 2026-08-06 (2 spec-review iterations). Iter-1 (from a QA blocker): exit parity made a **structural** guarantee (compute-once-then-branch in `gatherDoctorState`); `expectCopies` single-element invariant; scenarios for exit-1/exit-2 parity, exit-2 JSON shape + stderr breadcrumb, dangling plugin-root symlink, regression golden. Iter-2 (no blocker; majority reject on a design-taste call + addable gaps): `DoctorJson` made a **total projection** of `DoctorState` (field-completeness test); `bin_faff:"copy"`/`live==0` plugin-root scenarios; invariant-throw test; concrete golden path; and the scan-set-wide-boolean-vs-per-directory-records question settled as a reasoned **Chosen** (boolean+invariant now; per-directory records named as FAFF-685's precondition, enforced by the invariant tripwire).
> Accepted by human 2026-08-06 (see the spec-review line at the end).

**Artifact.** This is the build spec for FAFF-675 (Bug, install health). Audience: the build agent implementing the fix and the human reviewers gating it. It specifies a report-side change to `faff doctor` in `plugin/skills/faff/bin/lib/gates.js` — a copy-classifier carve-out for the plugin-root scan target, a new `--json` flag, and the recorded answer to "is the plugin root an alternative to the global skill dirs or an addition?" — plus the tests that pin the previously-uncovered default-resolution branches. All code facts are grounded against `main`.

---

## 1. WHY — Problem and Principles

**The load-bearing model.** `faff doctor` runs on *every* faff invocation through the gateway's install-health preamble, and **its exit code decides whether the user is offered a repair** — exit 1 fires the "re-link now?" soft-offer whose fix is `bash scripts/link-skills.sh --global --replace --prune (from the main checkout)`. That repair assumes the user has a repo checkout. A marketplace-plugin user does not. So the exit code doctor returns on a plugin machine is not cosmetic: it is the difference between "silent, healthy" and "offered a repair you cannot run."

**Problem statement.** A marketplace plugin install is a *copied* subtree of real directories under `$CLAUDE_PLUGIN_ROOT/skills`; `scanDoctorDirectory` (`gates.js` on `main`, line 588) classifies every non-symlink entry as `copy` and pushes `✗ <name>  COPY — not dev-linked; shipped changes won't go live`, and `cmdDoctor` returns **exit 1** whenever `copies > 0`, printing a repair the plugin user cannot run. The fix makes a copied subtree read as the *expected* shape when — and only when — the scanned target is the plugin root: exit 0, no unrunnable repair, with the copied entries named as an expected install rather than a fault.

**Design principles.**

**A copied subtree is the correct shape for a plugin install, and wrong only for a dev-linked install.** The COPY finding was written for the dev-linked case (`records/specs/2026-06-21-FAFF-200-install-health-auto-heal-design.md` defines copy-install as "a snapshot, doesn't track repo changes" — a fault *because a symlink was expected*). Under `$CLAUDE_PLUGIN_ROOT` a symlink is *not* expected; the harness ships copies by construction. The carve-out therefore keys on **where doctor is scanning**, never on a per-skill heuristic — the same real directory is a fault under `~/.claude/skills` and expected under `$CLAUDE_PLUGIN_ROOT/skills`.

**Doctor must never emit a repair the user cannot run.** An exit-1 verdict whose only `Fix:` line is a `link-skills.sh` incantation from a checkout the plugin user does not have is worse than useless — it trains the user to distrust the check. If doctor cannot offer a runnable repair for a finding on a plugin machine, that finding must not drive a non-zero exit on that machine.

**A health verdict that will not say what it inspected cannot be debugged.** `--json` exists so that a bug report from a plugin machine (or a divergent verdict between harnesses) can name the exact directories doctor scanned, rather than leaving the reader to reverse-engineer `resolveDoctorScanSet` from an environment they cannot see.

**Do not change the exit-code contract for the dev-linked path.** The gateway preamble, the FAFF-200 self-heal offer, and ten `--target` tests all depend on today's exit semantics for the global/dev-linked case (`records/specs/2026-06-21-FAFF-200-...`, `test/doctor.test.mjs`). This change adds a plugin-root branch; it must leave every non-plugin-root verdict byte-for-byte as it is.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/gates.js` — `resolveDoctorScanSet` (line ~551) | Node | Chooses the scan set; the plugin-root branch (line ~553) is single-element. Where the `expectCopies` signal originates. |
| `gates.js` — `scanDoctorDirectory` (line 588) | Node | Per-directory classifier; line 622-623 classify every non-symlink as `copy`. Where the carve-out lands. |
| `gates.js` — `cmdDoctor` (line ~643) | Node | Aggregates counts, computes exit, prints the `Fix:` line. Where `--json` and the exit decision live. |
| `gates.js` — `DOCTOR_SPEC` (line 38) | Node | `{ flags: { "--target": {arity:1}, "--root": {arity:1} } }` — no `--json` today. |
| `gates.js` — `cmdSync` (line ~781) | Node | The existing `--json` precedent (`arity: 0`, JSON-or-human branch) to mirror. |
| `test/doctor.test.mjs` | Node (test) | Every test pins `--target`; the plugin-root and home-default branches have zero coverage. |
| `test/link-skills-worktree.test.mjs` | Node (test) | Already fakes `$HOME`, deletes `CLAUDE_PLUGIN_ROOT`, holds the fence axis at "present"; the better host for a plugin-root test. Also guards the installer↔doctor agreement invariant. |
| `records/adr/` | Markdown | ADR home; highest is `0095`. The plugin-vs-global answer lands as `0096`. |

**Scope statement.** This sits entirely inside `faff doctor`'s report layer (scan-set resolution, per-directory classification, exit decision, output) and the ADR that records the plugin-vs-global decision; nothing in the installer, the gateway preamble prose, or `faff sync` changes.

---

## 2. OUT OF SCOPE

- **The install-side fix (making plugin skills discoverable to codex).** — Why excluded: owned by FAFF-685 (now active), which also owns how doctor reports *once that install fix lands*. 675 is report honesty on a plugin machine as it exists today. — Extension point: FAFF-685; the `expectCopies` branch in `scanDoctorDirectory` is where 685 would evolve the reporting when the install shape changes.
- **Folding the plugin root into the global scan set as an additional target.** — Why excluded: the plugin-vs-global question is answered "alternative, authoritative for the invoking harness" (§6), so the short-circuit is retained deliberately; making it additive is a different decision that 685 may revisit. — Extension point: `resolveDoctorScanSet` — the plugin-root branch would return a multi-element `scanSet` with per-directory `expectCopies` flags instead of a scan-set-wide one.
- **Changing the gateway doctor-at-entry prose or the `faff sync` soft-offer.** — Why excluded: with the carve-out, a healthy plugin machine returns exit 0, so the preamble already does the right thing (silent continue) with no prose change. — Extension point: `plugin/skills/faff/SKILL.md` → *Install health (doctor-at-entry)* (line 84).
- **The merge-fence and `bin/faff` install-health axes.** — Why excluded: they are independent axes folded into the same exit code (FAFF-434); their behaviour on a plugin machine is unchanged and their repairs (`faff hooks-ensure`) are runnable. — Extension point: `mergeFencePresentAt` / the `bin/faff` lstat block in `cmdDoctor`.
- **Per-skill copy/link mixing under the plugin root.** — Why excluded: a marketplace install is copies by construction; a stray symlink there is not a shape this ticket engineers for beyond "classify it normally." — Extension point: `scanDoctorDirectory`'s symlink arm, unchanged.

---

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| plugin-root scan | A `faff doctor` run where `$CLAUDE_PLUGIN_ROOT` is set and no `--target` is given, so the scan set is the single directory `$CLAUDE_PLUGIN_ROOT/skills`. |
| expected install | A copied (real-directory) skill subtree that is the *correct* shape for the scanned target — true under the plugin root, false everywhere else. |
| copy fault | A copied skill subtree where a symlink was expected (the dev-linked/global case) — the existing `✗ … COPY` finding, exit-1-driving. |
| `expectCopies` | A scan-set-wide boolean carried out of `resolveDoctorScanSet`, true only on the plugin-root branch, telling `scanDoctorDirectory` to read copies as an expected install rather than a copy fault. |

**Scan-set resolution surface (the change to the existing return shape).**

```
RECORD ScanSetResolution:
  scanSet: List<Path>              # unchanged: dirs to scan, in order
  collapseNotices: List<String>    # unchanged: dedupe collapse messages
  expectCopies: Boolean            # NEW: true iff copies here are the expected shape
                                   # (plugin-root branch only). Scan-set-wide because
                                   # the plugin-root branch is single-element.
```

`resolveDoctorScanSet` returns `expectCopies: true` only on the `pluginRootEnv` branch; `false` on the `--target` branch and the home/global default branch.

**Per-directory scan result (the change to `scanDoctorDirectory`'s return).**

```
RECORD DirectoryScan:                # existing fields unchanged unless noted
  directory: Path
  readable: Boolean
  reason: String | null
  namesFound: Set<String>
  copies: Int                        # copy FAULTS only — expected copies excluded (behaviour change)
  dangling: Int
  intoWorktree: Int
  expected: Int                      # NEW: count of copies read as expected install
  findings: List<String>
  missingHere: List<String>          # set by cmdDoctor, unchanged
```

**`--json` output schema** (emitted on stdout when `--json` is passed; the exit code is identical to the same run without `--json`):

```
RECORD DoctorJson:
  scanned: List<{
    directory: Path,
    readable: Boolean,
    reason: String | null,
    expected_install: Boolean,       # this dir is the plugin root (copies expected here)
    names_found: List<String>,       # sorted
    live: Int,                        # namesFound − copies − dangling − intoWorktree − expected
    copies: Int,                      # copy FAULTS only
    dangling: Int,
    into_worktree: Int,
    expected: Int,
    missing_here: List<String>,       # sorted; [] on a single-directory scan
    findings: List<String>
  }>
  plugin_root: Path | null            # $CLAUDE_PLUGIN_ROOT/skills when short-circuited, else null
  merge_fence: Boolean                # mergeFencePresentAt(root)
  bin_faff: "symlink-live" | "symlink-worktree" | "copy" | "absent"
  exit: 0 | 1 | 2
  ok: Boolean                         # exit === 0
```

**`DOCTOR_SPEC` change.** `{ flags: { "--target": {arity:1}, "--root": {arity:1}, "--json": {arity:0} } }` — mirrors `SYNC_SPEC`'s `--json`.

**Design decision — signal transport (scan-set-wide boolean vs per-directory record).** How does the carve-out signal reach the classifier? Options: (a) a scan-set-wide `expectCopies` boolean threaded from `resolveDoctorScanSet` through `cmdDoctor` into `scanDoctorDirectory`; (b) change `scanSet` elements from strings to `{directory, expectCopies}` records. **Chosen: (a), with the invariant below as a hard guard, and (b) named as the explicit precondition of the FAFF-685 additive fold.** Rationale: today the sole `expectCopies: true` branch is single-element, so a scan-set-wide boolean is *exact* — there is no multi-target `expectCopies` case to get wrong. (b) is strictly more machinery (every `dedupeByResolvedPath` / agreement-test / union call site would handle records instead of strings) bought for a case that does not exist until FAFF-685 makes the plugin-root branch multi-element. Building it now is speculative structure for a future ticket; YAGNI. The risk (b) removes — a future multi-element branch silently applying `expectCopies` to a non-plugin directory — is closed *mechanically* by the return-site invariant (below): the multi-element-without-per-directory-flags mistake **cannot ship**, it throws. So FAFF-685's charter is precisely: "switch to per-directory `{directory, expectCopies}` records **before** making the plugin-root branch multi-element" — the invariant is the tripwire that forces that ordering. This is a deliberate, guarded deferral, not an unguarded one. *(An adversarial spec-review preferred (b) up-front; this decision holds (a)+invariant as the right cost/risk trade for a single-element branch — accepted by the human 2026-08-06.)*

---

## 4. HOW — Behavior

**Architecture.** Three touchpoints, all in `gates.js`:

1. `resolveDoctorScanSet` gains `expectCopies` in every return.
2. `cmdDoctor` reads `--json`, threads `expectCopies` into the scan, keeps expected copies out of the exit decision, renders an expected-install RESULT line, and emits JSON when asked.
3. `scanDoctorDirectory` gains an `expectCopies` parameter and a distinct classification arm for expected copies.

**`resolveDoctorScanSet` — carry the signal.**

```
FUNCTION resolveDoctorScanSet(targetFlag, pluginRootEnv, home, root):
  IF targetFlag:      RETURN { scanSet: [targetFlag], collapseNotices: [], expectCopies: false }
  IF pluginRootEnv:   RETURN { scanSet: [join(pluginRootEnv, "skills")], collapseNotices: [], expectCopies: true }
  configured = root ? readConfiguredInstallTargets(root, home) : []
  candidates = configured.length > 0 ? configured
             : [ join(home,".claude","skills"), join(home,".agents","skills") ]
  RETURN { ...dedupeByResolvedPath(candidates), expectCopies: false }   # spread keeps {scanSet, collapseNotices}
```

**Invariant (makes the single-element coupling load-bearing, not commented).** At the return site of `resolveDoctorScanSet`, assert `expectCopies === false || scanSet.length === 1`. `expectCopies` is a scan-set-wide boolean that is only sound while the sole `expectCopies: true` branch is single-element; a future change that makes the plugin-root branch multi-element (the FAFF-685 additive fold) without first switching to per-directory flags would trip this assert at the return site rather than silently rendering a real copy-fault on a dev-linked directory as `✓ … expected`. This is the mechanical guard behind the §4 failure mode — a thrown invariant (a **runtime** assert; name it as such, and the test below trips it — do not assume it is a compile-time guard), not a code comment.

**`scanDoctorDirectory` — the carve-out.** Add `expectCopies` as the second parameter. In the non-symlink arm (today line 622-623), branch:

```
PROCEDURE classify_non_symlink(name, expectCopies):
  IF expectCopies:
    expected += 1
    findings.push("✓ " + name + "  plugin install (copy under $CLAUDE_PLUGIN_ROOT — expected, not dev-linked)")
  ELSE:
    copies += 1
    findings.push("✗ " + name + "  COPY — not dev-linked; shipped changes won't go live")
```

Add `expected` to the returned record (both the readable and the unreadable/early-return shapes, initialised `0`). The symlink arm (live / dangling / intoWorktree) is unchanged — a symlink under the plugin root is unusual but classified exactly as today.

**`cmdDoctor` — gather all state, compute the exit ONCE, then branch on output format only.** This is the load-bearing structural rule: the exit code is a pure function of the gathered `DoctorState`, computed **before** either output branch, and **shared** by both. The `--json` branch and the human branch differ **only** in how they render `DoctorState`; neither recomputes, short-circuits, or skips an axis. This makes `--json`/human exit parity a *structural* property (the same variable is returned on both paths), not a discipline the two branches must each remember to honour.

```
RECORD DoctorState:                   # everything the exit + both renderers need
  scans: List<DirectoryScan>; collapseNotices; missingHere
  copies; dangling; intoWorktree; expected         # summed across scans; expected NEVER into copies
  binFaff: "symlink-live"|"symlink-worktree"|"copy"|"absent"
  fenceOk: Boolean
  pluginRoot: Path | null
  exit: 0 | 1 | 2

PROCEDURE cmdDoctor(args):
  parse args with DOCTOR_SPEC                       # now includes --json
  asJson = !!values["--json"]
  { scanSet, collapseNotices, expectCopies } = resolveDoctorScanSet(targetFlag, env.CLAUDE_PLUGIN_ROOT, homeDir(), root)
  state = gatherDoctorState(scanSet, expectCopies, root)   # ALL axes: scans, union, bin/faff, fence, exit
  #   gatherDoctorState computes state.exit ONCE via the unchanged predicate; the empty-union
  #   case sets state.exit = 2 here too (it is no longer an early stderr return — see below).
  IF asJson: RETURN renderJson(state)               # prints DoctorJson(state) to stdout; RETURNS state.exit
  ELSE:      RETURN renderHuman(state)              # prints the human lines;         RETURNS state.exit
  # Neither renderer computes an exit. Both return state.exit verbatim. Parity holds by construction.
```

- **Anti-pattern:** `scanSet.map(scanDoctorDirectory)` (today, line 651). Why: `Array.map` passes `(element, index, array)`, so adding a second parameter to `scanDoctorDirectory` and keeping the bare `.map(fn)` reference would pass the **array index** as `expectCopies` — `0` (falsy) for the only element, silently defeating the carve-out and passing a plugin-root test only by luck of index 0. Use an explicit arrow: `scanSet.map((d) => scanDoctorDirectory(d, expectCopies))`.
- **Anti-pattern (the parity trap the review named):** an early `return` inside the `--json` branch that renders before an axis (fence, `bin/faff`) has been folded into `state.exit`. Why: it makes `--json` return a different exit than the human path for the same machine state — a fail-open on the install-health gate, since the gateway preamble fires the `faff sync` soft-offer on exit 1. The **compute-once-then-branch** structure above forbids it: `state.exit` is final before either renderer runs, so neither can drift. The empty-union case is folded into `gatherDoctorState` (setting `state.exit = 2`) rather than returning early to stderr, precisely so the JSON path cannot skip it.
- **Exit-2 output channel (the review's stderr/stdout note).** On the **human** path the empty-union diagnostic stays on **stderr** exactly as `main` line 704 (unchanged, so stderr-scraping consumers are unaffected). On the **`--json`** path the `DoctorJson` object (`exit:2`, `ok:false`) goes to **stdout** (a machine consumer parses stdout), **and** the one-line `no faff skills found …` breadcrumb is *also* written to **stderr**, so a consumer scraping stderr for faults is not silently starved by the channel swap. The exit code (2) is identical on both paths.
- **`DoctorJson` is a TOTAL projection of `DoctorState` (field-completeness guard).** `renderJson` maps **every** axis of `DoctorState` to a `DoctorJson` field — `exit`, `copies`, `dangling`, `intoWorktree`, `expected`, `binFaff`, `fenceOk` (→ `merge_fence`), `pluginRoot`, and each scan. So a future maintainer who adds a new install-health axis to `gatherDoctorState` cannot silently drop it from `--json`: a test (below) asserts the projection is total — every `DoctorState` key is reflected in `DoctorJson` — failing CI if a new axis is added to state but not to the JSON. This makes JSON completeness mechanical, not a discipline the two renderers must each remember; exit parity is already structural (both return `state.exit`).

**Exit decision — unchanged formula, expected copies excluded by construction.** The existing predicate (`main`, line 721) is `copies > 0 || dangling > 0 || intoWorktree > 0 || anyMissingHere || !fenceOk`. Because expected copies increment `expected` and never `copies`, a clean plugin-root scan (no dangling/worktree links, single directory so `anyMissingHere` is false, fence present) evaluates the predicate to false → **exit 0**. No change to the predicate itself.

**RESULT line for a clean expected-install scan.** Today's clean line is `RESULT: all faff skills are dev-linked (symlinks) — repo is live.` That is false for a plugin install. When the run exits 0 **and any scan had `expected > 0`**, render instead:

```
RESULT: faff skills are a marketplace-plugin install (copies under $CLAUDE_PLUGIN_ROOT) — expected. Nothing to repair.
```

Otherwise the existing clean line stands.

**Behavior summary — the exit-1 path on a plugin machine still exists, but only for runnable repairs.** A plugin machine can still exit 1 — e.g. a missing merge fence (`Fix: faff hooks-ensure`, runnable) or an actual dangling symlink. The carve-out removes *only* the copy-fault contribution to the exit on the plugin-root scan; it does not make the plugin machine unconditionally exit 0. The `link-skills.sh` fix is appended (line 736) only when `copies > 0 || dangling > 0 || intoWorktree > 0 || anyMissingHere` — with the carve-out excluding expected copies from `copies`, a copies-only plugin scan never reaches that branch, so the unrunnable `link-skills.sh` fix is never printed for it.

**`--json` — same exit, machine-readable body.** When `--json` is set:

- The **exit-2 empty-union case** (line 704, `no faff skills found under any of …`) still returns 2, but emits the `DoctorJson` object (with `exit: 2`, `ok: false`, `scanned` naming the empty dirs) on **stdout** (plus the stderr breadcrumb above).
- The **exit-0 and exit-1 cases** emit the `DoctorJson` object on stdout and suppress the human lines entirely (mirroring `cmdSync`'s `asJson` branch).
- `plugin_root` is `$CLAUDE_PLUGIN_ROOT/skills` when `expectCopies` is true (the short-circuit fired), else `null`.
- The exit code for any given machine state is **identical** with and without `--json`.

**Edge cases.**

- **`--target` pointed at a plugin root.** `--target` wins the short-circuit before `pluginRootEnv` is consulted (line 552), so `expectCopies` is `false` and copies there are faults. **Chosen:** this is correct — `--target` is an explicit operator request to audit a directory *as a dev-linked install*; the carve-out is scoped to the implicit plugin-root scan only. To spare the operator who runs `faff doctor --target $CLAUDE_PLUGIN_ROOT/skills` to investigate (and gets a confusing exit-1 + unrunnable fix), the COPY finding line under `--target` names the reason: `✗ <name>  COPY — --target audits as a dev-linked install; omit --target to audit as a plugin install`.
- **`$CLAUDE_PLUGIN_ROOT` set but `<root>/skills` absent/unreadable.** `scanDoctorDirectory` returns the unreadable shape (`readable:false`, `namesFound` empty); union is empty → exit 2 (`no faff skills found`), unchanged. A plugin harness with no skills dir is genuinely nothing-installed, not an expected install.
- **A symlink present under the plugin root.** Classified normally (live/dangling/intoWorktree). A dangling one still drives exit 1 with a runnable-or-not fix — out of scope; a marketplace install has no symlinks by construction.
- **Mixed: plugin root with copies + a missing fence.** exit 1, `Fix: faff hooks-ensure` only (the copies contribute nothing). The copied skills still render as `✓ … expected` in the body.

**Failure modes.**

- **The failure:** the carve-out keys on `expectCopies` (scan-set-wide) but a future change makes the plugin-root branch multi-element, so a non-plugin directory inherits `expectCopies: true` and hides a real copy fault. **How you'd know:** the return-site invariant throws (or, if stripped, a directory that is *not* the plugin root renders `✓ … plugin install (copy …)`). **What it means:** narrow — the boolean must become per-directory before the branch goes multi-element (called out in §2/§3 as the FAFF-685 precondition; the invariant is the tripwire).
- **The failure:** `--json`'s exit code silently drifts from the human path's exit code (e.g. an early `return` in the JSON branch that skips the fence axis). **How you'd know:** the exit-1/exit-2 parity scenarios (§5) fail — same machine state yields different `exit` in JSON vs the human path. **What it means:** the compute-once-then-branch structure prevents it by construction; the parity scenarios pin it.

---

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given $CLAUDE_PLUGIN_ROOT points at a dir whose skills/ subdir holds faff skills as real directories (copies),
  and no --target is passed, and the merge-fence axis is held present
When faff doctor runs
Then it exits 0
  And each copied skill renders "✓ <name>  plugin install (copy under $CLAUDE_PLUGIN_ROOT — expected, not dev-linked)"
  And the output contains no "COPY" fault line and no "link-skills.sh" fix
  And the RESULT line names it a marketplace-plugin install
```

```
Given a plugin-root copy install (as scenario 1)
When faff doctor --json runs
Then stdout is valid JSON whose scanned[].directory names $CLAUDE_PLUGIN_ROOT/skills
  And plugin_root equals $CLAUDE_PLUGIN_ROOT/skills
  And scanned[0].expected_install is true and scanned[0].expected > 0 and scanned[0].copies == 0
  And exit and ok agree with the non-JSON run for the same state (exit 0, ok true)
```

```
Given the plugin-root copy install WITH the merge-fence ABSENT (the exit-1 state)
When faff doctor runs, and separately faff doctor --json runs, against that same state
Then both return exit 1 (exit-1 parity)
  And the --json run emits valid JSON on stdout with ok:false and exit:1
  And the human run prints "Fix: faff hooks-ensure" (no link-skills.sh)
```

```
Given $CLAUDE_PLUGIN_ROOT/skills exists but is empty (no faff skills — the exit-2 empty-union state)
When faff doctor --json runs, and separately faff doctor runs, against that same state
Then both return exit 2 (exit-2 parity)
  And the --json run emits valid JSON on stdout: ok:false, exit:2, scanned[].directory names the empty dir
  And the --json run ALSO writes the "no faff skills found …" breadcrumb to stderr
  And the human run writes that diagnostic to stderr exactly as on main (unchanged channel)
```

```
Given the plugin-root copy install (fence present), with ~/.local/bin/faff a real-file copy (the realistic plugin-machine shape)
When faff doctor --json runs
Then merge_fence is true AND bin_faff is "copy" (the realistic plugin-root value, not "symlink-live")
  And scanned[0].live == 0 AND scanned[0].expected == count-of-skills
  (the live formula subtracts expected; the advisory bin_faff/merge_fence fields are pinned to the plugin-root shape)
```

```
Given a DANGLING symlink placed under $CLAUDE_PLUGIN_ROOT/skills alongside the copies, fence present
When faff doctor runs
Then it exits 1 (the dangling symlink is classified normally, NOT swallowed by the expectCopies arm)
  And the copied skills still render "✓ … expected" while the dangling one renders "✗ symlink-dangling"
```

- The `--target DIR` and home-default (`~/.claude/skills` + `~/.agents/skills`) verdicts and exit codes are byte-for-byte unchanged from `main` (regression assertion — a copied skill under `--target` still reads `✗ … COPY`, exit 1). **Verified by a scenario, not a claim:** the existing `test/doctor.test.mjs` golden(s) (the byte-exact `single-directory` comparison the diff pins) are re-run against the post-change build and asserted to still match — the added `expected`/`expectCopies`/`--json` surfaces must not perturb any non-plugin-root human output the golden fixes.

---

## 6. Design Decision Rationale

**Carve-out semantics: exit 0 (expected install) vs "keep the difference but make it visible."** The ticket allows either "read as expected install, exit 0" or "keep the plugin-root difference deliberate, but document it AND make it visible in doctor's output, never silent." Options: **(a)** exit 0 + expected-install language; **(b)** keep exit 1 but reword and document. Con of (b): exit 1 still fires the gateway soft-offer whose only repair is the unrunnable `link-skills.sh` — the very defect this ticket exists to remove; wording alone does not stop the offer. **Chosen:** (a) exit 0 with explicit expected-install lines in the body and a distinct RESULT line — the difference is both visible (named in output) and correct (no false failure, no unrunnable repair). This satisfies the "documented AND visible, never silent" bar via the output itself, not merely via a comment.

**Plugin root: alternative or addition?** (The question the ticket requires answered in writing.) Options: **(alternative)** the plugin root is authoritative for the harness that invoked doctor; the global dirs are irrelevant to *this* harness's health, so the short-circuit stays. **(addition)** scan the plugin root *and* the global pair, because a plugin machine might also carry global installs that matter. **Chosen: alternative — authoritative for the invoking harness.** Rationale: `$CLAUDE_PLUGIN_ROOT` names where *the running harness* loads skills from, so it is the correct and sufficient target for "is the harness that invoked me healthy?" — which is precisely the question 675 scopes doctor to (report honesty for the invoking harness *today*). Whether a plugin machine *also* carries global installs that some *other* harness needs is cross-harness discoverability, which is FAFF-685's charter, not 675's. Keeping the short-circuit also keeps `scanSet` single-element, so `expectCopies` stays a scan-set-wide boolean and the FAFF-676 agreement test and `dedupeByResolvedPath` are untouched. Recorded in **ADR-0096** (`records/adr/0096-*.md`) and cross-referenced by a comment at the `pluginRootEnv` branch of `resolveDoctorScanSet`. At the time of writing there is no live marketplace-plugin distribution, so this is settled on the install shape as it is designed, not as observed in the field; ADR-0096 names FAFF-685 as the revisit trigger.

**Signal transport: scan-set-wide boolean vs per-element record.** Covered in §3 — **Chosen:** scan-set-wide boolean + the return-site invariant, per-directory records deferred to FAFF-685 as its precondition (see §3 for the full cost/risk rationale; human-accepted over the adversarial reviewer's up-front-records preference).

**`--json` shape: reuse `cmdSync`'s pattern.** **Chosen:** an `arity: 0` `--json` flag that, when set, prints one JSON object and suppresses human output, exactly as `cmdSync` does — no new dependency, consistent with the existing CLI idiom. The object names every scanned directory (the ticket's core `--json` requirement) plus the per-directory counts needed to explain the verdict.

---

## 7. Open Questions and Assumptions

**Open Questions.** None. Every decision above is closed with a `**Chosen:**` marker; the plugin-vs-global question the ticket flagged is answered (alternative/authoritative) and recorded in ADR-0096.

**Assumptions.**

- **Assumes:** a marketplace-plugin install places faff skills as **real directories** under `$CLAUDE_PLUGIN_ROOT/skills` (not symlinks). — Validation: this is the ticket's re-grounded premise (human-confirmed 2026-08-06) and matches how `scanDoctorDirectory` already classifies plugin installs. The build agent needs no live plugin to verify — the tests synthesise the shape (real dirs under a temp `$CLAUDE_PLUGIN_ROOT/skills`). If a future marketplace ships symlinks instead, those entries fall through to the existing symlink classifier (harmless); ADR-0096 is the revisit trigger.
- **Assumes:** `cmdDoctor` reads `$CLAUDE_PLUGIN_ROOT` via `process.env.CLAUDE_PLUGIN_ROOT` at the call site (`main` line 650). — Validation: confirmed against `main`; the test controls the variable by setting it in the child env (the inverse of `test/link-skills-worktree.test.mjs`'s `delete env.CLAUDE_PLUGIN_ROOT`).
- **Assumes:** the merge-fence and `bin/faff` axes on a plugin machine are out of scope and their existing behaviour is acceptable. — Validation: the fence axis has a runnable repair (`faff hooks-ensure`); tests hold it "present" via a fenced `--root` (the `mkFencedRoot` pattern) so the carve-out is exercised in isolation.

---

## 8. DONE — Definition of Done

### From WHY
- [ ] On a plugin-root copy install with the fence present, `faff doctor` exits 0 (was exit 1 on `main`).
- [ ] No `bash scripts/link-skills.sh …` fix line is printed for a copies-only plugin-root scan.

### From WHAT (types and interfaces)
- [ ] `resolveDoctorScanSet` returns `expectCopies: true` on the `pluginRootEnv` branch and `false` on the `--target` and home-default branches; `scanSet` remains a `List<Path>`.
- [ ] `scanDoctorDirectory(directory, expectCopies)` returns an `expected` count; expected copies increment `expected`, never `copies`.
- [ ] `DOCTOR_SPEC` includes `"--json": { arity: 0 }`.

### From HOW (behaviour)
- [ ] Under `expectCopies`, each copied skill renders `✓ <name>  plugin install (copy under $CLAUDE_PLUGIN_ROOT — expected, not dev-linked)`.
- [ ] The scan call is `scanSet.map((d) => scanDoctorDirectory(d, expectCopies))` — not the bare `.map(scanDoctorDirectory)` (index-as-arg trap avoided).
- [ ] A clean exit-0 scan with `expected > 0` prints the marketplace-plugin RESULT line, not `all faff skills are dev-linked`.
- [ ] The exit predicate is unchanged; a plugin-root scan with a missing fence still exits 1 with `Fix: faff hooks-ensure` only.
- [ ] `faff doctor --json` prints one JSON object matching `DoctorJson`, naming every scanned directory in `scanned[].directory`, and returns the same exit code as the non-JSON run for the same state (verified at exit 0, 1, and 2).
- [ ] **Structural exit parity:** `state.exit` is computed once in `gatherDoctorState` before either renderer; `renderJson`/`renderHuman` return `state.exit` verbatim and neither recomputes or short-circuits an axis (compute-once-then-branch — parity holds by construction, not by discipline).
- [ ] **Invariant:** `resolveDoctorScanSet` asserts `expectCopies === false || scanSet.length === 1` at its return site (a runtime assert).
- [ ] `--json` at the empty-union case returns exit 2 with the object on stdout (`exit: 2`, `ok: false`) and the `no faff skills found …` breadcrumb on stderr; the human path's stderr diagnostic is unchanged from `main`.

### From HOW (edge cases)
- [ ] `--target` pointed at a plugin root classifies copies as faults (exit 1), and the COPY line names the `--target`-audits-as-dev-linked reason.
- [ ] A `$CLAUDE_PLUGIN_ROOT` whose `skills/` is absent yields exit 2 (nothing installed), not a false exit 0.

### From decisions
- [ ] `records/adr/0096-*.md` records the plugin-root-is-an-alternative decision, names FAFF-685 as the revisit trigger, and a comment at the `pluginRootEnv` branch of `resolveDoctorScanSet` cross-references it.

### Regression
- [ ] All existing `test/doctor.test.mjs` and `test/link-skills-worktree.test.mjs` cases pass unchanged; the `--target` and home-default verdicts are byte-for-byte as on `main`.

### New tests (control `$HOME` and `$CLAUDE_PLUGIN_ROOT` explicitly; host in `test/link-skills-worktree.test.mjs`)
- [ ] Plugin-root copy install + fence present → exit 0, expected-install lines, no COPY/link-skills text.
- [ ] Plugin-root copy install + fence absent → exit 1, `faff hooks-ensure` only, no `link-skills.sh`, copies still `✓ expected`.
- [ ] `faff doctor --json` on a plugin-root install → JSON names `$CLAUDE_PLUGIN_ROOT/skills`, `expected_install:true`, `copies:0`, `expected>0`, exit 0.
- [ ] **exit-1 parity:** same fence-absent state run with and without `--json` → both exit 1; `--json` emits `ok:false`,`exit:1` JSON on stdout.
- [ ] **exit-2 parity + shape:** empty `$CLAUDE_PLUGIN_ROOT/skills` run with and without `--json` → both exit 2; `--json` emits `ok:false`,`exit:2`,`scanned[].directory` on stdout AND the breadcrumb on stderr; human path writes to stderr unchanged.
- [ ] **advisory-field pin:** a plugin-root `--json` run asserts `merge_fence` is true and `bin_faff` is `"copy"` (the realistic plugin-machine shape), and `scanned[0].live == 0` (the `live` formula subtracts `expected`).
- [ ] **field-completeness / total projection:** a test asserts `DoctorJson` reflects every `DoctorState` axis, so a future axis added to state cannot be silently dropped from `--json`.
- [ ] **invariant throws:** a synthetic multi-element scan set with `expectCopies: true` trips the `resolveDoctorScanSet` return-site assert (confirms the guard fires rather than silently passing).
- [ ] **symlink under plugin root:** a dangling symlink under the plugin-root skills dir → exit 1, classified `✗ symlink-dangling` while copies stay `✓ expected` (not swallowed by the `expectCopies` arm).
- [ ] **regression golden:** the existing `test/doctor.test.mjs` golden at its concrete committed path (the `single-directory` byte-exact comparison) still matches under `--target` after the change.

**Integration smoke test.**

```
1. Make tmp home H; make tmp pluginRoot P with P/skills/faff-graft, P/skills/faff-prep as real dirs (copies)
2. Make a fenced --root R (PreToolUse merge-fence present)
3. Run: CLAUDE_PLUGIN_ROOT=P HOME=H  faff doctor --root R
   ASSERT exit 0; stdout matches /plugin install .* expected/; stdout does NOT match /COPY/ or /link-skills\.sh/
4. Run: CLAUDE_PLUGIN_ROOT=P HOME=H  faff doctor --root R --json
   ASSERT exit 0; JSON.parse(stdout).plugin_root === P/skills; .scanned[0].expected > 0; .scanned[0].copies === 0; .ok === true
```

---

confidence: high
spec-review: accepted-by-human (2026-08-06) — human override of a 2-iteration majority-`reject-approach`. The blocker (iter-0 exit-parity) and all addable QA gaps were fixed in-spec; the sole residual was a design-taste call (signal transport: scan-set-wide boolean + invariant vs per-directory records), resolved in favour of the spec's `Chosen`. This is a human acceptance, **not** a machine `approve`.

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" } ] }
```