// ===========================================================================
// === region:factory — gates-doctor — the `faff doctor` install-health check and its `faff sync` repair ===
// Split out of gates.js (FAFF-1390), which re-exports every name it exported before.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parseArgs, usageError } = require("./argv");
const { loadConfig } = require("./config");
const hooksEnsure = require("./hooks-ensure");
const { faffHookKeysIn, fenceCoversBash } = hooksEnsure;
const { dig, findRoot, homeDir, mainWorktreeRoot } = require("./shared-infra");

const SYNC_SPEC = { flags: { "--json": { arity: 0 }, "--dry-run": { arity: 0 }, "--script": { arity: 1 } } };
const DOCTOR_SPEC = { flags: { "--target": { arity: 1 }, "--root": { arity: 1 }, "--json": { arity: 0 } } };

// FAFF-190: install-health check. The faff skills can be installed as real-dir COPIES (e.g. a
// marketplace install) rather than symlinks to the repo — in which case shipped repo changes don't
// go live until `link-skills.sh --global --replace`. This reads the FILESYSTEM (is <dir> a symlink?),
// so it reports correctly even when run from a stale installed bin/faff — it is not circular.
// FAFF-434/FAFF-1295: is the merge-fence PreToolUse hook registered? Claude Code merges the
// hooks of .claude/settings.json (shared) and .claude/settings.local.json (personal), so this
// reads both, each on its own: one bad file never hides the other's hooks. Independent of the
// --target skills-dir scan (a different install-health axis). An absent file is the common
// pre-hooks-ensure state, not a doctor fault. A file that exists but cannot be read is its own
// named finding ("invalid"), never "missing": the "missing" remedy (`faff hooks-ensure`) exits 2
// on that same file. Read-only: nothing in either file is written, normalised or deleted.
// `error` is always a fixed string (only an fs error code is interpolated), never the parser's
// message, because V8's JSON.parse messages quote the input and settings files carry credentials.
function readHookSettingsFile(absPath, scope) {
  const base = { path: absPath, scope, state: "absent", error: null, covers_bash_fence: false, faff_hooks: [] };
  const invalid = (error) => ({ ...base, state: "invalid", error });
  let text;
  // No existsSync pre-check: a file removed between the check and the read would read as
  // invalid. ENOENT on the read itself is the absent state.
  try { text = fs.readFileSync(absPath, "utf8"); }
  catch (e) {
    if (e && e.code === "ENOENT") return base;
    return invalid(`cannot read file (${e && e.code ? e.code : "unknown"})`);
  }
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { return invalid("not valid JSON"); }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return invalid("top-level value is not a JSON object");
  }
  return { ...base, state: "ok", covers_bash_fence: fenceCoversBash(parsed), faff_hooks: faffHookKeysIn(parsed) };
}

// Never throws. fence_status: present when either readable file holds a merge-fence under a
// matcher that fires on Bash; else unconfirmed when a file is invalid (the fence may be in it);
// else missing.
function hookSettingsAt(root) {
  const dir = path.join(root, ".claude");
  const shared = readHookSettingsFile(path.join(dir, "settings.json"), "shared");
  const personal = readHookSettingsFile(path.join(dir, "settings.local.json"), "personal");
  const inPersonal = new Set(personal.faff_hooks);
  const in_both = shared.faff_hooks.filter((k) => inPersonal.has(k));
  let fence_status;
  if (shared.covers_bash_fence || personal.covers_bash_fence) fence_status = "present";
  else if (shared.state === "invalid" || personal.state === "invalid") fence_status = "unconfirmed";
  else fence_status = "missing";
  return { shared, personal, in_both, fence_status };
}

function mergeFencePresentAt(root) {
  return hookSettingsAt(root).fence_status === "present";
}

