// ===========================================================================
// === region:shared-infra — roots, ledgers, yaml subset ===
//
// Extraction layering (three-tier region model, ADR 0042): shared-infra may
// reference NEITHER region's identifiers; governance may reference shared-infra
// ONLY; factory may reference both (the future package-consumer relationship).
// `faff regions check` is the direction lint that enforces this.
// ===========================================================================
// ---------------------------------------------------------------------------
// shared: find the repo root (dir containing .git or .faff), else cwd
// ---------------------------------------------------------------------------

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const HERE = path.resolve(__dirname, "..");
const ENTRYPOINT = path.resolve(__dirname, "..", "faff");

// FAFF-362: the run-heartbeat staleness default. SINGLE SOURCE for both runcheck's
// own liveness gate (heartbeatStaleSecs, runcheck.js) and DELIVERY_PROFILE.sentry.
// thresholds.stall_window_secs (governance-profile.js) — the profile references
// this constant rather than restating 900. Lives here (shared-infra), not in
// runcheck.js, purely to break a require cycle: governance-profile.js needs this
// value to build DELIVERY_PROFILE, while runcheck.js needs governance-profile.js
// for its threaded profile default parameter — putting the constant in the module
// BOTH already depend on (shared-infra) avoids the cycle. runcheck.js re-exports
// it unchanged so every existing consumer (sentry.js) is untouched.
const RUN_HEARTBEAT_STALE_SECS_DEFAULT = 900;

function findRoot(start = process.cwd()) {
  let d = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(d, ".git")) || fs.existsSync(path.join(d, ".faff"))) return d;
    const parent = path.dirname(d);
    if (parent === d) return path.resolve(start);
    d = parent;
  }
}

// FAFF-865 — relocated from bundle-recover.js (re-exported there for surface stability).
// A CLEAN/verified bundle's anchors member proves nothing about the rel-paths encoded
// inside its bytes being safe to join onto a real directory. Reject absolute paths and
// any ".."-segment before ever touching disk. Lives here (a true leaf module: no
// internal `require("./…")`) so both bundle.js and bundle-recover.js can import it
// without either introducing a circular require.
function isSafeAnchorRelPath(rel) {
  if (typeof rel !== "string" || rel === "" || path.isAbsolute(rel)) return false;
  return !rel.split("/").some((seg) => seg === "..");
}

// ---------------------------------------------------------------------------
// shared: the subtree-of-mandate containment walk (FAFF-219/222) — pure, no I/O.
// Lives here (not in contain.js's factory region) because BOTH `contain` (factory,
// the CLI surface) and `audit` (governance, FAFF-354's recompute-and-compare) need
// it, and governance may reference shared-infra only, never factory (ADR 0042).
// ---------------------------------------------------------------------------

// The single upward containment edge for a node, chosen by its type (the
// parentId-dominant cross-project membership rule — see ADR 0012). Returns the
// container-parent id, or null (a root: no edge of the applicable kind). Pure, no
// throw. An absent `type` defaults to "issue" (backward compat); an unknown `type`
// value never reaches here — parseAncestry rejects it with usage exit 2.
function containerParent(entry) {
  if (!entry || typeof entry !== "object") return null;
  const type = entry.type || "issue";
  if (type === "issue") {
    // parentId FIRST (the tightest, most-intentional edge), then jump to the
    // containing project at a top-level issue; a top-level issue with no project = root.
    if (typeof entry.parentId === "string") return entry.parentId;
    if (typeof entry.projectId === "string") return entry.projectId;
    return null;
  }
  if (type === "project") {
    return typeof entry.initiativeId === "string" ? entry.initiativeId : null;
  }
  // type === "initiative": top of the hierarchy, no container edge.
  return null;
}

