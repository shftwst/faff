# Buildable spec for FAFF-1172 — "Report stale TypeScript emit from faff doctor"

> Spec: faffter-dark-nlspec · 2026-10-05 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1172.

This is the buildable specification for FAFF-1172, addressed to the build agent that will implement it and to the human reviewers gating the spec. It adds one install-health axis to `faff doctor` so a contributor running the emitted JavaScript from a stale build gets an exit-1 heads-up before CI catches them. It is a ratified Size:S follow-up on the TypeScript emit foundation (ADR-0132, layout d); it is not on the critical path.

> **Revised 2026-10-05** — cleared the round-1 majors against the human-ratified decision `stale-emit-check-fires-only-where-buildable` (tracker `## Decisions-register intent`, Ratified-by: human). The adopter-copy fail-safe now gates on **build-toolchain resolvability**, not tsconfig presence (§1, §3, §4, §6); the integration smoke test now populates the skill union and fences the fence/toolchain axes so the asserted exit 1 is reachable and attributable (§8); the step-6 exit-0 case is fenced; the out-of-scope gateway-preamble scenario was dropped (§5).

## 1. WHY — Problem and Principles

**The load-bearing model.** `faff doctor` already folds several independent install-health checks ("axes") into a single exit code, computed exactly once (the FAFF-675 compute-once-then-branch pattern). Adding a check means adding one axis: a function that reports its finding, a fold into the one exit expression, and a line in each of the two renderers. The interactive soft-offer and autonomous log-only behaviour are not in the CLI at all; they live in the gateway's doctor-at-entry preamble and trigger on doctor's exit code. So any new exit-1 finding inherits that behaviour for free.

**Problem statement.** Under the TypeScript emit layout (ADR-0132, layout d), the committed `.js` beside each `.ts` is what every install path runs, but a contributor who edits a `.ts` and forgets to rebuild is silently on a stale emit until CI fails. `faff doctor` detects stale copy-installs today but not a stale emit. This change adds a doctor axis that compares each committed `.js` emit against its `.ts` source and reports "emit older than source; run the build" as an exit-1 finding.

**Design principles.**

**Doctor must stay cheap and tsc-free.** It runs at every gateway entry on every install, including an adopter on Node 20 with no devDeps, so it cannot recompute the emit or shell `tsc`. Reject any implementation that invokes the compiler or needs build-time dependencies. (The axis only *reads* mtimes; the toolchain-resolvability gate below is a filesystem probe, not a compiler invocation.)

**Fire only where the build is runnable; skip silently otherwise.** This is the round-1 architectural correction, ratified by the decision `stale-emit-check-fires-only-where-buildable`. The axis fires **only where `npm run build` could actually run here** — a source/dev checkout whose `plugin/skills/faff` TypeScript toolchain is installed and resolvable — and **skips otherwise**. It does **not** gate on "tsconfig present", because an adopter marketplace copy ships `tsconfig.json`, the `.ts` sources, **and** the committed `.js` emits, yet cannot rebuild (its devDependencies are gitignored and uninstalled). A stale-emit finding is useless to someone who cannot act on it, so nagging an adopter copy is noise, while nagging the contributor who can run the build is the whole point. The gate is therefore "is a resolvable build toolchain present?", the same signal `npm run build` itself needs — not "is a config file present?". **Chosen:** see §4 for the detection and the root-resolution mechanism.

**Doctor is a heads-up, not the gate.** The authoritative byte-stable freshness check is FAFF-1171's CI gate (rebuild, then `git diff --exit-code`). Doctor is a fast local signal that trades completeness for zero cost. Reject any attempt to make doctor byte-exact. **Chosen (inherited):** `ts-foundation-mitigation-sequencing` — FAFF-1172 is the `faff doctor` heads-up half of the deferred safety net and FAFF-1171 is the enforcing CI half; the two are complementary, not overlapping (settled, not re-litigated here).

