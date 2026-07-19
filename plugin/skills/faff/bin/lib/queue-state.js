// ===========================================================================
// === region:factory — queue-state — FAFF-556: git-only queue_empty/all_parked derivation ===
// via stable item-keys ("gitkeys"). In git-only mode (no tracker MCP) the
// `/faff-beep-boop` orchestrator has no queue to read, so it cannot assemble the
// `queue_empty` / `all_parked` booleans `faff run-done` consumes. This module
// supplies BOTH halves: `new-key` mints the durable, content-independent key
// git-only creation paths (`/faff-plot` roadmaps, `/faff-jot` captures) stamp
// onto every buildable work item at creation time, and `derive` diffs the union
// of emitted keys (intake-roadmap markers + the spec-store filenames) against a
// run-ledger's `outcomes{}` by EXACT string match, emitting the same
// `{queue_empty, all_parked}` shape `run-done`'s `--queue-empty`/`--all-parked`
// flags expect. PURE: no tracker, no network, no writes — parity with `faff
// next` / `faff run-done`. Reimplements no other signal.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { findRoot, latestRunDir, readLedger } = require("./shared-infra");
const { activeProfile } = require("./governance-profile");

// --- The gitkey format: gk-<YYYYMMDD>-<6 lowercase base36 chars> -----------
// Minted once, persisted, NEVER recomputed from mutable content (a content hash
// of the roadmap line would change the instant the line is reworded — the
// failure mode this format exists to avoid). The date segment is cosmetic
// (rough chronological ordering in a directory listing); the random suffix is
// what makes the key stable under rewording. Filesystem-safe by construction
// (lowercase alphanumerics + hyphens only), so it doubles as a
// `.faff/specs/<key>.md` filename with no escaping.
const GITKEY_RE = /^gk-\d{8}-[0-9a-z]{6}$/;
const GITKEY_SUFFIX_SPACE = 36 ** 6; // 2176782336 — fits in an unsigned 32-bit read

function mintKey(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const n = crypto.randomBytes(4).readUInt32BE(0) % GITKEY_SUFFIX_SPACE;
  const suffix = n.toString(36).padStart(6, "0");
  return `gk-${y}${m}${d}-${suffix}`;
}

function cmdNewKey() {
  console.log(mintKey());
  return 0;
}

// --- Store collectors (thin FS shells — no parsing beyond a marker regex / a ---
// --- filename stem; the pure core below takes the already-collected keys) -----

// Store A: intake roadmap/capture files. Every `<!-- gitkey:K -->` trailing
// marker across `<root>/.faff/intake/*.md` (mirrors the gateway's
// `<!-- faff-review-findings:<id> -->` marker idiom). Only buildable leaf
// lines carry a marker — containers (initiatives/projects) get none, so this
// collector need not distinguish line types; it only ever sees what was
// stamped. The capture group is intentionally permissive (so a slightly
// malformed marker is still visible for debugging) but every candidate is
// validated against GITKEY_RE before it is trusted as an item-key (below) —
// an arbitrary `<!-- gitkey:shipped -->` (or any other short/free-text
// string a human could paste in) must never silently masquerade as a real
// gitkey, since `deriveQueueState` does an EXACT string match against the
// ledger's `outcomes` keys and a colliding string could flip queue_empty
// while real work is still pending.
const GITKEY_MARKER_RE = /<!--\s*gitkey:([a-z0-9-]+)\s*-->/g;

function collectIntakeKeys(root) {
  const keys = [];
  const dir = path.join(root, ".faff", "intake");
  let names;
  try { names = fs.readdirSync(dir); } catch { return keys; }
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    let text;
    try { text = fs.readFileSync(path.join(dir, name), "utf8"); } catch { continue; }
    GITKEY_MARKER_RE.lastIndex = 0;
    let m;
    while ((m = GITKEY_MARKER_RE.exec(text)) !== null) {
      if (GITKEY_RE.test(m[1])) keys.push(m[1]); // reject a malformed/foreign marker value
    }
  }
  return keys;
}