// FAFF-1172: the stale-emit install-health axis. Under the TypeScript emit layout (ADR-0132,
// layout d) the committed `.js` beside each `.ts` is what every install path runs; a contributor
// who edits a `.ts` and forgets to rebuild silently runs a stale emit until CI fails. This axis
// compares each committed `.js` against its `.ts` source by mtime and flags a strictly-newer
// source. It FIRES ONLY where the build is runnable here — a resolvable `plugin/skills/faff`
// TypeScript toolchain — and skips otherwise (an adopter marketplace copy ships tsconfig + `.ts`
// + `.js` yet cannot rebuild, so a finding there is unactionable noise). Ratified by the decision
// `stale-emit-check-fires-only-where-buildable` (docs/decisions.md, Ratified-by: human). It is a
// filesystem probe only — never spawns tsc/npm, so doctor stays cheap and tsc-free — and fails
// toward clean (skip) on every absent/unreadable input; doctor is a heads-up, not the byte-exact
// gate (that is FAFF-1171's CI rebuild-and-diff).
function isFileAt(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

// True iff the TypeScript compiler is installed and resolvable under tsconfigDir — the same signal
// `npm run build` needs to run at all. A filesystem probe, never a spawn.
function buildToolchainResolvable(tsconfigDir) {
  return isFileAt(path.join(tsconfigDir, "node_modules", "typescript", "package.json"))
      || isFileAt(path.join(tsconfigDir, "node_modules", ".bin", "tsc"));
}

// Returns { active, stale }: `active` is true only where the build is runnable AND at least one
// real `.ts`/`.js` pair resolved (minor fix, human-accept 2026-10-05 — a glob or all-non-`.ts`
// include that resolves to zero pairs reports inactive/skip, never "active / up to date" while
// checking nothing). `stale` is empty when the axis is clean OR skipped.
function gatherStaleEmits(root) {
  const tsconfigDir = path.join(root, "plugin", "skills", "faff");
  if (!buildToolchainResolvable(tsconfigDir)) return { active: false, stale: [] };

  let config;
  try { config = JSON.parse(fs.readFileSync(path.join(tsconfigDir, "tsconfig.json"), "utf8")); }
  catch { return { active: false, stale: [] }; }

  const includes = config.include;
  if (!Array.isArray(includes) || includes.length === 0 || !includes.every((e) => typeof e === "string")) {
    return { active: false, stale: [] };
  }

  // Pair enumeration from tsconfig `include` (resolved against the tsconfig's own directory), so it
  // auto-extends as more modules convert — never a hardcoded filename set. A pair is counted the
  // moment its `.ts` source resolves; a glob entry (never expanded here) or a vanished source
  // resolves to no file and so counts no pair, which is what keeps the zero-pair case inactive.
  let pairsFound = 0;
  const stale = [];
  for (const entry of includes) {
    if (!entry.endsWith(".ts")) continue;                    // not a TS source
    const src = path.join(tsconfigDir, entry);
    let srcStat;
    try { srcStat = fs.statSync(src); } catch { continue; }   // source gone (or an unexpanded glob) — no pair
    pairsFound++;
    const emit = `${src.slice(0, -3)}.js`;
    let emitStat;
    try { emitStat = fs.statSync(emit); } catch { continue; } // no committed emit → treated as clean
    if (srcStat.mtimeMs > emitStat.mtimeMs) {
      stale.push({ source: entry, emit: path.relative(tsconfigDir, emit) });
    }
  }
  if (pairsFound === 0) return { active: false, stale: [] };  // nothing real to check → skip
  return { active: true, stale };
}

// FAFF-443: classify a live global skill/CLI symlink by WHERE it resolves. A global install
// is machine-wide, so a link resolving into a linked worktree is "live but fragile" — it will
// dangle when that worktree is removed. The target sits in a LINKED worktree iff that checkout's
// own top-level differs from the repo's main checkout: `mainWorktreeRoot(dir)` is the parent of
// the shared git-common-dir (the MAIN checkout — the SAME value from the main checkout AND from
// any linked worktree, since they share the common dir), while `git rev-parse --show-toplevel`
// is THIS checkout's root — they diverge only inside a linked worktree. (`git -C` resolves from
// any path within a checkout, so the target's containing dir is a sufficient probe.) Returns
// "dangling" (target gone / realpath race), "intoWorktree" (fragile), or "live".
function classifyGlobalLink(full) {
  if (!fs.existsSync(full)) return "dangling";       // symlink target gone
  let real;
  try { real = fs.realpathSync(full); }
  catch { return "dangling"; }                        // TOCTOU: raced removal mid-classify
  const dir = path.dirname(real);
  const mainRoot = mainWorktreeRoot(dir);            // main checkout (common-dir parent), or null
  if (!mainRoot) return "live";                       // bare / non-repo / no git → not fragile
  const top = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (top.status !== 0 || !(top.stdout || "").trim()) return "live";
  return path.resolve(mainRoot) !== path.resolve(top.stdout.trim()) ? "intoWorktree" : "live";
}

// FAFF-684: mirrors expand_target() in scripts/link-skills.sh (same rule, kept honest by
// the agreement test rather than shared code). A bare "~" expands to $HOME, a "~/…" entry
// drops the "~" and keeps $HOME + the rest, an absolute path passes through unchanged.
// Anything else (relative, empty, a literal "$HOME" YAML never shell-expands) is unusable —
// the caller skips it and returns null rather than joining it against a working directory.
function expandInstallTarget(entry, home) {
  if (entry === "~") return home;
  if (entry.startsWith("~/")) return path.join(home, entry.slice(2));
  if (path.isAbsolute(entry)) return entry;
  return null;
}

// FAFF-684: read `install.skill_targets` from config via the existing loadConfig + dig idiom
// (as gates.fallback does) — no new parser. Returns the expanded, still-unduped candidate
// list, or an empty array on anything short of a genuinely usable non-empty list (absent key,
// read error, wrong type, empty array, every entry unusable) — the caller falls back to the
// hardcoded default pair on empty, exactly as the bash installer does.
function readConfiguredInstallTargets(root, home) {
  try {
    const [data] = loadConfig(root);
    const raw = dig(data, "install.skill_targets");
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const entry of raw) {
      if (typeof entry !== "string") continue;
      const expanded = expandInstallTarget(entry.trim(), home);
      if (expanded) out.push(expanded);
    }
    return out;
  } catch {
    return [];
  }
}