**Parity by construction.** The new axis folds into `state.exit` once and appears in both `renderHuman` and `renderJson`/`buildDoctorJson`; neither renderer recomputes the exit (FAFF-675). A finding visible in the human output but absent from `--json` is a defect.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/gates.js` | JavaScript | Holds `cmdDoctor`, `gatherDoctorState`, `renderHuman`, `renderJson`/`buildDoctorJson`, and `mergeFencePresentAt` — the axis is added here |
| `plugin/skills/faff/tsconfig.json` | JSON | Its `include` list is the source of the `.ts` → `.js` pair set; emit is beside source (no `outDir`) |
| `plugin/skills/faff/package.json` | JSON | Declares the `build` script and the TypeScript devDependencies (`typescript`, `@types/node`); their installed presence under `node_modules/` is the buildable signal the axis gates on |
| `plugin/skills/faff/bin/lib/producer-auth.{ts,js}`, `commissaire.{ts,js}` | TypeScript / JS | The two committed emit pairs today; the axis must not hardcode them |
| `test/doctor.test.mjs`, `test/golden/doctor/` | JavaScript | Existing doctor test surface (unit + golden) the new axis extends; `test/doctor.test.mjs` already shows the `--target <dir>` + fenced `--root` fixture idiom this slice reuses |

**Scope statement.** This is the `faff doctor` half of the `ts-foundation-mitigation-sequencing` safety net; the CI hard gate (FAFF-1171) is the other half.

## 2. OUT OF SCOPE

- **Teaching the gateway soft-offer to run `npm run build`.** Why excluded: the three acceptance criteria are already met by folding the axis into exit 1 — the autonomous log-only and never-prompt behaviour come from the existing preamble, and the repair command is named in doctor's `Fix:` line. Teaching the interactive preamble to offer-and-run the build is a UX nicety beyond a Size:S slice. Extension point: the kernel "Install health" soft-offer in `plugin/skills/faff/SKILL.md`.
- **Content-hash / byte-exact freshness in doctor.** Why excluded: a hash check must compare against something without `tsc`, which means a committed source-hash manifest — new scope that also changes FAFF-1170's already-merged build. Extension point: FAFF-1171's CI gate already does byte-exact verification by rebuilding and diffing.
- **The CI freshness hard gate.** Why excluded: that is FAFF-1171, the complementary half of the safety net, tracked separately. Extension point: `.github/workflows/` plus FAFF-1171.
- **A build-script `--check` mode.** Why excluded: ADR-0132 chose `faff doctor` for this check so the existing entry preflight surfaces it; this resolves the ticket's open question. Extension point: `plugin/skills/faff/package.json` build script, if ever revisited.
- **The autonomous gateway doctor-at-entry preamble's own behaviour (log-only, never-prompt, no `~/.claude` mutation).** Why excluded: that behaviour lives in the kernel "Install health" preamble and triggers on doctor's exit code; it is inherited unchanged and is not code this slice touches. The only observable this diff controls is doctor's exit code and output lines. Extension point: `plugin/skills/faff/references/kernel.md` "Install health (doctor-at-entry)".

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| emit | The committed `.js` that `tsc` produces from a `.ts`, written beside its source under the same basename (ADR-0132, layout d; CommonJS module output) |
| axis | One install-health dimension that `faff doctor` folds into its single exit code |
| stale emit | A committed `.js` whose paired `.ts` source has a strictly newer modification time |
| buildable here | The `plugin/skills/faff` TypeScript toolchain is installed and resolvable in this checkout, i.e. `npm run build` could actually run — the condition under which the stale-emit axis fires |
| axis active vs skipped | The stale-emit axis is **active** only when the build toolchain is resolvable here **and** `tsconfig.json` resolves to at least one `.ts` include; otherwise it is **skipped** (nothing meaningful to check — either not a buildable checkout, or no TypeScript source) |

**Type definitions.**

```
RECORD StaleEmitPair:
  source: RelativePath     # the .ts, as written in tsconfig include (e.g. "bin/lib/producer-auth.ts")
  emit:   RelativePath     # the paired .js beside it (e.g. "bin/lib/producer-auth.js")