// Pure subtree-membership walk. `parent` is the intended parent id, or the ROOT
// sentinel (null) for an intended new root. `entryOf` maps id → the typed AncestryEntry
// (undefined when unknown/absent — the agent's fetched ancestry). Walks from `parent`
// upward following each node's TYPED containment edge (containerParent); reaching
// `mandate` → "contained"; exhausting to a root ≠ mandate, an unknown link, an unknown
// node, or a cycle → "outward" (fail-closed). Returns "contained" | "outward". No I/O,
// no throw. Note ids are compared by id only — Linear's issue/project/initiative id
// namespaces are disjoint, so the walk needs no mandate-type argument.
const CONTAIN_ROOT = null; // the --root sentinel: an intended new root
function subtreeContains(mandate, parent, entryOf) {
  if (parent === CONTAIN_ROOT) return "outward";  // intended new root — never contained
  const lookup = entryOf instanceof Map ? (id) => entryOf.get(id) : (id) => entryOf[id];
  let cursor = parent;
  const visited = new Set();
  while (cursor !== null && cursor !== undefined && !visited.has(cursor)) {
    if (cursor === mandate) return "contained";    // base case + transitive ancestor reached
    visited.add(cursor);
    const entry = lookup(cursor);                  // undefined if unknown/absent → null below
    cursor = entry ? containerParent(entry) : null;
  }
  return "outward"; // walked to a root ≠ mandate, hit an unknown link, an unknown node, or a cycle
}

// Build the id→entry lookup from the agent-supplied ancestry array. Each entry is a
// typed AncestryEntry {id, type?, parentId?, projectId?, initiativeId?} (FAFF-222) —
// a typed SUPERSET of FAFF-219's {id, parentId}. An absent `type` ⇒ "issue"; absent
// edge fields ⇒ no edge of that kind (→ fail-closed outward when the walk exhausts
// there). Throws on a non-array / malformed shape / UNKNOWN `type` value so the
// caller can map it to a usage exit (2) rather than a silent wrong verdict.
const CONTAIN_ENTRY_TYPES = new Set(["issue", "project", "initiative"]);
function parseAncestry(json) {
  const arr = JSON.parse(json); // may throw → caught by caller
  if (!Array.isArray(arr)) throw new Error("--ancestry must be a JSON array of {id, type?, parentId?, projectId?, initiativeId?}");
  const m = new Map();
  for (const e of arr) {
    if (!e || typeof e !== "object" || typeof e.id !== "string") {
      throw new Error("--ancestry entries must be objects with a string id");
    }
    if (e.type !== undefined && !CONTAIN_ENTRY_TYPES.has(e.type)) {
      throw new Error(`--ancestry entry type must be one of issue|project|initiative (got ${JSON.stringify(e.type)})`);
    }
    // Store the whole typed entry, coercing absent/non-string edges to null so
    // containerParent reads a clean shape. Untyped {id, parentId} ⇒ {type:"issue",
    // parentId, projectId:null, initiativeId:null} ⇒ edge = parentId ⇒ FAFF-219 walk.
    m.set(e.id, {
      id: e.id,
      type: e.type !== undefined ? e.type : "issue",
      parentId: typeof e.parentId === "string" ? e.parentId : null,
      projectId: typeof e.projectId === "string" ? e.projectId : null,
      initiativeId: typeof e.initiativeId === "string" ? e.initiativeId : null,
    });
  }
  return m;
}

// ---------------------------------------------------------------------------
// shared: the self-intake same-repo/team comparator (FAFF-539) — pure, no I/O.
// The decision core of `faff self-intake`, the mechanical gate on the FAFF-536
// `outward → outward-self-intake` reclassification (ADR-0079). Lives here (not in
// the factory module self-intake.js) because BOTH `self-intake` (factory, the CLI
// surface) and `audit` (governance, the recompute-and-compare) need it, and
// governance may reference shared-infra only, never factory (ADR 0042) — the same
// split as containerParent/subtreeContains above. The SELF side is derived from
// config by the factory wrapper and passed in as a plain argument; this core only
// compares. Ladder is the run-outward idiom INVERTED to fail toward the floor:
// first-matching rung wins, biased toward not-self.
// ---------------------------------------------------------------------------

const SELF_INTAKE_REASONS = ["lane-off", "unresolved-target", "unresolved-self", "team-match", "repo-match", "mismatch"];

// Coerce a raw SelfIntakeTarget onto the closed shape. Anything not a plain object
// degrades to all-null (→ unresolved-target, fail-closed); wrong-typed or empty
// fields coerce to null (an empty scalar must never strict-equal anything).
function normalizeSelfIntakeTarget(raw) {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : {};
  return {
    team: typeof r.team === "string" && r.team !== "" ? r.team : null,
    repo: typeof r.repo === "string" && r.repo !== "" ? r.repo : null,
  };
}