// FAFF-676: doctor's default scan set must match the installer's global target list
// (scripts/link-skills.sh), or doctor is lying about what it looked at. `--target` and
// `$CLAUDE_PLUGIN_ROOT` each still resolve to exactly one directory — unchanged in effect,
// only rewrapped to return a one-element list. Only the home-directory default branch grows,
// to the SAME two directories the installer writes to in global mode, in the SAME order.
// This is the ONLY place in gates.js naming .claude / .agents as skills directories — see
// the installer-and-doctor agreement test in test/link-skills-worktree.test.mjs, which is
// what keeps this list honest against scripts/link-skills.sh's TARGET_DIRS rather than a
// promise that the two never drift apart.
//
// FAFF-684: the home-directory default branch is now sourced from the install.skill_targets
// config key when it resolves to a non-empty, usable list; `root` is threaded in only for
// that read (cmdDoctor already resolves it via findRoot()). Unset/unusable falls back to
// exactly the hardcoded pair below — unchanged from FAFF-676.
//
// FAFF-675: every return now also carries `expectCopies` — true ONLY on the pluginRootEnv
// branch below. A marketplace-plugin install ships its skills as copied (real) directories
// under $CLAUDE_PLUGIN_ROOT by construction — that is the correct shape there and nowhere
// else (ADR-0097: the plugin root is authoritative for the invoking harness, an alternative
// to the global pair, never folded in alongside it — see that record for the full
// rationale and FAFF-685 as the named revisit trigger). `expectCopies` is what tells
// scanDoctorDirectory to read a copied entry as an expected install rather than a copy
// fault.
function assertScanSetExpectCopiesInvariant(result) {
  // FAFF-675: `expectCopies` is a SCAN-SET-WIDE boolean, sound only while its sole `true`
  // branch (pluginRootEnv, below) stays single-element — there is no per-directory record to
  // get wrong today. A future change that makes that branch multi-element (the FAFF-685
  // additive fold) MUST switch to per-directory {directory, expectCopies} records FIRST; this
  // assert is the tripwire that forces that ordering — it throws here, at the return site,
  // rather than letting a real copy fault on a non-plugin directory silently render as
  // "✓ … expected".
  if (result.expectCopies && result.scanSet.length !== 1) {
    throw new Error(
      `resolveDoctorScanSet invariant violated: expectCopies=true with a ${result.scanSet.length}-element ` +
      "scanSet — expectCopies is scan-set-wide and only sound while single-element; switch to " +
      "per-directory {directory, expectCopies} records before making this branch multi-element (FAFF-685).",
    );
  }
  return result;
}

function resolveDoctorScanSet(targetFlag, pluginRootEnv, home, root) {
  if (targetFlag) return assertScanSetExpectCopiesInvariant({ scanSet: [targetFlag], collapseNotices: [], expectCopies: false });
  // ADR-0097: the plugin root is authoritative for the invoking harness — an alternative
  // scan target, never additive with the global pair below. See that record before changing
  // this branch's shape.
  if (pluginRootEnv) return assertScanSetExpectCopiesInvariant({ scanSet: [path.join(pluginRootEnv, "skills")], collapseNotices: [], expectCopies: true });
  const configured = root ? readConfiguredInstallTargets(root, home) : [];
  const candidates = configured.length > 0
    ? configured
    : [path.join(home, ".claude", "skills"), path.join(home, ".agents", "skills")];
  return assertScanSetExpectCopiesInvariant({ ...dedupeByResolvedPath(candidates), expectCopies: false });
}

// Mirrors dedupe_by_resolved_path in scripts/link-skills.sh (same rule, kept honest by the
// agreement test rather than shared code — one's bash, one's Node). A path that does not
// exist can alias nothing, so it resolves to itself rather than throwing.
function dedupeByResolvedPath(candidates) {
  const kept = [];
  const seen = new Map(); // resolved path -> first literal path that produced it
  const collapseNotices = [];
  for (const p of candidates) {
    let resolved;
    try { resolved = fs.realpathSync(p); } catch { resolved = p; }
    if (seen.has(resolved)) {
      collapseNotices.push(`${p} resolves to ${seen.get(resolved)} — treating them as one target`);
      continue;
    }
    seen.set(resolved, p);
    kept.push(p);
  }
  return { scanSet: kept, collapseNotices };
}