# Added to the existing DoctorState assembled by gatherDoctorState:
  staleEmits:      List<StaleEmitPair>   # empty when clean OR when the axis is skipped
  emitCheckActive: Boolean               # true iff the toolchain is resolvable AND tsconfig resolved >= 1 .ts include
```

**JSON wire shape (added to `buildDoctorJson`'s object):**

```
emit_check: "active" | "skipped"
stale_emits: [ { source: string, emit: string }, ... ]   # always present; [] when clean or skipped
```

**Exit rule (amended).** The single exit computation in `gatherDoctorState` gains one disjunct:

```
exit = emptyUnion
  ? 2
  : ( copies > 0 || dangling > 0 || intoWorktree > 0 || anyMissingHere
      || !fenceOk || staleEmits.length > 0 )
    ? 1 : 0
```

`staleEmits` is empty whenever the axis is skipped (not buildable, or no TypeScript source), so a non-buildable adopter copy adds zero to the exit — the axis can never turn an adopter copy's otherwise-clean doctor into a permanent exit 1.

**Design decision — where the check lives.** The check is a new repo-root axis in `gatherDoctorState`, surfaced in both renderers and `buildDoctorJson`, folded into `state.exit`. The merge-fence axis is the precedent: it reads `<root>/.claude/settings.json` rather than a scanned skills directory. The stale-emit axis likewise reads `<root>/plugin/skills/faff/` (its `node_modules`, `tsconfig.json`, and the paired files). **Chosen:** a `faff doctor` axis, not a build-script `--check` mode — ratified by ADR-0132's "the `faff doctor` stale-emit check (FAFF-1172)".

## 4. HOW — Behaviour

**Architecture and approach.** Add one pure function, `gatherStaleEmits(root)`, returning `{ active: Boolean, stale: List<StaleEmitPair> }` (`stale` empty when clean or when the axis is skipped; `active` false whenever the axis is skipped). Call it once inside `gatherDoctorState`, store the two results on the state, add the `stale.length > 0` disjunct to the exit expression, and render the axis in both renderers. This mirrors `mergeFencePresentAt` exactly: one function, one fold, two render sites.

**Root resolution — the mechanism that decides whether the axis fires on a copy. Chosen.** `gatherDoctorState` already receives `root`, resolved by `cmdDoctor` as `values["--root"] || findRoot()` (`findRoot()` walks up from cwd to the repo anchor). The axis resolves its directory as `tsconfig_dir = join(root, "plugin", "skills", "faff")` — **the same `root` the merge-fence axis already uses**, never a hardcoded absolute path. This is what makes adopter-copy behaviour correct: on a marketplace copy, `findRoot()` resolves to *that copy's* own root, so `tsconfig_dir` points at the copy's own `plugin/skills/faff` — whose `node_modules` is absent (devDeps gitignored and never installed). The buildable gate below therefore reads false against the copy's own tree and the axis skips, with no special-casing of "adopter" anywhere in the code. **Chosen:** resolve the axis directory from the doctor `root` (`--root` override else `findRoot()`), join `plugin/skills/faff`; the buildable probe runs against that directory's own `node_modules`.

**Buildable gate — fire only where the toolchain is resolvable. Chosen.** Before any tsconfig or pair work, the axis asks: *is a resolvable TypeScript build toolchain present under `tsconfig_dir`?* — the same signal `npm run build` needs to run at all. Detect it by a filesystem probe for the installed compiler under this directory's own `node_modules`, never by shelling `tsc` or `npm`:

```
PROCEDURE build_toolchain_resolvable(tsconfig_dir):
  # True iff the TypeScript compiler is installed and resolvable HERE (what `npm run build` needs).
  # A filesystem probe only — never spawn tsc/npm (doctor must stay tsc-free and cheap).
  RETURN is_file(join(tsconfig_dir, "node_modules", "typescript", "package.json"))
      OR is_file(join(tsconfig_dir, "node_modules", ".bin", "tsc"))