// Store B: the spec store. The key IS the filename stem — no file is opened,
// no YAML parsed (the git-only `.faff/specs/<issue-id>.md` slot is simply
// filled by the gitkey; see the gateway's Spec discovery location 4 note).
// Only a gitkey-SHAPED stem is trusted as an item-key — a stray README, a
// pre-gitkey-era spec, or any other non-gitkey file that lands in the store
// must never silently count as a work item (it would inflate items_total
// and mask genuinely pending keys in items_pending, for no signal gained).
function collectSpecKeys(root) {
  const keys = [];
  const dir = path.join(root, ".faff", "specs");
  let names;
  try { names = fs.readdirSync(dir); } catch { return keys; }
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    const stem = name.slice(0, -3);
    if (GITKEY_RE.test(stem)) keys.push(stem);
  }
  return keys;
}

// Union of both stores, de-duped by exact string. Order is not load-bearing —
// callers only test membership / count.
function collectItemKeys(root) {
  return [...new Set([...collectIntakeKeys(root), ...collectSpecKeys(root)])];
}

// Read a run-ledger's outcomes map without conflating "no ledger yet" with "a
// corrupt one". A run that simply hasn't recorded any outcomes yet (no run
// dir resolved, or a run dir with no run-ledger.json) is a legitimate,
// non-drained state — never a fault. A PRESENT-but-unparseable ledger is a
// distinct, loud failure (parity with `runcheck`'s "never a silent 'not
// derailed'"). Returns { outcomes, malformed, error? }.
function readOutcomes(runDir) {
  if (!runDir) return { outcomes: {}, malformed: false };
  const ledgerPath = path.join(runDir, "run-ledger.json");
  if (!fs.existsSync(ledgerPath)) return { outcomes: {}, malformed: false };
  let ledger;
  try {
    ledger = readLedger(runDir);
  } catch (e) {
    return { outcomes: {}, malformed: true, error: e.message };
  }
  const outcomes = (ledger && typeof ledger.outcomes === "object" && ledger.outcomes && !Array.isArray(ledger.outcomes))
    ? ledger.outcomes : {};
  return { outcomes, malformed: false };
}

// --- The pure differ core — no I/O. Exercised directly by --selftest. ------
//
// Fail-safe toward NOT-empty at every turn:
//   - zero item-keys at all             -> not empty, reason "no-item-keys"
//   - any item absent from outcomes, or -> not empty, reason "work-remaining"
//     present with a non-terminal value
//   - every item terminal, all "parked" -> not empty, all_parked, reason "all-parked"
//   - every item terminal, >=1 shipped  -> empty, reason "drained"
function deriveQueueState({ itemKeys, outcomes, terminalStates }) {
  const termSet = new Set(terminalStates);
  const keys = [...new Set(itemKeys)];
  if (keys.length === 0) {
    return { queue_empty: false, all_parked: false, items_total: 0, items_terminal: 0, items_pending: [], reason: "no-item-keys" };
  }
  const pending = [];
  let items_terminal = 0;
  let allParked = true;
  for (const k of keys) {
    const outcome = Object.prototype.hasOwnProperty.call(outcomes, k) ? outcomes[k] : undefined;
    const isTerminal = typeof outcome === "string" && termSet.has(outcome);
    if (!isTerminal) { pending.push(k); allParked = false; continue; }
    items_terminal++;
    if (outcome !== "parked") allParked = false;
  }
  if (pending.length > 0) {
    return { queue_empty: false, all_parked: false, items_total: keys.length, items_terminal, items_pending: pending, reason: "work-remaining" };
  }
  if (allParked) {
    return { queue_empty: false, all_parked: true, items_total: keys.length, items_terminal, items_pending: [], reason: "all-parked" };
  }
  return { queue_empty: true, all_parked: false, items_total: keys.length, items_terminal, items_pending: [], reason: "drained" };
}