const isFaffSkillName = (n) => n === "faff" || n.startsWith("faff-") || n.startsWith("faffter-") || n.startsWith("faffidavit-");

// Scans ONE directory and classifies every faff-owned entry — exactly today's per-skill
// logic (live / intoWorktree / dangling / copy), unchanged. Never throws: an unreadable or
// absent directory is recorded as such and returned, not an early exit — the caller decides
// what an all-unreadable scan set means (FAFF-676's whole point: a single bad directory must
// not go silent while another scanned directory is healthy).
//
// FAFF-675: `expectCopies` (true only for the plugin-root scan, see resolveDoctorScanSet)
// makes a copied, non-symlink entry read as an EXPECTED install rather than a copy FAULT —
// `expected` is a distinct counter from `copies`, so an expected copy never contributes to
// the exit-driving fault count. `targetOverridesPluginRoot` is narrower: true only when an
// explicit --target was given WHILE $CLAUDE_PLUGIN_ROOT is also set, so the operator
// auditing that target as dev-linked (the --target semantics, unchanged) gets a COPY line
// that names WHY it's being read as a fault despite a plugin root being present, rather than
// the plain classic wording — see the --target edge case in the FAFF-675 spec §4.
function scanDoctorDirectory(directory, expectCopies, targetOverridesPluginRoot) {
  let entries;
  try { entries = fs.readdirSync(directory).filter(isFaffSkillName).sort(); }
  catch (e) {
    const reason = e.code === "ENOENT" ? "not present" : `unreadable: ${e.message}`;
    return { directory, readable: false, reason, namesFound: new Set(), copies: 0, dangling: 0, intoWorktree: 0, expected: 0, findings: [] };
  }
  let copies = 0;
  let dangling = 0;
  let intoWorktree = 0;
  let expected = 0;
  const findings = [];
  const namesFound = new Set();
  for (const name of entries) {
    namesFound.add(name);
    const full = path.join(directory, name);
    let st;
    try { st = fs.lstatSync(full); } catch { continue; }
    if (st.isSymbolicLink()) {
      // A symlink is healthy only if its target resolves. lstat answers "is-a-symlink"
      // without following the link, so a dangling link (a rename-orphan, FAFF-296) reads
      // as healthy. existsSync follows the link — false ⇒ target gone ⇒ dangling. (FAFF-299)
      // FAFF-443: a live link may still be FRAGILE if it resolves into a linked worktree.
      const state = classifyGlobalLink(full);
      if (state === "live") {
        findings.push(`✓ ${name}  symlink (live → repo)`);
      } else if (state === "intoWorktree") {
        intoWorktree++;
        findings.push(`⚠ ${name}  symlink (live → WORKTREE, not main checkout — will dangle when the worktree is removed)`);
      } else {
        dangling++;
        findings.push(`✗ ${name}  symlink-dangling (target gone — stale orphan)`);
      }
    } else if (expectCopies) {
      expected++;
      findings.push(`✓ ${name}  plugin install (copy under $CLAUDE_PLUGIN_ROOT — expected, not dev-linked)`);
    } else if (targetOverridesPluginRoot) {
      copies++;
      findings.push(`✗ ${name}  COPY — --target audits as a dev-linked install; omit --target to audit as a plugin install`);
    } else {
      copies++;
      findings.push(`✗ ${name}  COPY — not dev-linked; shipped changes won't go live`);
    }
  }
  return { directory, readable: true, reason: entries.length === 0 ? "no faff skills here" : null, namesFound, copies, dangling, intoWorktree, expected, findings };
}

// render_missing (spec HOW → "How much an empty directory prints"): a directory that found
// NOTHING is one fact, stated once — never one MISSING line per skill, which would turn the
// most-seen post-FAFF-672 report (a healthy ~/.claude/skills beside an absent
// ~/.agents/skills) into thirty near-identical lines burying the RESULT line. A directory
// missing only a SUBSET gets one line per missing skill, uncapped — that is the genuinely
// per-skill fact worth naming.
function renderDoctorScanBody(scan, unionSize) {
  if (scan.namesFound.size === 0) {
    return [`✗ ${scan.reason} — all ${unionSize} faff skill(s) found elsewhere are MISSING here`];
  }
  const lines = [...scan.findings];
  for (const name of scan.missingHere) lines.push(`✗ ${name}  MISSING here — this harness cannot see it`);
  return lines;
}