```

A dev/source checkout that has run `npm install` under `plugin/skills/faff/` has `node_modules/typescript` present → buildable → the axis fires. An adopter marketplace copy (and a CI job or any tree that never installed the devDeps) has no such directory → not buildable → the axis skips. This is the ratified gate: it nags only the contributor who can fix it. **Chosen:** detect "buildable here" as the presence of a resolvable `typescript` toolchain under `tsconfig_dir/node_modules` (compiler package or the `.bin/tsc` shim); skip the axis entirely when absent.

**Pair enumeration.** Derive the pair set from the tsconfig `include` list so it auto-extends as more modules convert (for example FAFF-1173), rather than hardcoding the two current filenames. Include entries are relative to the tsconfig's own directory (`plugin/skills/faff/`), so resolve them against that directory, not against `root`.

**Staleness signal.** Flag a pair when the `.ts` modification time is strictly newer than its `.js` emit's modification time. This is the only tsc-free staleness signal available. **Chosen:** mtime, strictly-newer comparison — content-hash would need a committed hash manifest or `tsc`, expanding scope; see Design Decision Rationale.

```
PROCEDURE gather_stale_emits(root):
  tsconfig_dir  = join(root, "plugin", "skills", "faff")   # root = --root override else findRoot()

  1. IF NOT build_toolchain_resolvable(tsconfig_dir):
        RETURN { active: false, stale: [] }                 # axis SKIPPED — not buildable here (adopter copy, CI, pre-install)
  tsconfig_path = join(tsconfig_dir, "tsconfig.json")
  2. IF tsconfig_path is not a readable file: RETURN { active: false, stale: [] }   # axis skipped
  3. config = parse_json(tsconfig_path); IF parse throws: RETURN { active: false, stale: [] }  # axis skipped
  4. includes = config.include
     IF includes is not a non-empty array of strings: RETURN { active: false, stale: [] }      # axis skipped
  5. stale = []
     FOR each entry in includes:
        a. IF entry does not end with ".ts": CONTINUE              # not a TS source
        b. src  = join(tsconfig_dir, entry)
           emit = src with trailing ".ts" replaced by ".js"
        c. src_stat = stat(src);  IF src_stat unavailable: CONTINUE   # source gone — cannot pair
        d. emit_stat = stat(emit); IF emit_stat unavailable: CONTINUE # no committed emit → clean (see below)
        e. IF src_stat.mtimeMs > emit_stat.mtimeMs:
              stale.push({ source: entry, emit: relative(tsconfig_dir, emit) })
  6. RETURN { active: true, stale }
```

`emitCheckActive` is the returned `active` — true only when the buildable gate passed (step 1) and steps 2–4 resolved at least one `.ts` include.

**Rendering.** In `renderHuman`, after the merge-fence line:

```
IF emitCheckActive:
  IF staleEmits is empty:
    print  "  ✓ TypeScript emits up to date"
  ELSE:
    FOR each pair in staleEmits:
      print  "  ✗ {pair.emit}  emit older than source {pair.source} — run the build"