function cmdDerive(args) {
  const get = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
  const root = get("--root") || findRoot();
  const runDir = get("--run-dir") || process.env.FAFF_RUN_DIR || latestRunDir(root) || null;

  const itemKeys = collectItemKeys(root);
  const { outcomes, malformed, error } = readOutcomes(runDir);
  if (malformed) {
    process.stderr.write(`faff queue-state derive: run-ledger.json is present but unparseable at ${runDir}: ${error}\n`);
    return 2;
  }

  // May throw GovernanceProfileError on a bad $FAFF_GOVERNANCE_PROFILE override —
  // deliberately uncaught here, parity with run-done.js/profiles.js: bin/faff's
  // main() dispatch catches e.faffGovernanceProfileError uniformly and converts
  // it to a loud stderr line + exit 2. Never silently coerced to an empty
  // terminal-states set, which would misclassify every item as pending forever.
  const terminalStates = activeProfile().terminal_states;

  const result = deriveQueueState({ itemKeys, outcomes, terminalStates });
  console.log(JSON.stringify(result));
  return 0; // report-only (parity with run-done/next): the verdict is in the payload, not the exit code
}

function cmdQueueState(args) {
  if (args.includes("--selftest")) return queueStateSelftest();
  const sub = args.find((a) => !a.startsWith("-"));
  const rest = args.filter((a) => a !== sub);
  if (sub === "new-key") return cmdNewKey(rest);
  if (sub === "derive") return cmdDerive(rest);
  process.stderr.write(`faff queue-state: unknown subcommand ${JSON.stringify(sub || "")} (expected new-key|derive)\n`);
  return 2;
}