// FAFF-675: gathers EVERY install-health axis into one DoctorState, computing `exit` exactly
// ONCE — before either renderer runs. renderHuman/renderJson below differ only in how they
// PRESENT this same state; neither recomputes, short-circuits, or skips an axis. This is what
// makes human/--json exit parity a structural property (both return `state.exit` verbatim)
// rather than a discipline the two renderers would each have to remember to honour — see the
// "compute-once-then-branch" anti-pattern note in the FAFF-675 spec for the failure this
// closes (an early return inside one branch silently skipping an axis like the fence check).
function gatherDoctorState(scanSet, collapseNotices, expectCopies, root, targetOverridesPluginRoot) {
  // Explicit arrow, not a bare `.map(scanDoctorDirectory)` reference — Array.map passes
  // (element, index, array), so a bare reference would silently pass the scan-set INDEX as
  // `expectCopies` (0/falsy for the sole element of a single-directory scan set, defeating
  // the carve-out while looking like it worked).
  const scans = scanSet.map((d) => scanDoctorDirectory(d, expectCopies, targetOverridesPluginRoot));

  // FAFF-676: exit 2 ("nothing installed anywhere") is evaluated ACROSS every scanned
  // directory, never per-directory-early — a single bad directory must not go silent while
  // another scanned directory is healthy. FAFF-675: this no longer returns early to stderr;
  // it folds into `state.exit` like every other axis, so the --json renderer cannot skip it.
  const union = new Set();
  for (const s of scans) for (const n of s.namesFound) union.add(n);
  const emptyUnion = union.size === 0;

  for (const s of scans) {
    s.missingHere = emptyUnion ? [] : (s.namesFound.size === 0
      ? [...union].sort()
      : [...union].filter((n) => !s.namesFound.has(n)).sort());
  }

  let copies = 0;
  let dangling = 0;
  let intoWorktree = 0;
  let expected = 0;
  for (const s of scans) { copies += s.copies; dangling += s.dangling; intoWorktree += s.intoWorktree; expected += s.expected; }

  // FAFF-443: same fragility check for the CLI link as the per-skill symlinks above — a
  // worktree-sourced bin/faff dangles too. Machine-wide: runs exactly once per invocation,
  // independent of the scan set size, and independent of whether the union was empty (the
  // bin/faff and merge-fence axes are unrelated to what skills were found).
  let binFaff = "absent";
  const bin = path.join(homeDir(), ".local", "bin", "faff");
  try {
    const bst = fs.lstatSync(bin);
    if (bst.isSymbolicLink()) {
      if (classifyGlobalLink(bin) === "intoWorktree") { binFaff = "symlink-worktree"; intoWorktree++; }
      else binFaff = "symlink-live";
    } else {
      binFaff = "copy";
    }
  } catch { /* bin link optional — stays "absent" */ }

  // FAFF-434/FAFF-1295: the merge-fence PreToolUse registration — a distinct install-health axis
  // from the skill-link scan above (reads <root>/.claude/settings.json and settings.local.json,
  // not a scanned skills dir), folded into the same non-clean exit. An unreadable settings file
  // is its own exit-1 cause. Machine-wide: runs exactly once per invocation. The two settings.json
  // advisories print only when hooks-ensure's default write target is the personal file; the
  // constant is read at call time so a test can stub it.
  const hookSettings = hookSettingsAt(root);
  const fenceStatus = hookSettings.fence_status;
  const fenceOk = fenceStatus === "present";
  const anyInvalidSettings = hookSettings.shared.state === "invalid" || hookSettings.personal.state === "invalid";
  const hookAdvisoriesActive = hooksEnsure.HOOKS_DEFAULT_TARGET === "personal";

  // The plugin root this run's scan short-circuited to, or null. expectCopies is
  // scan-set-wide and (by the return-site invariant on resolveDoctorScanSet) sound only
  // while its sole `true` branch is single-element, so `scanSet[0]` names it exactly.
  const pluginRoot = expectCopies ? scanSet[0] : null;

  // FAFF-1172: the stale-emit axis — one more machine-wide install-health dimension folded into
  // the single exit. Runs once per invocation, independent of the scan set, and skips (contributes
  // nothing) wherever the build is not runnable here.
  const { active: emitCheckActive, stale: staleEmits } = gatherStaleEmits(root);

  const anyMissingHere = scans.some((s) => s.missingHere.length > 0);
  const exit = emptyUnion ? 2 : ((copies > 0 || dangling > 0 || intoWorktree > 0 || anyMissingHere || !fenceOk || anyInvalidSettings || staleEmits.length > 0) ? 1 : 0);

  return {
    scanSet, scans, collapseNotices, unionSize: union.size, emptyUnion,
    copies, dangling, intoWorktree, expected,
    binFaff, fenceOk, hookSettings, fenceStatus, hookAdvisoriesActive, anyInvalidSettings, pluginRoot, anyMissingHere, emitCheckActive, staleEmits, exit,
  };
}