// Coerce a raw SelfIntakeSelf onto the closed shape. lane_on is STRICT-boolean
// (=== true) — a missing/truthy-non-bool lane dial never reads as opted-in.
function normalizeSelfIntakeSelf(raw) {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : {};
  return {
    team: typeof r.team === "string" && r.team !== "" ? r.team : null,
    repo: typeof r.repo === "string" && r.repo !== "" ? r.repo : null,
    lane_on: r.lane_on === true,
  };
}

// PURE decision ladder (spec §4) — one pass, first-matching rung wins, biased
// toward not-self. Comparisons are strict === on the raw strings (case-mismatch
// fails toward not-self — the safe direction; parity with run-outward). Null never
// matches null: the explicit unresolved rungs fire before any equality is tried,
// and each equality requires BOTH sides non-null. Never throws; malformed JSON is
// rejected at the CLI boundary (exit 2), not here.
function decideSelfIntake(targetRaw, selfRaw) {
  const target = normalizeSelfIntakeTarget(targetRaw);
  const self = normalizeSelfIntakeSelf(selfRaw);
  if (self.lane_on !== true) {
    return { target, self, verdict: "not-self", reason: "lane-off" };
  }
  if (target.team === null && target.repo === null) {
    return { target, self, verdict: "not-self", reason: "unresolved-target" };
  }
  if (self.team === null && self.repo === null) {
    return { target, self, verdict: "not-self", reason: "unresolved-self" };
  }
  if (target.team !== null && self.team !== null && target.team === self.team) {
    return { target, self, verdict: "self", reason: "team-match" };
  }
  if (target.repo !== null && self.repo !== null && target.repo === self.repo) {
    return { target, self, verdict: "self", reason: "repo-match" };
  }
  return { target, self, verdict: "not-self", reason: "mismatch" };
}

// Shared mtime-DESC ordering for `.faff/runs/<run-id>` directories (FAFF-337). Three
// run-id mint formats coexist (dash-prefixed date, compact `run-`, and legacy bare
// stamps) with no shared lexical shape, so sorting by NAME is format-dependent and can
// resolve a stale ledger. Ordering by directory mtime is format-independent; the name
// tie-break only disambiguates dirs that share a millisecond (never load-bearing).
function sortRunDirsByMtimeDesc(dirs) {
  return dirs
    .map((p) => {
      let mtimeMs;
      try { mtimeMs = fs.statSync(p).mtimeMs; } catch { mtimeMs = -Infinity; }
      return { p, mtimeMs };
    })
    .sort((a, b) => (b.mtimeMs - a.mtimeMs) || (a.p < b.p ? 1 : a.p > b.p ? -1 : 0))
    .map((x) => x.p);
}

// FAFF-578: candidate discovery tolerates filesystem churn — concurrent sessions
// creating/deleting run dirs is faff's own operating premise, and the turn-end Stop
// hooks (runcheck/sentrycheck) resolve through here at every session's turn-end, so
// a throw here crashes a hook. `runs` deleted (or replaced by a file → ENOTDIR)
// between existsSync and readdirSync → null; a candidate deleted between readdirSync
// and statSync → excluded, scan continues (mirrors state.js runDirsNewestFirst's
// filter and sortRunDirsByMtimeDesc's catch above). Discovery churn only: ledger
// READ faults stay loud (FAFF-425, resolveLedgerOrFault below — unchanged).
function latestRunDir(root) {
  const runs = path.join(root, ".faff", "runs");
  if (!fs.existsSync(runs)) return null;
  let names;
  try { names = fs.readdirSync(runs); } catch { return null; }
  const cands = names
    .map((name) => path.join(runs, name))
    .filter((p) => {
      let st;
      try { st = fs.statSync(p); } catch { return false; }
      return st.isDirectory() && fs.existsSync(path.join(p, "run-ledger.json"));
    });
  if (!cands.length) return null;
  return sortRunDirsByMtimeDesc(cands)[0];
}

// Shared ledger reader (FAFF-65): parse a run's run-ledger.json into its object.
// Used by runcheck's auditRun (per-run completeness audit) AND by `faff state`'s
// resolveLedgerOutcome (per-issue outcome lookup). Sharing the parse is the right
// amount of reuse — neither subcommand subsumes the other (spec OQ3).
function readLedger(runDir) {
  return JSON.parse(fs.readFileSync(path.join(runDir, "run-ledger.json"), "utf8"));
}