# axis skipped (not buildable, or no TS source) → print nothing (nothing to check)
```

On exit 1, add to the `problems` list `"{n} stale TypeScript emit(s)"` and add to the `fixes` list `"npm run build  (from plugin/skills/faff/)"`, joined with the existing fixes by `&&`. In `buildDoctorJson`, add `emit_check` and `stale_emits` to the returned object (both the empty-union early-return object and the main object).

**Edge cases and precedence.**

- Toolchain not resolvable under `tsconfig_dir/node_modules` (adopter copy, CI without devDeps, pre-install dev tree) → axis skipped, clean, zero exit contribution. **This is the decisive adopter-copy case** — it holds even when tsconfig and both `.ts`/`.js` are present.
- tsconfig absent, unreadable, or unparseable → axis skipped, clean.
- `include` missing, empty, or not a string array → axis skipped, clean.
- An include entry that is not a `.ts` (for example a `.json`) → skipped silently.
- `.ts` source missing → that pair skipped (cannot pair); other pairs still checked.
- `.js` emit missing → that pair treated as clean (see Design Decision Rationale for why "never built" is not flagged here).
- mtimes equal → not stale; only strictly-newer source flags.

**Anti-pattern:** shelling `tsc`/`npm` or requiring devDeps *to run* from doctor. Why: doctor runs on adopter installs with zero devDeps and must stay tsc-free; the toolchain gate is a filesystem probe, never a spawn.
**Anti-pattern:** gating on "tsconfig absent" to protect adopters. Why: adopter copies ship tsconfig + `.ts` + `.js`, so that gate does not fire for them — it is exactly the round-1 defect. Gate on toolchain resolvability instead.
**Anti-pattern:** hardcoding `producer-auth`/`commissaire` as the pair set. Why: it breaks the moment FAFF-1173 converts another module; derive from tsconfig `include`.
**Anti-pattern:** faulting when the toolchain, tsconfig, or an emit is absent. Why: that false-positives adopter copies and pre-conversion trees; the axis must fail toward clean (skip).
**Anti-pattern:** recomputing the exit inside a renderer. Why: it breaks FAFF-675 parity-by-construction; both renderers must return `state.exit` verbatim.

**Failure modes.**

- **mtime is reset by a fresh clone or checkout.** Git sets file mtimes at checkout time, so immediately after a clone the source is not strictly newer than its emit and the axis stays clean — the common case has no false positive. How you'd know: `faff doctor` flags a rebuild right after a clean `git checkout` with no edits. What it means: proceed. If a checkout ever orders a source newer than its emit, doctor flags a harmless rebuild and FAFF-1171's CI gate remains the source of truth. This is tolerable because doctor is a heads-up, not the gate. (Only affects dev checkouts, which are the only trees the axis fires on.)
- **Same-tick edit-and-rebuild misses a stale emit.** If a `.ts` edit and a `.js` rebuild land within the same mtime granularity, strictly-newer reads false and doctor misses it. How you'd know: a known-stale pair reports clean. What it means: proceed; this is a rare miss that CI's content diff (FAFF-1171) catches. Doctor is best-effort by design.
- **A dev checkout that has not yet run `npm install`.** The toolchain gate reads false, so the axis skips and a genuinely stale emit goes unreported locally. How you'd know: `faff doctor` says nothing about emits on a fresh dev checkout. What it means: proceed — such a tree cannot rebuild anyway, and FAFF-1171's CI gate (which installs then rebuilds) is the backstop. The heads-up reappears the moment the contributor installs the toolchain they need to fix it.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a dev checkout with the plugin/skills/faff TypeScript toolchain installed (node_modules/typescript present)
  And plugin/skills/faff/tsconfig.json listing bin/lib/producer-auth.ts
  And producer-auth.ts has an mtime strictly newer than producer-auth.js
When a developer runs `faff doctor`
Then doctor exits 1
  And the output names bin/lib/producer-auth.js as an emit older than its source
  And the Fix line contains "npm run build  (from plugin/skills/faff/)"
```

```
Given the stale state above
When the developer rebuilds (or touches the .js so its mtime is >= the source's) and reruns `faff doctor`
Then the stale-emit axis reports clean
  And doctor exits 0 (assuming all other axes are clean)
```

```
Given `faff doctor --json` run against a buildable checkout with one stale emit
When the command completes
Then the JSON has emit_check == "active" and stale_emits listing the stale pair
  And the top-level exit == 1, matching the human renderer
```

## 6. Design Decision Rationale

**Where does the check live — `faff doctor` or a build-script `--check` mode?**
Options: a doctor axis (surfaced by the existing entry preflight on every install) vs a `tsc --check`-style build mode (runs only when someone invokes the build). The ticket's open question defaults to doctor, and ADR-0132 ratifies it by naming "the `faff doctor` stale-emit check (FAFF-1172)" as part of the safety net.
**Chosen:** a `faff doctor` install-health axis — it rides the entry preflight that already runs everywhere, so the heads-up reaches the developer without a separate step.