function renderHuman(state) {
  if (state.emptyUnion) {
    process.stderr.write(`faff doctor: no faff skills found under any of: ${state.scanSet.join(", ")}\n`);
    return state.exit;
  }

  const multi = state.scans.length > 1;
  const out = [];
  out.push(multi
    ? `faff doctor — install health (${state.scans.length} directories scanned)`
    : `faff doctor — install health (${state.scans[0].directory})`);
  for (const notice of state.collapseNotices) out.push(`  ${notice}`);
  if (multi) {
    for (const s of state.scans) {
      out.push("");
      out.push(`  ${s.directory}`);
      for (const line of renderDoctorScanBody(s, state.unionSize)) out.push(`    ${line}`);
    }
    out.push("");
  } else {
    for (const line of renderDoctorScanBody(state.scans[0], state.unionSize)) out.push(`  ${line}`);
  }

  if (state.binFaff === "symlink-worktree") {
    out.push(`  ⚠ bin/faff  symlink (live → WORKTREE, not main checkout — will dangle when the worktree is removed)`);
  } else if (state.binFaff === "symlink-live") {
    out.push(`  ✓ bin/faff  symlink (live)`);
  } else if (state.binFaff === "copy") {
    out.push(`  • bin/faff  real file (copy)`);
  }

  if (state.fenceStatus === "present") out.push(`  ✓ merge-fence PreToolUse fence present`);
  else if (state.fenceStatus === "unconfirmed") out.push(`  ✗ merge-fence PreToolUse fence unconfirmed: a settings file is unreadable (below)`);
  else out.push(`  ✗ merge-fence PreToolUse fence MISSING — run: faff hooks-ensure`);
  const invalidFiles = [state.hookSettings.shared, state.hookSettings.personal].filter((f) => f.state === "invalid");
  const relSettings = (f) => `.claude/${path.basename(f.path)}`;
  for (const f of invalidFiles) {
    out.push(`  ✗ ${relSettings(f)}  invalid (${f.error}); fix or remove it, faff cannot read hooks from it`);
  }
  if (state.hookAdvisoriesActive) {
    const sharedKeys = state.hookSettings.shared.faff_hooks;
    if (sharedKeys.length > 0) {
      out.push(`  ⚠ faff hooks in .claude/settings.json (a file teams often commit): ${sharedKeys.join(", ")}; expected only if this team runs faff hooks-ensure --shared, otherwise remove them by hand`);
    }
    if (state.hookSettings.in_both.length > 0) {
      out.push(`  ⚠ faff hooks registered in both settings files: ${state.hookSettings.in_both.join(", ")}; remove the copy in .claude/settings.json unless this team runs faff hooks-ensure --shared`);
    }
  }

  // FAFF-1172: the stale-emit axis line. Printed only where the axis is active (the build is
  // runnable here); a skipped axis prints nothing — there is nothing to check.
  if (state.emitCheckActive) {
    if (state.staleEmits.length === 0) {
      out.push(`  ✓ TypeScript emits up to date`);
    } else {
      for (const pair of state.staleEmits) {
        out.push(`  ✗ ${pair.emit}  emit older than source ${pair.source} — run the build`);
      }
    }
  }

  if (state.exit === 1) {
    out.push("");
    out.push(doctorResultLine(state));
    const fixes = [];
    if (state.copies > 0 || state.dangling > 0 || state.intoWorktree > 0 || state.anyMissingHere) fixes.push("bash scripts/link-skills.sh --global --replace --prune  (from the main checkout)");
    // hooks-ensure exits 2 on an unreadable settings file, so it is not the remedy while one exists.
    if (state.fenceStatus === "missing" && invalidFiles.length === 0) fixes.push("faff hooks-ensure");
    for (const f of invalidFiles) fixes.push(`fix the JSON in ${relSettings(f)}`);
    if (state.staleEmits.length > 0) fixes.push("npm run build  (from plugin/skills/faff/)");
    out.push(`Fix: ${fixes.join(" && ")}`);
    console.log(out.join("\n"));
    return state.exit;
  }

  out.push("");
  out.push(doctorResultLine(state));
  console.log(out.join("\n"));
  return state.exit;
}