// Shared run-dir + ledger resolver (FAFF-425) — used by BOTH `budget check` and
// `sentry check`. Key invariant: own-fault ≠ empty. A run whose ledger can't be
// read (explicitly named and absent, or present-but-corrupt) is a FAULT — the
// caller must surface it loudly (indeterminate), never coerce it into the
// all-clear/unbreached reading a swallowed exception used to produce. A
// legitimately empty surface (no run requested AND no run under the root at
// all) is NOT a fault — it stays the byte-for-byte all-clear path.
//
// Deliberately does NOT fall back to latestRunDir after an explicit
// --run-dir/$FAFF_RUN_DIR whose ledger is gone — that silent fallback is the
// "quietly blind" failure this exists to close.
//
// Returns one of:
//   { fault: string }                 — explicit run named, ledger absent
//   { runDir, fault: string }         — a resolved run dir whose ledger throws on read
//   { runDir: null, empty: true }     — no run requested, none found (legitimate)
//   { runDir, ledger }                — the happy path
function resolveLedgerOrFault(get, root) {
  const requested = get("--run-dir") || process.env.FAFF_RUN_DIR || null;
  // NOTE (adversarial-review follow-up): existsSync here vs. readLedger's own try/catch
  // below is a benign TOCTOU — if the ledger is deleted in the gap, the explicit-run
  // branch reports "absent" for a file that was actually removed a moment later. Either
  // message still lands on the correct outcome (a fault, exit 3); this only affects
  // WHICH of the two fault strings is chosen, never fault-vs-not. The distinct wording
  // exists purely so an operator can tell "never had a ledger" from "ledger vanished/
  // corrupted after being read once" — not a correctness boundary.
  if (requested && !fs.existsSync(path.join(requested, "run-ledger.json"))) {
    return { fault: `explicit run named but its ledger is absent: ${requested}` };
  }
  let runDir = requested || null;
  if (!runDir) runDir = latestRunDir(root);
  if (!runDir) return { runDir: null, empty: true };
  let ledger;
  try {
    ledger = readLedger(runDir);
  } catch (e) {
    return { runDir, fault: `ledger unreadable: ${path.join(runDir, "run-ledger.json")} (${e.message})` };
  }
  return { runDir, ledger };
}

function stripInlineComment(s) {
  const out = [];
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      out.push(c);
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
      out.push(c);
    } else if (c === "#" && (i === 0 || s[i - 1] === " ")) {
      break;
    } else {
      out.push(c);
    }
  }
  return out.join("").replace(/\s+$/, "");
}

function scalar(v) {
  v = v.trim();
  if (!v) return null;
  if ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'")) return v.slice(1, -1);
  // FAFF-26: inline JSON flow values ([...] / {...}) parse to structured data, so config
  // blocks can carry lists/objects (e.g. the `infra:` override). Backward-compatible — a
  // value that isn't valid JSON falls through to the string return below.
  if ((v[0] === "[" && v.at(-1) === "]") || (v[0] === "{" && v.at(-1) === "}")) {
    try { return JSON.parse(v); } catch { /* not JSON — treat as a plain string */ }
  }
  const low = v.toLowerCase();
  if (low === "true" || low === "false") return low === "true";
  if (low === "null" || low === "~") return null;
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  if (/^-?\d*\.\d+$/.test(v)) return parseFloat(v);
  return v;
}