// --- Selftest: pure classifier table (no FS) + a mint-format/uniqueness check ---
// + a filesystem-backed round-trip proving rewording/renaming never changes the
// resolved key (AC 3/7), plus the missing-vs-malformed-ledger distinction (AC 5).
function queueStateSelftest() {
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { fail++; console.log(`FAIL ${name}`); } else console.log(`ok   ${name}`); };
  const TERM = ["shipped", "pr-open", "parked", "errored", "routed-out", "unreached-budget"];
  const d = (itemKeys, outcomes) => deriveQueueState({ itemKeys, outcomes, terminalStates: TERM });

  // --- mint format + uniqueness ---
  const k1 = mintKey(new Date("2026-07-19T00:00:00Z"));
  const k2 = mintKey(new Date("2026-07-19T00:00:00Z"));
  ok("mint: matches gk-<YYYYMMDD>-<6 base36> shape", GITKEY_RE.test(k1));
  ok("mint: embeds the UTC date segment", k1.startsWith("gk-20260719-"));
  ok("mint: two successive calls differ", k1 !== k2);
  ok("mint: filesystem-safe (usable verbatim as a .md filename)", /^[a-z0-9-]+$/.test(k1) && !k1.includes("/"));

  // --- pure differ core: the case table (AC 1-4) ---
  ok("drained: every item terminal, >=1 shipped -> queue_empty true",
    (() => { const r = d(["a", "b"], { a: "shipped", b: "parked" }); return r.queue_empty === true && r.all_parked === false && r.reason === "drained"; })());
  ok("all-parked: every item terminal, all parked -> all_parked true, queue_empty false",
    (() => { const r = d(["a", "b"], { a: "parked", b: "parked" }); return r.queue_empty === false && r.all_parked === true && r.reason === "all-parked"; })());
  ok("mixed-terminal: one non-parked terminal among several -> drained",
    (() => { const r = d(["a", "b", "c"], { a: "shipped", b: "parked", c: "errored" }); return r.queue_empty === true && r.reason === "drained"; })());
  ok("one-pending: an item absent from outcomes -> queue_empty false, named in items_pending",
    (() => { const r = d(["a", "b"], { a: "shipped" }); return r.queue_empty === false && r.all_parked === false && r.items_pending.includes("b") && r.reason === "work-remaining"; })());
  ok("one-pending: an item present with a NON-terminal value -> still pending (fail-safe)",
    (() => { const r = d(["a"], { a: "in-progress" }); return r.queue_empty === false && r.items_pending.includes("a"); })());
  ok("empty-set: zero item-keys -> queue_empty false, reason no-item-keys",
    (() => { const r = d([], {}); return r.queue_empty === false && r.all_parked === false && r.reason === "no-item-keys" && r.items_total === 0; })());
  ok("de-dupes the item-key set by exact string",
    (() => { const r = d(["a", "a", "b"], { a: "shipped", b: "shipped" }); return r.items_total === 2; })());
  ok("items_terminal counts only terminal items",
    (() => { const r = d(["a", "b"], { a: "shipped" }); return r.items_terminal === 1; })());

  // --- missing vs malformed ledger (AC 5) ---
  const tmp = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "faff-queue-state-selftest-"));
  try {
    const missingRunDir = path.join(tmp, "run-missing");
    fs.mkdirSync(missingRunDir, { recursive: true });
    const missing = readOutcomes(missingRunDir);
    ok("missing ledger -> not malformed, empty outcomes (valid, not-drained state)", missing.malformed === false && Object.keys(missing.outcomes).length === 0);
    ok("no run dir at all -> not malformed, empty outcomes", readOutcomes(null).malformed === false);

    const corruptRunDir = path.join(tmp, "run-corrupt");
    fs.mkdirSync(corruptRunDir, { recursive: true });
    fs.writeFileSync(path.join(corruptRunDir, "run-ledger.json"), "{ not: valid json", "utf8");
    const corrupt = readOutcomes(corruptRunDir);
    ok("present-but-unparseable ledger -> malformed (loud, never silent)", corrupt.malformed === true);

    const goodRunDir = path.join(tmp, "run-good");
    fs.mkdirSync(goodRunDir, { recursive: true });
    fs.writeFileSync(path.join(goodRunDir, "run-ledger.json"), JSON.stringify({ outcomes: { a: "shipped" } }), "utf8");
    const good = readOutcomes(goodRunDir);
    ok("readable ledger -> outcomes surfaced verbatim", good.malformed === false && good.outcomes.a === "shipped");

    // --- filesystem round-trip: rewording the visible text / renaming leaves the ---
    // --- resolved key set unchanged (AC 3/7) ---
    const root = path.join(tmp, "repo");
    fs.mkdirSync(path.join(root, ".faff", "intake"), { recursive: true });
    fs.mkdirSync(path.join(root, ".faff", "specs"), { recursive: true });
    const key = "gk-20260719-abc123";
    fs.writeFileSync(path.join(root, ".faff", "intake", "roadmap.md"), `- [ ] Build the auth module <!-- gitkey:${key} -->\n`, "utf8");
    const before = collectItemKeys(root);
    ok("intake marker collected", before.includes(key));
    // reword the visible text; marker (and its trailing position) is untouched
    fs.writeFileSync(path.join(root, ".faff", "intake", "roadmap.md"), `- [ ] Build the login + auth module (revised) <!-- gitkey:${key} -->\n`, "utf8");
    const after = collectItemKeys(root);
    ok("rewording the visible line leaves the resolved key set unchanged", after.length === before.length && after.includes(key));

    const specKey = "gk-20260719-def456";
    fs.writeFileSync(path.join(root, ".faff", "specs", `${specKey}.md`), "# spec\n", "utf8");
    ok("spec-store key is the filename stem", collectItemKeys(root).includes(specKey));

    // --- a non-gitkey-shaped marker value / filename is never trusted as an ---
    // --- item-key (a pasted `<!-- gitkey:shipped -->` must never exact-match ---
    // --- a ledger outcome string; a stray README.md must never inflate the set) ---
    fs.writeFileSync(path.join(root, ".faff", "intake", "injected.md"), "- [ ] x <!-- gitkey:shipped -->\n", "utf8");
    fs.writeFileSync(path.join(root, ".faff", "specs", "README.md"), "# not a gitkey\n", "utf8");
    const withNoise = collectItemKeys(root);
    ok("a malformed intake marker value is rejected", !withNoise.includes("shipped"));
    ok("a non-gitkey-shaped spec filename is rejected", !withNoise.includes("README"));
    ok("only the two genuine gitkeys survive the noise", withNoise.length === 2 && withNoise.includes(key) && withNoise.includes(specKey));

    // --- purity: no tracker/network access anywhere in this module ---
    const src = fs.readFileSync(path.join(__dirname, "queue-state.js"), "utf8");
    ok("purity: module never requires an http/https/network module", !/require\(["'](?:http|https|net)["']\)/.test(src));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = {
  GITKEY_RE,
  cmdDerive,
  cmdNewKey,
  cmdQueueState,
  collectIntakeKeys,
  collectItemKeys,
  collectSpecKeys,
  deriveQueueState,
  mintKey,
  queueStateSelftest,
  readOutcomes,
};