**When should the axis fire at all — tsconfig present, or build runnable?**
Round 1 gated on "tsconfig present → active, absent → skipped". That is unsound: an adopter marketplace copy ships `tsconfig.json`, both `.ts` sources, and the committed `.js` emits (all are committed under `plugin/skills/faff/`), yet cannot rebuild because its devDependencies are gitignored and uninstalled. A "tsconfig absent → skipped" fail-safe never fires for an adopter, so the axis would nag a permanent, unactionable exit 1 at someone who cannot run the build. The correct gate is whether `npm run build` could run *here* — detected as a resolvable TypeScript toolchain under `tsconfig_dir/node_modules`. Firing only where buildable makes the finding meaningful (the contributor can fix it) and silent where it would be noise (the adopter copy). The root-resolution mechanism (`tsconfig_dir = join(findRoot()/--root, "plugin/skills/faff")`) is what points the probe at the copy's own, uninstalled tree.
**Chosen:** the stale-emit axis fires only where the build toolchain is resolvable (`node_modules/typescript` present under `tsconfig_dir`), and skips otherwise — ratified by the human decision `stale-emit-check-fires-only-where-buildable`.

**mtime or content hash for the staleness signal?**
Content hash is authoritative but needs something to compare against without `tsc` — in practice a committed source-hash manifest, which is new scope and changes FAFF-1170's merged build. mtime is tsc-free and cheap; its only weakness (checkout resets mtimes) degrades to a harmless false-positive rebuild, never a missed true positive in the common edit-without-rebuild case.
**Chosen:** mtime with a strictly-newer comparison — doctor is the fast local heads-up; FAFF-1171's CI rebuild-and-diff is the byte-exact authority.

**How is the pair set enumerated?**
Options: hardcode the two current filenames, or derive from tsconfig `include`. Hardcoding is simpler now but rots the moment another module converts.
**Chosen:** derive each `.ts` from tsconfig `include` and pair it with the `.js` of the same basename in the same directory — it auto-extends as FAFF-1173 and later work convert more modules.

**What happens when the axis inputs are absent?**
Options: treat a missing toolchain / tsconfig / emit as a fault (like merge-fence), or treat it as nothing-to-check. A fault would fire on every adopter marketplace copy and every pre-conversion tree, where the developer cannot act on it.
**Chosen:** not buildable, absent/unparseable tsconfig, no `.ts` sources, or a `.ts` with no committed `.js` → clean / nothing-to-check, never a fault. The merge-fence axis faults when missing because a fence should always be present; the stale-emit axis is different because it is only meaningful where the build can run.

**A `.ts` with no `.js` emit at all — stale, or out of scope?**
It could mean "never built" (a real problem in the faff dev repo) or an adopter copy that simply ships differently. Doctor cannot tell these apart cheaply, and the cost of a false positive is high because doctor runs on every install at every entry.
**Chosen:** fold "`.ts` present, no `.js`" into clean (no resolvable pair). The genuine never-built case is caught by FAFF-1171's CI gate (rebuild then `git diff --exit-code`); keeping doctor false-positive-free for adopters is the dominant concern.

**How is the stale-emit repair surfaced?**
The existing interactive soft-offer runs `faff sync` (re-link), which is the wrong repair for a stale emit (whose repair is `npm run build` from `plugin/skills/faff/`). Options: name the build command only in doctor's `Fix:` line, or also teach the gateway soft-offer to offer-and-run the build.
**Chosen:** doctor's `Fix:` line names `npm run build  (from plugin/skills/faff/)`, and teaching the gateway soft-offer is left out of scope for this Size:S slice. The three acceptance criteria are met by folding into exit 1; the autonomous log-only and never-prompt behaviour come from the existing preamble unchanged. The gateway offering `faff sync` for a stale-emit-only exit 1 is a wrong-repair wart, not a correctness failure — the authoritative repair text is in the `Fix:` line and the log, and re-linking is harmless. Teaching the preamble is the named extension point.

## 7. Open Questions and Assumptions

**Open Questions.** None — every decision above is closed.