function parseYamlSubset(text) {
  const raw = text.split("\n");
  const n = raw.length;
  const cur = { i: 0 };
  const isSkip = (line) => { const s = line.trim(); return s === "" || s.startsWith("#"); };
  const indentOf = (line) => line.length - line.replace(/^ +/, "").length;

  function collectBlockScalar(parentIndent) {
    const lines = [];
    let base = null;
    while (cur.i < n) {
      const line = raw[cur.i];
      if (line.trim() === "") { lines.push(""); cur.i++; continue; }
      const ind = indentOf(line);
      if (ind <= parentIndent) break;
      if (base === null) base = ind;
      lines.push(line.slice(base));
      cur.i++;
    }
    while (lines.length && lines.at(-1) === "") lines.pop();
    return lines.length ? lines.join("\n") + "\n" : "";
  }

  // a block-sequence item line: a bare "-" or a "- " prefix at the line's own indent.
  const isSeqLine = (s) => s === "-" || s.startsWith("- ");

  // FAFF-262: resolve a key's value given its inline text and the key's own indent.
  // Shared by parseMap and parseSeq map-items so block-scalar / nested-map / nested-seq /
  // scalar handling stays in one place. An empty inline value whose deeper child line opens
  // with "-" parses as a block sequence (array); otherwise a nested map; else null.
  function valueFor(val, ownIndent) {
    if (["|", "|-", "|+", ">", ">-", ">+"].includes(val)) return collectBlockScalar(ownIndent);
    if (val === "") {
      let j = cur.i;
      while (j < n && isSkip(raw[j])) j++;
      if (j < n && indentOf(raw[j]) > ownIndent) {
        const childIndent = indentOf(raw[j]);
        return isSeqLine(stripInlineComment(raw[j].trim())) ? parseSeq(childIndent) : parseMap(childIndent);
      }
      return null;
    }
    return scalar(val);
  }

  // FAFF-262: parse a YAML block sequence (the `- item` list form) into a JS array. Items are
  // scalars (`- foo`), or maps whose first key is inline on the dash line (`- key: val`) with
  // continuation keys aligned to the item content column. Composes with parseMap/valueFor for
  // nested values. scalar() is untouched, so strict-JSON inline flow + JSON-string scalars are
  // unaffected (they never reach here — they are non-empty inline values handled by scalar()).
  function parseSeq(seqIndent) {
    const items = [];
    while (cur.i < n) {
      if (isSkip(raw[cur.i])) { cur.i++; continue; }
      const line = raw[cur.i];
      if (indentOf(line) !== seqIndent) break;
      const content = stripInlineComment(line.trim());
      if (!isSeqLine(content)) break;
      // item content column = first non-space char after the dash (continuation-key alignment).
      let contentCol = seqIndent + 1;
      while (contentCol < line.length && line[contentCol] === " ") contentCol++;
      const remainder = content === "-" ? "" : content.slice(1).trim();
      cur.i++;
      if (remainder === "") {
        // item body (map or nested sequence) on the following deeper lines.
        let j = cur.i;
        while (j < n && isSkip(raw[j])) j++;
        if (j < n && indentOf(raw[j]) > seqIndent) {
          const childIndent = indentOf(raw[j]);
          items.push(isSeqLine(stripInlineComment(raw[j].trim())) ? parseSeq(childIndent) : parseMap(childIndent));
        } else {
          items.push(null);
        }
      } else if (remainder.indexOf(":") === -1) {
        items.push(scalar(remainder)); // array-of-scalars item
      } else {
        // map item: first key inline on the dash line, continuation keys at contentCol.
        const map = {};
        const ci = remainder.indexOf(":");
        map[remainder.slice(0, ci).trim()] = valueFor(remainder.slice(ci + 1).trim(), contentCol);
        while (cur.i < n) {
          if (isSkip(raw[cur.i])) { cur.i++; continue; }
          const cl = raw[cur.i];
          if (indentOf(cl) !== contentCol) break;
          const ct = stripInlineComment(cl.trim());
          if (isSeqLine(ct)) break; // a dash at contentCol is a nested sequence, not a key
          const cci = ct.indexOf(":");
          const ckey = (cci === -1 ? ct : ct.slice(0, cci)).trim();
          const cval = (cci === -1 ? "" : ct.slice(cci + 1)).trim();
          cur.i++;
          map[ckey] = valueFor(cval, contentCol);
        }
        items.push(map);
      }
    }
    return items;
  }

  function parseMap(minIndent) {
    const result = {};
    while (cur.i < n) {
      const line = raw[cur.i];
      if (isSkip(line)) { cur.i++; continue; }
      const ind = indentOf(line);
      if (ind !== minIndent) break;
      const content = stripInlineComment(line.trim());
      if (content === "") { cur.i++; continue; }
      if (isSeqLine(content)) break; // a sequence item is not a map entry
      const ci = content.indexOf(":");
      const key = (ci === -1 ? content : content.slice(0, ci)).trim();
      const val = (ci === -1 ? "" : content.slice(ci + 1)).trim();
      cur.i++;
      result[key] = valueFor(val, minIndent);
    }
    return result;
  }
  return parseMap(0);
}