// FAFF-1435: the human renderer's RESULT line, shared with `faff run summary` (which quotes it
// in its install-health warning) so the two can never word the verdict differently. Defined for
// a non-empty scan union, the only state in which the human renderer prints a RESULT line.
function doctorResultLine(state) {
  if (state.exit === 1) {
    const invalidFiles = [state.hookSettings.shared, state.hookSettings.personal].filter((f) => f.state === "invalid");
    const problems = [];
    if (state.copies > 0 || state.dangling > 0) problems.push(`${state.copies} copy / ${state.dangling} dangling skill link(s)`);
    if (state.intoWorktree > 0) problems.push(`${state.intoWorktree} worktree-sourced link(s) (fragile — will dangle on worktree removal)`);
    for (const s of state.scans) {
      if (s.missingHere.length > 0) problems.push(`${s.missingHere.length} skill(s) missing from ${s.directory}`);
    }
    if (state.fenceStatus === "missing") problems.push("merge-fence PreToolUse fence missing");
    else if (state.fenceStatus === "unconfirmed") problems.push("merge-fence PreToolUse fence unconfirmed");
    if (invalidFiles.length > 0) problems.push(`${invalidFiles.length} unreadable Claude settings file(s)`);
    if (state.staleEmits.length > 0) problems.push(`${state.staleEmits.length} stale TypeScript emit(s)`);
    return `RESULT: ${problems.join(" + ")} — install is not clean.`;
  }
  // FAFF-675: a clean plugin-root scan (expected > 0) is not a dev-linked repo — say so.
  return state.expected > 0
    ? `RESULT: faff skills are a marketplace-plugin install (copies under $CLAUDE_PLUGIN_ROOT) — expected. Nothing to repair.`
    : `RESULT: all faff skills are dev-linked (symlinks) — repo is live.`;
}

// FAFF-1295: the hook_settings wire shape (covers_bash_fence and scope stay internal).
function hookSettingsJson(hs) {
  const file = (f) => ({ path: f.path, state: f.state, error: f.error, faff_hooks: f.faff_hooks });
  return { shared: file(hs.shared), personal: file(hs.personal), in_both: hs.in_both };
}

// FAFF-675: pure state → DoctorJson object builder, no I/O — the total projection of
// DoctorState onto the --json wire shape. Kept separate from renderJson (which owns the
// stdout/stderr side effects) so tests can assert the object shape directly.
function buildDoctorJson(state) {
  if (state.emptyUnion) {
    return {
      scanned: state.scanSet.map((d) => ({
        directory: d, readable: false, reason: "not present", expected_install: d === state.pluginRoot,
        names_found: [], live: 0, copies: 0, dangling: 0, into_worktree: 0, expected: 0, missing_here: [], findings: [],
      })),
      plugin_root: state.pluginRoot, merge_fence: state.fenceOk, bin_faff: state.binFaff,
      merge_fence_status: state.fenceStatus, hook_advisories_active: state.hookAdvisoriesActive,
      hook_settings: hookSettingsJson(state.hookSettings),
      emit_check: state.emitCheckActive ? "active" : "skipped",
      stale_emits: state.staleEmits.map((p) => ({ source: p.source, emit: p.emit })),
      exit: state.exit, ok: state.exit === 0,
    };
  }
  return {
    scanned: state.scans.map((s) => ({
      directory: s.directory,
      readable: s.readable,
      reason: s.reason,
      expected_install: s.directory === state.pluginRoot,
      names_found: [...s.namesFound].sort(),
      live: s.namesFound.size - s.copies - s.dangling - s.intoWorktree - s.expected,
      copies: s.copies,
      dangling: s.dangling,
      into_worktree: s.intoWorktree,
      expected: s.expected,
      missing_here: s.missingHere ?? [],
      findings: s.findings,
    })),
    plugin_root: state.pluginRoot, merge_fence: state.fenceOk, bin_faff: state.binFaff,
    merge_fence_status: state.fenceStatus, hook_advisories_active: state.hookAdvisoriesActive,
    hook_settings: hookSettingsJson(state.hookSettings),
    emit_check: state.emitCheckActive ? "active" : "skipped",
    stale_emits: state.staleEmits.map((p) => ({ source: p.source, emit: p.emit })),
    exit: state.exit, ok: state.exit === 0,
  };
}

function renderJson(state) {
  if (state.emptyUnion) {
    // FAFF-675: the empty-union case still writes the human-readable breadcrumb to stderr
    // (unchanged from main, so a stderr-scraping consumer isn't silently starved by the
    // channel swap) IN ADDITION to the machine-readable object on stdout below.
    process.stderr.write(`faff doctor: no faff skills found under any of: ${state.scanSet.join(", ")}\n`);
  }
  console.log(JSON.stringify(buildDoctorJson(state), null, 2));
  return state.exit;
}

function cmdDoctor(args) {
  const { values, errors } = parseArgs(args, DOCTOR_SPEC);
  if (errors.length) return usageError(errors, "usage: faff doctor [--target DIR] [--root DIR] [--json]");
  const targetFlag = values["--target"] === undefined ? null : values["--target"];
  let root = values["--root"] === undefined ? null : values["--root"];
  root = root || findRoot();
  const asJson = !!values["--json"];

  const pluginRootEnv = process.env.CLAUDE_PLUGIN_ROOT;
  const { scanSet, collapseNotices, expectCopies } = resolveDoctorScanSet(targetFlag, pluginRootEnv, homeDir(), root);
  // FAFF-675: --target wins the short-circuit outright (expectCopies is false whenever a
  // target was given), but when a plugin root is ALSO set the operator is deliberately
  // auditing it as dev-linked — name that in the COPY line rather than the plain wording.
  const targetOverridesPluginRoot = !!(targetFlag && pluginRootEnv);

  const state = gatherDoctorState(scanSet, collapseNotices, expectCopies, root, targetOverridesPluginRoot);

  // Neither renderer computes an exit; both return state.exit verbatim — parity by
  // construction, not by discipline (see gatherDoctorState's header comment).
  return asJson ? renderJson(state) : renderHuman(state);
}