**Assumptions.** None beyond the foundation already on `main` (see the next section), which the build agent can confirm by checking that `plugin/skills/faff/tsconfig.json` exists with a non-empty `include`, that `plugin/skills/faff/package.json` declares the `build` script and the `typescript`/`@types/node` devDependencies, and that the paired `.js` emits are committed beside their `.ts` sources.

**Ratified foundation decisions (inherited from FAFF-1170 / ADR-0132 — pinned, not re-litigated here).**
- **Chosen (inherited):** ADR-0132 layout d — committed `.js` beside each `.ts`, no `outDir` — the layout this axis reads.
- **Chosen (inherited):** CommonJS module output — the committed emit is CommonJS, which is what every faff install path `require`s.
- **Chosen (inherited):** verify-the-`.js`-emit — the committed `.js` is the artifact that runs and the one this axis checks for staleness (not a rebuilt copy).
- **Chosen (inherited):** `@types/node` as a devDependency — part of the `plugin/skills/faff` toolchain whose installed presence is the buildable signal this axis gates on.
- **Chosen (inherited):** `ts-foundation-mitigation-sequencing` — FAFF-1172 is the doctor half of the deferred safety net, FAFF-1171 the CI half; settled.

## Already shipped against this surface

| Ticket | Status | Relationship |
|---|---|---|
| FAFF-1170 | Done | The TypeScript foundation, toolchain, and committed emits on `main` (PR #996) — the surface this axis reads |
| FAFF-1168 | Done | ADR-0132, emit layout d (`.js` beside source) — the layout this axis assumes |
| FAFF-1171 | Backlog | The complementary CI freshness hard gate (rebuild + `git diff`); this ticket is the `faff doctor` heads-up half — non-overlapping |

None supersede this ticket's premise. ADR-0132 states verbatim that the freshness gate (FAFF-1171) and the `faff doctor` stale-emit check (FAFF-1172) are the safety net that makes layout (d) safe, so this slice is ratified and required.

## 8. DONE — Definition of Done

### From WHY
- [ ] Running `faff doctor` on a buildable checkout where a `.ts` is newer than its committed `.js` emit exits 1 (the stale-build-goes-unnoticed pain is addressed).

### From WHAT (types and interfaces)
- [ ] `gatherDoctorState` carries `staleEmits: List<StaleEmitPair>` and `emitCheckActive: Boolean` on its state.
- [ ] The exit expression gains the `staleEmits.length > 0` disjunct and is still computed exactly once.
- [ ] `buildDoctorJson` adds `emit_check` ("active" | "skipped") and `stale_emits` (array, always present) to both the empty-union and the main return objects.

### From WHAT (behaviour)
- [ ] The axis fires only when the TypeScript toolchain is resolvable under `tsconfig_dir/node_modules` (a filesystem probe for `typescript`, no spawn); otherwise `emit_check == "skipped"`, `stale_emits == []`, no exit contribution.
- [ ] The axis directory resolves as `join(root, "plugin", "skills", "faff")` where `root` is the doctor `--root` override else `findRoot()` — never a hardcoded absolute path.
- [ ] The pair set is derived from `plugin/skills/faff/tsconfig.json` `include`, resolved relative to that file's directory, with no hardcoded filenames.
- [ ] A pair is flagged only when the `.ts` mtime is strictly greater than the `.js` mtime.
- [ ] `renderHuman` prints one `✗ … emit older than source … — run the build` line per stale pair, and `✓ TypeScript emits up to date` when the axis is active and clean; it prints nothing for the axis when skipped.
- [ ] On exit 1, the `Fix:` line includes `npm run build  (from plugin/skills/faff/)`, `&&`-joined with any other fixes.
- [ ] `renderJson` and `renderHuman` return the same `state.exit`; neither recomputes it.

### From HOW (edge cases and fail-safe)
- [ ] Toolchain not resolvable (no `node_modules/typescript`) → `emit_check == "skipped"`, `stale_emits == []`, no contribution to exit — even when tsconfig + `.ts` + a stale `.js` are all present (the adopter-copy case).
- [ ] Absent, unreadable, or unparseable tsconfig → `emit_check == "skipped"`, `stale_emits == []`, no contribution to exit.
- [ ] `include` missing, empty, or not a string array → axis skipped, clean.
- [ ] A `.ts` with no committed `.js` beside it → clean (not flagged); other pairs still checked.
- [ ] Equal mtimes → not flagged.

### From HOW (autonomous behaviour, inherited — not tested here)
- [ ] An autonomous entry on a stale-emit exit 1 logs the finding and continues, never prompts, never mutates `~/.claude` — this is the existing gateway preamble's behaviour on any doctor exit 1 and is out of scope for this slice's code; no new test asserts it (see §2).

### Test coverage
- [ ] `test/doctor.test.mjs` gains unit cases for: stale pair on a buildable fixture → exit 1 and named file; fresh build → clean; **adopter copy (tsconfig + `.ts` + stale `.js` but no `node_modules/typescript`) → skipped/clean**; toolchain present but no tsconfig → skipped; `--json` reflects `emit_check` and `stale_emits` with matching exit. Each fixture holds the other axes constant (populated skill union via `--target`, a fenced `--root`) so the asserted exit code is attributable to the stale-emit axis alone.
- [ ] `test/golden/doctor/` gains (or updates) a golden capturing the stale-emit human output, consistent with the byte-exact approach the existing goldens use.

**Integration smoke test.**

The fixture must reach the stale-emit axis and make the asserted exit code attributable to it alone. Three axes are held constant, mirroring the existing `test/doctor.test.mjs` idiom (`--target <dir>` of live symlinks + a fenced `--root`):

1. **Skill union populated** — a scanned skills directory passed via `--target` containing at least one *live-symlinked* faff skill (e.g. `symlinkSync("/tmp", join(skillsDir, "faff-graft"))`). This keeps `gatherDoctorState`'s union non-empty, so `emptyUnion` is false and the exit rule reaches the fault disjunct instead of early-returning exit 2. A symlink (not a copy) avoids a spurious copy fault.
2. **Merge fence present** — `<temp>/.claude/settings.json` registering the `faff merge-fence --hook` PreToolUse hook, so `mergeFencePresentAt(<temp>)` is true and the fence axis does not drive exit 1.
3. **Buildable** — `<temp>/plugin/skills/faff/node_modules/typescript/package.json` present (the installed-toolchain signal) so the stale-emit axis fires.

```
PROCEDURE smoke():
  1. Build a temp root <temp> mirroring plugin/skills/faff/ with:
       - tsconfig.json whose include lists one bin/lib/<name>.ts, plus a committed <name>.js beside it;
       - node_modules/typescript/package.json present (buildable signal);
       - .claude/settings.json registering the faff merge-fence PreToolUse hook (fence present);
     and a separate skills dir <skills> holding one live-symlinked faff skill (union populated).
  2. Set mtime(<name>.js) strictly older than mtime(<name>.ts).
  3. Run `faff doctor --root <temp> --target <skills>`.
  4. ASSERT exit == 1
       AND output names <name>.js on a "emit older than source … — run the build" line
       AND the Fix line contains "npm run build".
  5. Touch <name>.js so its mtime >= the source's; run `faff doctor --root <temp> --target <skills>` again.
  6. ASSERT exit == 0 (stale-emit axis clean; union populated, fence present, no copy fault — no other axis faults)
       AND emit_check reports "active" with stale_emits == [] under --json.
  7. Remove <temp>/plugin/skills/faff/node_modules; set mtime(<name>.js) strictly older than <name>.ts again;
     run `faff doctor --root <temp> --target <skills> --json`.
  8. ASSERT emit_check == "skipped" AND stale_emits == [] AND exit == 0
       (the adopter-copy case: not buildable → axis skipped despite the stale pair).
```

Step 6 is now fenced: the only exit-1 drivers in the fixture are the stale-emit axis (cleared at step 5), the fence axis (held present at setup step 2 of the fixture), copy faults (avoided by symlinking), and the empty union (avoided by the populated `--target`), so a clean stale-emit axis yields exit 0 deterministically. Step 7–8 pin the ratified buildable gate end to end.