function dig(data, dotted) {
  let cur = data;
  for (const part of dotted.split(".")) {
    if (cur && typeof cur === "object" && !Array.isArray(cur) && part in cur) cur = cur[part];
    else return null;
  }
  return cur;
}

// Config-file resolution (canonical/legacy names + linked-worktree fallback) — shared:
// the factory config command AND governance readers resolve through this one path,
// so the legacy-name LOUD ERROR (never a silent default) holds in both regions.
// FAFF-50: single canonical config filename. The resolver accepts ONLY `.faffrc.yaml`;
// a legacy-named config (`.faffrc.yml` / `.faffrc`) is a LOUD ERROR, never a silent default —
// the silent-fallback that dropped configured slots twice.
const CANONICAL_CONFIG = ".faffrc.yaml";
const LEGACY_CONFIG = [".faffrc.yml", ".faffrc"];

// FAFF-387: the gitignored, machine-local OVERLAY that merges over the (now
// committable) base file. Same legacy-name discipline as the base: a
// legacy-shaped overlay name is a LOUD error, never a silent skip.
const CANONICAL_OVERLAY_CONFIG = ".faffrc.local.yaml";
const LEGACY_OVERLAY_CONFIG = [".faffrc.local.yml", ".faffrc.local"];

// Shared existence-check + legacy-name-loud-error resolver, parameterised by
// filename set so the base and overlay finders (below) are one implementation,
// never two hand-copies that can drift.
function findNamedIn(base, canonicalName, legacyNames, errorTag) {
  const isFile = (n) => !n.includes(".example") &&
    fs.existsSync(path.join(base, n)) && fs.statSync(path.join(base, n)).isFile();
  const legacy = legacyNames.filter(isFile);
  if (legacy.length) {
    const err = new Error(errorTag);
    err.legacy = legacy;
    throw err;
  }
  return isFile(canonicalName) ? path.join(base, canonicalName) : null;
}

function findConfigIn(base) {
  return findNamedIn(base, CANONICAL_CONFIG, LEGACY_CONFIG, "legacy-config-name");
}

// FAFF-387: overlay counterpart of findConfigIn — same shape, own legacy-name tag
// (legacy-overlay-config-name) so callers can distinguish a base-file problem from
// an overlay-file problem in their error message.
function findOverlayIn(base) {
  return findNamedIn(base, CANONICAL_OVERLAY_CONFIG, LEGACY_OVERLAY_CONFIG, "legacy-overlay-config-name");
}