// FAFF-204: locate scripts/link-skills.sh by a layered resolver that survives the
// stale copy-install state sync exists to repair. An explicit --script wins outright
// (and, if unreadable, fails loud against exactly that path — never silently replaced
// by a default). Otherwise: (1) the cwd/repo anchor via findRoot — the only anchor that
// holds when the CLI is a real-file copy rather than a symlink into the repo; then
// (2) walk-up-from-self — the legacy anchor, which only resolves when the CLI is a
// symlink into the repo (linked-dev run from outside the tree). Returns the first
// readable candidate plus the ordered list of every candidate tried (de-duplicated),
// for the fail-loud message.
function resolveSyncScript(scriptOverride) {
  if (scriptOverride) {
    const readable = (() => { try { fs.accessSync(scriptOverride, fs.constants.R_OK); return true; } catch { return false; } })();
    return { path: readable ? scriptOverride : null, tried: [scriptOverride] };
  }
  const candidates = [];
  // Strategy 1 — cwd/repo anchor (survives copy-install): the reliable primary.
  candidates.push(path.join(findRoot(process.cwd()), "scripts", "link-skills.sh"));
  // Strategy 2 — walk up from the CLI's own resolved location. bin/faff lives at
  // <repo>/plugin/skills/faff/bin/faff → repo root is four dirs up from bin/. Only
  // resolves the repo when the CLI is a symlink into it (i.e. a linked-dev install).
  let self;
  try { self = fs.realpathSync(process.argv[1]); } catch { self = process.argv[1]; }
  const selfCandidate = path.join(path.resolve(path.dirname(self), "..", "..", "..", ".."), "scripts", "link-skills.sh");
  if (!candidates.includes(selfCandidate)) candidates.push(selfCandidate);

  for (const c of candidates) {
    try { fs.accessSync(c, fs.constants.R_OK); return { path: c, tried: candidates.slice(0, candidates.indexOf(c) + 1) }; }
    catch { /* not readable — try the next candidate */ }
  }
  return { path: null, tried: candidates };
}

// FAFF-200: skill-owned repair for a stale copy-install. A thin wrapper over the
// tested scripts/link-skills.sh --global --replace (re-links the skill dirs + the CLI
// onto PATH). The repair logic is NOT reimplemented in Node — single source of truth.
// Never auto-run in autonomous mode (it mutates ~/.claude outside any PR): the caller
// (the gateway doctor-at-entry check) only invokes it on an interactive human accept.
function cmdSync(args) {
  const { values, errors } = parseArgs(args, SYNC_SPEC);
  if (errors.length) return usageError(errors, "usage: faff sync [--dry-run] [--script PATH] [--json]");
  const dryRun = !!values["--dry-run"];
  const asJson = !!values["--json"];
  const scriptOverride = values["--script"] === undefined ? null : values["--script"];

  const { path: scriptPath, tried } = resolveSyncScript(scriptOverride);
  if (!scriptPath) {
    process.stderr.write(`faff sync: cannot find link-skills.sh (tried: ${tried.join(", ")})\n`);
    return 2;
  }

  const linkArgs = ["--global", "--replace", ...(dryRun ? ["--dry-run"] : [])];
  const r = spawnSync("bash", [scriptPath, ...linkArgs], { stdio: asJson ? "pipe" : "inherit", encoding: "utf8" });
  if (r.error) { process.stderr.write(`faff sync: failed to run ${scriptPath}: ${r.error.message}\n`); return 2; }

  const result = { script: scriptPath, ran: !dryRun, dry_run: dryRun, exit: r.status, ok: r.status === 0 };
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(r.status === 0
      ? `faff sync: re-linked faff skills to the repo${dryRun ? " (dry-run — nothing changed)" : ""}`
      : `faff sync: link-skills reported exit ${r.status} — see output above`);
  }
  // Pass the script's fail-loud (2) through; map any other non-zero to 1.
  return r.status === 0 ? 0 : (r.status === 2 ? 2 : 1);
}

module.exports = { assertScanSetExpectCopiesInvariant, buildDoctorJson, cmdDoctor, cmdSync, doctorResultLine, gatherDoctorState, hookSettingsAt, mergeFencePresentAt, resolveDoctorScanSet, resolveSyncScript, scanDoctorDirectory };
