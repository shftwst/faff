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

function findRoot(start = process.cwd()) {
  let d = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(d, ".git")) || fs.existsSync(path.join(d, ".faff"))) return d;
    const parent = path.dirname(d);
    if (parent === d) return path.resolve(start);
    d = parent;
  }
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

function latestRunDir(root) {
  const runs = path.join(root, ".faff", "runs");
  if (!fs.existsSync(runs)) return null;
  const cands = fs.readdirSync(runs)
    .map((name) => path.join(runs, name))
    .filter((p) => fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, "run-ledger.json")));
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

function findConfigIn(base) {
  const isFile = (n) => !n.includes(".example") &&
    fs.existsSync(path.join(base, n)) && fs.statSync(path.join(base, n)).isFile();
  const legacy = LEGACY_CONFIG.filter(isFile);
  if (legacy.length) {
    const err = new Error("legacy-config-name");
    err.legacy = legacy;
    throw err;
  }
  return isFile(CANONICAL_CONFIG) ? path.join(base, CANONICAL_CONFIG) : null;
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


module.exports = { CANONICAL_CONFIG, LEGACY_CONFIG, dig, findConfig, findConfigIn, findRoot, latestRunDir, mainWorktreeRoot, parseYamlSubset, readLedger, resolveLedgerOrFault, scalar, sortRunDirsByMtimeDesc, stripInlineComment, HERE, ENTRYPOINT };