// FAFF-208: the MAIN worktree's root for a linked git worktree, resolved via git's
// shared common-dir. Returns null outside a repo, on a bare/odd layout, or when `root`
// already IS the main checkout — so the fallback below only ever fires for a linked
// worktree and never changes main-checkout behaviour. Read-only git.
function mainWorktreeRoot(root) {
  const r = spawnSync("git", ["-C", root, "rev-parse", "--git-common-dir"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  let commonDir = (r.stdout || "").trim();
  if (!commonDir) return null;
  if (!path.isAbsolute(commonDir)) commonDir = path.resolve(root, commonDir);
  // `<main>/.git` for a normal repo; the main checkout is its parent. Bail on bare repos.
  return path.basename(commonDir) === ".git" ? path.dirname(commonDir) : null;
}

// FAFF-580: the one place faff resolves the user's home directory. `HOME` first
// (the POSIX case), `USERPROFILE` as a fallback, `""` when neither is set — a
// verbatim generalisation of budget.js's transcriptBaseDir, the most complete
// form any call site had before this. `""` (not a thrown error) is deliberate:
// an unset HOME on a supported POSIX platform is vanishingly rare, and the one
// site where "" was actively harmful (resolveWorktreeRoot's default) is already
// caught downstream by FAFF-382's strictly-under `--assert` isolation check.
// Every home-directory lookup in bin/lib goes through this — never a fresh
// `HOME || …` inline at a new call site.
function homeDir(env = process.env) {
  return env.HOME || env.USERPROFILE || "";
}

// FAFF-591: worktree-aware `.faff/runs/<run>` resolution — the same fallback shape
// as findConfig/findOverlay above, applied to run dirs instead of config files. A
// build worktree is its own checkout, so `<root>/.faff/runs/<run>` is absent there
// even though the run genuinely exists in the MAIN checkout's `.faff/runs/<run>`
// (a run is initialised once, from the main checkout, before any worktree exists).
// Pure precedence logic; `mainWorktreeRoot` does the only git probing, reused
// rather than re-implemented. `rootExplicit` (was `root` an operator-supplied
// `--root`, not the `findRoot()` default?) gates the fallback: an explicit --root
// is a strict, deterministic escape hatch with no surprise git probe.
function resolveRunDir(root, run, rootExplicit) {
  const cwdDir = path.join(root, ".faff", "runs", run);
  if (fs.existsSync(cwdDir) && fs.statSync(cwdDir).isDirectory()) return cwdDir;
  if (!rootExplicit) {
    const mainRoot = mainWorktreeRoot(root);
    if (mainRoot && path.resolve(mainRoot) !== path.resolve(root)) {
      const mainDir = path.join(mainRoot, ".faff", "runs", run);
      if (fs.existsSync(mainDir) && fs.statSync(mainDir).isDirectory()) return mainDir;
    }
  }
  return cwdDir;
}

function findConfig(root) {
  const here = findConfigIn(root);
  if (here) return here;
  // FAFF-208: a linked git worktree shares its repo with the main checkout, but the
  // gitignored .faffrc.yaml is per-checkout and may not have been copied into the
  // worktree (e.g. a build worktree created outside the WorktreeCreate hook). Fall back
  // to the main checkout's config so consumers (adversarial-review host, appetite,
  // slots) never silently resolve to defaults just because the worktree lacks the copy
  // — the silent gate-degradation behind FAFF-198's localhost adversarial-review misfire.
  const mainRoot = mainWorktreeRoot(root);
  if (mainRoot && path.resolve(mainRoot) !== path.resolve(root)) return findConfigIn(mainRoot);
  return null;
}

// FAFF-387/FAFF-208: the overlay's own worktree fallback, resolved INDEPENDENTLY of
// findConfig's base-file fallback — a per-file resolution, not a per-pair one. A
// linked worktree carrying its own .faffrc.local.yaml keeps it (even when its base
// falls back to the main checkout's); a worktree with neither falls back to the main
// checkout's overlay, mirroring the base's existing guarantee.
function findOverlay(root) {
  const here = findOverlayIn(root);
  if (here) return here;
  const mainRoot = mainWorktreeRoot(root);
  if (mainRoot && path.resolve(mainRoot) !== path.resolve(root)) return findOverlayIn(mainRoot);
  return null;
}

// FAFF-387: a plain, non-array object — the shape both a parsed config document
// and any of its nested blocks must have to be map-merged (as opposed to a
// sequence or scalar, which are always replaced wholesale by the overlay).
function isPlainConfigMap(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// FAFF-387: MERGE(base, overlay) per the spec's resolution model — maps deep-merge
// per key (overlay wins per leaf), sequences are replaced wholesale by the overlay
// (never element-merged — ambiguous by index/key), and scalars/type-mismatches let
// the overlay win outright. PURE; never mutates either input.
function deepMergeConfig(base, overlay) {
  if (!isPlainConfigMap(overlay)) return isPlainConfigMap(base) ? base : {};
  if (!isPlainConfigMap(base)) return overlay;
  const out = { ...base };
  for (const key of Object.keys(overlay)) {
    const bv = base[key], ov = overlay[key];
    out[key] = (isPlainConfigMap(bv) && isPlainConfigMap(ov)) ? deepMergeConfig(bv, ov) : ov;
  }
  return out;
}

// FAFF-387: does a config file's text carry any MEANINGFUL line — a non-blank,
// non-comment, non-`---`-document-marker line? Used to tell an intentionally-empty
// overlay (valid, allowed) from a non-empty file that parses to an empty mapping
// (malformed — a top-level sequence/scalar, which parseYamlSubset silently yields
// {} for). PURE.
function hasMeaningfulYamlContent(text) {
  return text.split("\n").some((line) => {
    const t = line.trim();
    return t !== "" && !t.startsWith("#") && t !== "---";
  });
}

// FAFF-387/FAFF-577: the ONE strict config read+parse both halves call — a parse
// failure here is LOUD (thrown under the caller's errorName, never silently coerced
// to {}). A config file silently reverting to defaults is the FAFF-50 silent-default
// failure mode: FAFF-387 closed it for the overlay, FAFF-577 closed it for the base
// (whose stakes are budget/sentry ceilings), and this shared helper is the single
// detection both use — one implementation, one shared detection limit. "Parse
// failure" covers: (a) an unreadable file (permission/race after the existence
// check); and (b) a file that HAS content but parses to an empty mapping — because
// parseYamlSubset is a forgiving line-based parser that never throws and yields {}
// for a top-level sequence or scalar document, the empty-map-from-non-empty-file
// signal is how a malformed (non-mapping) document is caught. An intentionally-empty
// or comment-only file parses to {} from an EMPTY file and is allowed (valid).
// Known limit (shared with the overlay's original): a bare scalar line without a
// colon parses as a one-key map and is not flagged — per-key validation territory,
// out of scope (FAFF-577 §3).
function parseConfigMapStrict(filePath, errorName, noun = "the file") {
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    const err = new Error(errorName);
    err.file = filePath;
    err.detail = `unreadable (${e.code || e.message})`;
    throw err;
  }
  const parsed = parseYamlSubset(text);
  const emptyMap = isPlainConfigMap(parsed) && Object.keys(parsed).length === 0;
  if (!isPlainConfigMap(parsed) || (emptyMap && hasMeaningfulYamlContent(text))) {
    const err = new Error(errorName);
    err.file = filePath;
    err.detail = `does not parse to a mapping (malformed YAML — ${noun} must be a key:value mapping)`;
    throw err;
  }
  return parsed;
}

// FAFF-387: the overlay's strict read — a thin wrapper over the shared helper so
// overlay behaviour (error name, detail wording) stays byte-identical.
function parseOverlayStrict(filePath) {
  return parseConfigMapStrict(filePath, "overlay-parse-error", "an overlay");
}

// FAFF-577: the BASE's strict read — the chokepoint procedure both loadConfig
// (factory) and readGovernanceConfig (governance) call. On a malformed base it
// writes the one-line warning to stderr FIRST (before any throw), so a catching
// caller can degrade behaviour but never re-silence the failure — loud by
// construction, no call-site audit needed. Then: hatch armed (FAFF_CONFIG_BASE_LENIENT
// set, non-empty) → proceed on {} (loud-lenient); else throw "base-parse-error"
// {file, detail}. Absent-file handling stays with the callers (rc === null → {}
// silently — all-defaults is valid); this helper only ever sees a resolved path.
// The hatch is an env var by design: the config file is the broken artifact, so a
// knob inside it can't be read (FAFF_APPETITE / FAFF_WORKTREE_ROOT precedent).
function readBaseConfigStrict(filePath, env = process.env) {
  try {
    return parseConfigMapStrict(filePath, "base-parse-error", "the base config");
  } catch (e) {
    if (!(e && e.message === "base-parse-error")) throw e;
    const name = path.basename(filePath);
    process.stderr.write(
      `faff: ${filePath} is malformed (${e.detail}) — configured values (including budget/sentry ceilings) ` +
      `would silently fall back to built-in defaults. Fix the file (git diff / git checkout ${name}), ` +
      `or set FAFF_CONFIG_BASE_LENIENT=1 to proceed on defaults loudly.\n`);
    if (env.FAFF_CONFIG_BASE_LENIENT) return {};
    throw e;
  }
}


module.exports = { CANONICAL_CONFIG, CANONICAL_OVERLAY_CONFIG, CONTAIN_ENTRY_TYPES, CONTAIN_ROOT, LEGACY_CONFIG, LEGACY_OVERLAY_CONFIG, RUN_HEARTBEAT_STALE_SECS_DEFAULT, SELF_INTAKE_REASONS, containerParent, decideSelfIntake, deepMergeConfig, dig, findConfig, findConfigIn, findNamedIn, findOverlay, findOverlayIn, findRoot, homeDir, isPlainConfigMap, isSafeAnchorRelPath, latestRunDir, mainWorktreeRoot, normalizeSelfIntakeSelf, normalizeSelfIntakeTarget, parseAncestry, parseConfigMapStrict, parseOverlayStrict, parseYamlSubset, readBaseConfigStrict, readLedger, resolveLedgerOrFault, resolveRunDir, scalar, sortRunDirsByMtimeDesc, stripInlineComment, subtreeContains, HERE, ENTRYPOINT };
