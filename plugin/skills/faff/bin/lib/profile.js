// ===========================================================================
// === region:factory — profile — FAFF-26: infra-profile schema + CLI (slice 1); FAFF-231: repo-mining acquirer (slice 2) ===
//   profile validate [--file PATH]   validate a profile JSON (stdin or --file): 0 valid / 1 invalid / 2 malformed
//   profile show                     print the effective profile (.faff/infra-profile.json ⊕ .faffrc.yaml infra:); exit 3 when none
//   profile mine [--json]            FAFF-231: the default `profile`-slot occupant — a deterministic,
//                                    read-only repo-miner. Scans --root for infra artifacts and emits ONE
//                                    faff-contract:infra-profile block (--json: raw JSON). Pure file
//                                    inspection: NO network/install/subprocess (constraint ①), writes no files.
// The schema is the load-bearing contract downstream (FAFF-27/30) consumes; acquisition is a
// separate `profile` slot (FAFF-231). Deterministic-tools-over-prose: schema + merge + mining live here,
// not in skill prose. See records/adr/0013 for the storage-split + conflict-authority decision.
// ===========================================================================

// FAFF-231 repo-miner — the archaeologist, not a probe: learns a repo's infra by READING artifacts
// already committed to it (CI workflows, Dockerfiles, IaC, PaaS + language manifests) and reports
// evidence-bearing facts (every entry cites the file it came from). It never runs, installs, or
// reaches the network — pure fs inspection. The orchestrator (not the miner) validates the emitted
// block and writes .faff/infra-profile.json (ADR 0013); the miner writes nothing.

const fs = require("node:fs");
const path = require("node:path");
const { loadConfig } = require("./config");
const { parseArgs, usageError } = require("./argv");
const PROFILE_SPEC = { flags: { "--selftest": { arity: 0 }, "--json": { arity: 0 }, "--root": { arity: 1 }, "--file": { arity: 1 } }, positionals: { min: 0, max: null, name: "verb" } };
// FAFF-628 — declared grammar. --file (validate/show) defaults elsewhere — no sub-verb here
// unconditionally requires a flag.
const PROFILE_SURFACE = {
  kind: "subcommand_dispatch",
  spec: PROFILE_SPEC,
  subcommands: {
    mine: { required_flags: [] },
    validate: { required_flags: [] },
    show: { required_flags: [] },
  },
};
const { dig, findRoot } = require("./shared-infra");
const { SKIP } = require("./validate-adapters");

const PROFILE_MINER_NAME = "faff-repo-miner";   // the default profile-slot occupant identity (acquired_by)

// Known datastore engines, recognised in compose service images / terraform resource hints.
const PROFILE_DATASTORE_PATTERNS = [
  ["postgres", /postgres(ql)?/i],
  ["mysql", /\bmysql\b/i],
  ["mariadb", /mariadb/i],
  ["redis", /\bredis\b/i],
  ["mongo", /mongo(db)?/i],
  ["elasticsearch", /elasticsearch/i],
  ["rabbitmq", /rabbitmq/i],
  ["memcached", /memcached/i],
  ["cassandra", /cassandra/i],
];

function profileRel(root, p) { return path.relative(root, p).split(path.sep).join("/"); }
function profileSafeRead(p) { try { return fs.readFileSync(p, "utf8"); } catch { return null; } }

// FAFF-840: the exact fence `mine` emits (see cmdProfile → mine below) — single source so a future
// change to the miner's fence shape only moves this constant, never a duplicated strip regex.
const PROFILE_FENCE_OPEN = "```faff-contract:infra-profile";
const PROFILE_FENCE_CLOSE = "```";

// FAFF-840: fence-tolerant profile-input parser. `profile mine` emits the contract-fenced form by
// default (`--json` gives raw JSON); every site that reads a stored/handed profile file — env.js
// resolveProfile's `--profile` read and its `.faff/infra-profile.json` default read, and
// cmdProfile's own `validate` below — routes through this so the documented `profile mine |
// compose-gen` / `profile mine | profile validate` pipes work regardless of which form was
// emitted. Strips at most one leading infra-profile fence; anything else (including input that
// merely contains backticks elsewhere) is left untouched. Throws on unparseable input exactly as
// `JSON.parse` does today, so every caller keeps its existing try/catch and error message.
function parseProfileInput(raw) {
  const trimmed = String(raw).replace(/^\s+/, "");
  if (trimmed.startsWith(PROFILE_FENCE_OPEN)) {
    const afterOpen = trimmed.slice(PROFILE_FENCE_OPEN.length);
    // lastIndexOf, not indexOf: the miner always emits the closing fence as the trailing marker
    // of a single block, so anchoring on the LAST occurrence tolerates a JSON value that happens
    // to contain a literal ``` sequence (a pathological evidence/note string) without truncating
    // the body early. Byte-identical result for the miner's own well-formed output either way.
    const closeIdx = afterOpen.lastIndexOf(PROFILE_FENCE_CLOSE);
    const body = closeIdx === -1 ? afterOpen : afterOpen.slice(0, closeIdx);
    return JSON.parse(body);
  }
  return JSON.parse(raw);
}

// Bounded, read-only recursive walk. Skips heavy/irrelevant dirs so a mine stays cheap + deterministic.
function profileWalk(root) {
  const SKIP = new Set([".git", "node_modules", ".faff", ".claude", "dist", "build", "coverage", ".next", "vendor", "tmp"]);
  const out = [];
  const stack = [root];
  let budget = 50000;   // guard against pathological trees; mining is recall-over-precision, not exhaustive
  while (stack.length && budget-- > 0) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    // Sort for filesystem-independent determinism (readdir order is not portable): same repo ⇒ same
    // mined order ⇒ same representative-evidence pick on dedup. Reverse so the stack pops alphabetically.
    entries.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;            // never follow symlinks (stay in-repo, avoid cycles)
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP.has(e.name)) stack.push(full); }
      else if (e.isFile()) out.push(full);
    }
  }
  return out;
}

// Resolve the repo slug read-only from .git/config remote URL — NO `git` subprocess (constraint ①).
function profileRepoSlug(root) {
  const cfg = profileSafeRead(path.join(root, ".git", "config"));
  if (!cfg) return undefined;
  const m = cfg.match(/url\s*=\s*(\S+)/);
  if (!m) return undefined;
  const slug = m[1].match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);   // git@host:org/repo.git | https://host/org/repo
  return slug ? slug[1] : undefined;
}

// Dedupe a list by identity key, preferring a representative that carries a `version` (never invent one).
function profileDedupe(arr, key) {
  const map = new Map();
  for (const el of arr) {
    const id = el[key];
    if (id === undefined || id === null || String(id).trim() === "") continue;
    if (!map.has(id)) { map.set(id, el); continue; }
    const cur = map.get(id);
    if (el.version && !cur.version) map.set(id, el);
  }
  return [...map.values()];
}

// Pure: scan repo_root and return an InfraProfile object (FAFF-26 schema). No I/O beyond read-only fs.
function mineRepo(root) {
  const profile = {
    schema: 1, acquired_at: new Date().toISOString(), acquired_by: PROFILE_MINER_NAME,
    runtimes: [], ci: [], deploy_targets: [], datastores: [], paas_available: [], notes: [],
  };
  const slug = profileRepoSlug(root);
  if (slug) profile.repo = slug;

  const pinned = (txt, re) => { const m = txt.match(re); return m ? m[1] : undefined; };

  for (const f of profileWalk(root)) {
    const rel = profileRel(root, f);
    const base = path.basename(f);

    // 1. GitHub Actions workflows → ci github-actions + setup-{node,python,go} version pins as runtimes
    if (/^\.github\/workflows\/.+\.(ya?ml)$/.test(rel)) {
      profile.ci.push({ name: "github-actions", evidence: rel });
      const txt = profileSafeRead(f) || "";
      const langs = [
        ["node", /actions\/setup-node/i, /node-version:\s*['"]?([0-9][\w.]*)/i],
        ["python", /actions\/setup-python/i, /python-version:\s*['"]?([0-9][\w.]*)/i],
        ["go", /actions\/setup-go/i, /go-version:\s*['"]?([0-9][\w.]*)/i],
      ];
      for (const [name, useRe, verRe] of langs) {
        if (!useRe.test(txt)) continue;
        const rt = { name, evidence: rel };
        const v = pinned(txt, verRe);
        if (v) rt.version = v;
        profile.runtimes.push(rt);
      }
      continue;
    }
    // 2. GitLab CI
    if (base === ".gitlab-ci.yml") { profile.ci.push({ name: "gitlab-ci", evidence: rel }); continue; }
    // 3. Dockerfile → container-image deploy target + FROM base image as a runtime
    if (base === "Dockerfile" || /^Dockerfile\./.test(base)) {
      profile.deploy_targets.push({ kind: "container-image", evidence: rel });
      const txt = profileSafeRead(f) || "";
      const fm = txt.match(/^[ \t]*FROM\s+(\S+)/im);
      if (fm) {
        const img = fm[1].split("/").pop().split("@")[0].split(":")[0];
        if (img && !/^scratch$/i.test(img)) profile.runtimes.push({ name: img, evidence: rel });
      }
      continue;
    }
    // 4. docker-compose → datastores from known service images
    if (/^docker-compose.*\.(ya?ml)$/.test(base) || /^compose\.(ya?ml)$/.test(base)) {
      const txt = profileSafeRead(f) || "";
      for (const [kind, re] of PROFILE_DATASTORE_PATTERNS) if (re.test(txt)) profile.datastores.push({ kind, evidence: rel });
      continue;
    }
    // 5. Terraform → cloud deploy targets + datastores from recognised provider/resource hints
    if (/\.tf$/.test(base)) {
      const txt = profileSafeRead(f) || "";
      if (/provider\s+"aws"|\baws_/.test(txt)) profile.deploy_targets.push({ kind: "aws", evidence: rel });
      if (/provider\s+"google"|\bgoogle_/.test(txt)) profile.deploy_targets.push({ kind: "gcp", evidence: rel });
      if (/provider\s+"azurerm"|\bazurerm_/.test(txt)) profile.deploy_targets.push({ kind: "azure", evidence: rel });
      for (const [kind, re] of PROFILE_DATASTORE_PATTERNS) if (re.test(txt)) profile.datastores.push({ kind, evidence: rel });
      continue;
    }
    // 6. PaaS manifests
    if (base === "netlify.toml") { profile.deploy_targets.push({ kind: "netlify", evidence: rel }); profile.paas_available.push("netlify"); continue; }
    if (base === "vercel.json") { profile.deploy_targets.push({ kind: "vercel", evidence: rel }); profile.paas_available.push("vercel"); continue; }
    if (base === "Procfile" || base === "app.json") { profile.deploy_targets.push({ kind: "heroku", evidence: rel }); continue; }
    // 7. Language manifests → runtimes (+ pinned version when present)
    if (base === "package.json") {
      const txt = profileSafeRead(f) || "";
      const rt = { name: "node", evidence: rel };
      try { const j = JSON.parse(txt); const v = j && j.engines && j.engines.node; const mm = v && String(v).match(/([0-9][\w.]*)/); if (mm) rt.version = mm[1]; } catch { /* malformed → skip version, no un-cited guess */ }
      profile.runtimes.push(rt);
      continue;
    }
    if (base === "go.mod") {
      const txt = profileSafeRead(f) || "";
      const rt = { name: "go", evidence: rel };
      const v = pinned(txt, /^\s*go\s+([0-9][\w.]*)/im);
      if (v) rt.version = v;
      profile.runtimes.push(rt);
      continue;
    }
    if (base === "requirements.txt") { profile.runtimes.push({ name: "python", evidence: rel }); continue; }
    if (base === "pyproject.toml") {
      const txt = profileSafeRead(f) || "";
      const rt = { name: "python", evidence: rel };
      const v = pinned(txt, /requires-python\s*=\s*['"][^0-9]*([0-9][\w.]*)/i);
      if (v) rt.version = v;
      profile.runtimes.push(rt);
      continue;
    }
  }

  profile.runtimes = profileDedupe(profile.runtimes, "name");
  profile.ci = profileDedupe(profile.ci, "name");
  profile.deploy_targets = profileDedupe(profile.deploy_targets, "kind");
  profile.datastores = profileDedupe(profile.datastores, "kind");
  profile.paas_available = [...new Set(profile.paas_available)];

  if (!profile.runtimes.length && !profile.ci.length && !profile.deploy_targets.length && !profile.datastores.length) {
    profile.notes.push("no infra artifacts discovered; minimal profile");
  }
  return profile;
}
const PROFILE_LIST_FIELDS = [
  ["runtimes", "name"], ["ci", "name"], ["deploy_targets", "kind"], ["datastores", "kind"],
];

// Pure validator over a parsed profile object. `validate` operates on acquirer output, so every
// list entry is acquirer-sourced ⇒ must carry non-empty evidence (the trust signal). Human
// overrides are never validated here — they flow through `show`'s merge, evidence-exempt.
function validateProfile(obj) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return ["profile must be a JSON object"];
  }
  const v = [];
  if (obj.schema !== 1) v.push("schema must be 1");
  for (const k of ["schema", "acquired_at", "acquired_by"]) {
    if (obj[k] === undefined || obj[k] === null || obj[k] === "") v.push(`missing required field: ${k}`);
  }
  for (const [field, reqKey] of PROFILE_LIST_FIELDS) {
    const arr = obj[field];
    if (arr === undefined) continue;
    if (!Array.isArray(arr)) { v.push(`${field} must be a list`); continue; }
    arr.forEach((el, i) => {
      if (el === null || typeof el !== "object" || Array.isArray(el)) {
        v.push(`${field}[${i}] must be an object`); return;
      }
      if (!el[reqKey] || String(el[reqKey]).trim() === "") v.push(`${field}[${i}] missing required key '${reqKey}'`);
      if (!el.evidence || String(el.evidence).trim() === "") {
        v.push(`${field}[${i}] missing evidence (acquirer-sourced facts must cite the artifact they came from)`);
      }
    });
  }
  return v;
}

function cmdProfile(args) {
  // FAFF-576: fail-closed flag gate — unknown flag / missing value exits 2 here.
  const gate = parseArgs(args, PROFILE_SPEC);
  if (gate.errors.length) return usageError(gate.errors, "usage: faff profile <mine|validate|show> [--file F] [--json] [--root DIR]");
  let root = null;
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") root = args[++i];
    else rest.push(args[i]);
  }
  root = root || findRoot();
  const cmd = rest[0];

  if (cmd === "--selftest" || rest.includes("--selftest")) return profileSelftest();

  if (cmd === "mine") {
    // FAFF-231: deterministic, read-only repo-mining acquirer. Emits ONE faff-contract:infra-profile
    // block; the orchestrator validates it (faff profile validate) then writes .faff/infra-profile.json.
    const profile = mineRepo(root);
    const json = JSON.stringify(profile, null, 2);
    if (rest.includes("--json")) { console.log(json); return 0; }   // raw JSON, e.g. to pipe into `profile validate`
    console.log(PROFILE_FENCE_OPEN);
    console.log(json);
    console.log(PROFILE_FENCE_CLOSE);
    return 0;
  }

  if (cmd === "validate") {
    let raw;
    const fi = rest.indexOf("--file");
    try {
      raw = fs.readFileSync(fi !== -1 ? rest[fi + 1] : 0, "utf8");
    } catch {
      process.stderr.write("faff profile validate: cannot read input (no --file PATH and no stdin)\n");
      return 2;
    }
    let obj;
    try { obj = parseProfileInput(raw); }
    catch { process.stderr.write("faff profile validate: malformed profile input (invalid JSON)\n"); return 2; }
    const violations = validateProfile(obj);
    if (violations.length) {
      for (const x of violations) process.stderr.write(`- ${x}\n`);
      return 1;
    }
    console.log("OK — infra profile valid (schema 1).");
    return 0;
  }

  if (cmd === "show") {
    const profPath = path.join(root, ".faff", "infra-profile.json");
    const hasStored = fs.existsSync(profPath);
    let stored = {};
    if (hasStored) {
      try { stored = JSON.parse(fs.readFileSync(profPath, "utf8")); }
      catch {
        process.stderr.write(`faff profile show: malformed ${path.join(".faff", "infra-profile.json")} (invalid JSON)\n`);
        return 2;
      }
    }
    let override = null;
    try { [override] = [dig(loadConfig(root)[0], "infra")]; }
    catch (e) {
      if (e.message === "legacy-config-name" || e.message === "multiple-config") {
        process.stderr.write(`faff profile show: ${e.message}\n`); return 2;
      }
      throw e;
    }
    const hasOverride = override !== null && override !== undefined
      && typeof override === "object" && !Array.isArray(override) && Object.keys(override).length > 0;
    if (!hasStored && !hasOverride) {
      process.stderr.write("faff profile show: no infra profile; run acquisition\n");
      return 3;
    }
    const effective = Object.assign({}, (stored && typeof stored === "object" && !Array.isArray(stored)) ? stored : {});
    if (hasOverride) {
      const applied = [];
      for (const k of Object.keys(override)) { effective[k] = override[k]; applied.push(k); }
      effective.notes = Array.isArray(effective.notes) ? effective.notes.slice() : [];
      effective.notes.push(`override applied: ${applied.join(", ")}`);
    }
    console.log(JSON.stringify(effective, null, 2));
    return 0;
  }

  process.stderr.write("faff profile: expected one of validate | show | mine (or --selftest)\n");
  return 2;
}

// In-memory self-test of the pure validator core (mirrors the `faff contract` selftest style).
function profileSelftest() {
  const valid = { schema: 1, acquired_at: "2026-06-26T00:00:00Z", acquired_by: "x",
    runtimes: [{ name: "node", version: "20", evidence: ".github/workflows/ci.yml" }] };
  const cases = [
    [valid, 0, "valid profile"],
    [{ schema: 1, acquired_at: "t", acquired_by: "x" }, 0, "sparse but complete"],
    [{ schema: 2, acquired_at: "t", acquired_by: "x" }, 1, "wrong schema version"],
    [{ schema: 1, acquired_at: "t" }, 1, "missing acquired_by"],
    [{ schema: 1, acquired_at: "t", acquired_by: "x", datastores: [{ kind: "mongo" }] }, 1, "datastore missing evidence"],
    [{ schema: 1, acquired_at: "t", acquired_by: "x", runtimes: [{ version: "20", evidence: "f" }] }, 1, "runtime missing name"],
    [[], 1, "not an object"],
  ];
  let failed = 0;
  for (const [obj, wantViol, label] of cases) {
    const got = validateProfile(obj).length > 0 ? 1 : 0;
    if (got !== wantViol) { process.stderr.write(`profile --selftest FAIL: ${label} (want ${wantViol}, got ${got})\n`); failed++; }
  }

  // FAFF-840: parseProfileInput — fenced input parses identically to raw, malformed still throws.
  const check = (label, cond) => { if (!cond) { process.stderr.write(`profile --selftest FAIL: ${label}\n`); failed++; } };
  const rawJson = JSON.stringify(valid);
  const fenced = "```faff-contract:infra-profile\n" + rawJson + "\n```\n";
  let fromRaw, fromFenced;
  try { fromRaw = parseProfileInput(rawJson); } catch { fromRaw = undefined; }
  try { fromFenced = parseProfileInput(fenced); } catch { fromFenced = undefined; }
  check("parseProfileInput: raw form parses", fromRaw !== undefined && JSON.stringify(fromRaw) === rawJson);
  check("parseProfileInput: fenced form parses to the same object as raw", fromFenced !== undefined && JSON.stringify(fromFenced) === rawJson);
  let malformedThrew = false;
  try { parseProfileInput("{ not json"); } catch { malformedThrew = true; }
  check("parseProfileInput: malformed (non-fenced) input throws", malformedThrew);
  let malformedFencedThrew = false;
  try { parseProfileInput("```faff-contract:infra-profile\n{ not json\n```\n"); } catch { malformedFencedThrew = true; }
  check("parseProfileInput: malformed fenced body throws", malformedFencedThrew);
  // A JSON value containing a literal ``` must not truncate the body early — anchor on the
  // trailing closing fence (lastIndexOf), not the first occurrence.
  const withEmbeddedTicks = { schema: 1, acquired_at: "t", acquired_by: "x", notes: ["contains ``` inline"] };
  const embeddedJson = JSON.stringify(withEmbeddedTicks);
  const embeddedFenced = "```faff-contract:infra-profile\n" + embeddedJson + "\n```\n";
  let fromEmbedded;
  try { fromEmbedded = parseProfileInput(embeddedFenced); } catch { fromEmbedded = undefined; }
  check("parseProfileInput: a JSON value containing ``` does not truncate the body", fromEmbedded !== undefined && JSON.stringify(fromEmbedded) === embeddedJson);

  if (failed) return 1;
  console.log("profile --selftest: ok");
  return 0;
}


module.exports = { PROFILE_DATASTORE_PATTERNS, PROFILE_FENCE_CLOSE, PROFILE_FENCE_OPEN, PROFILE_LIST_FIELDS, PROFILE_MINER_NAME, PROFILE_SPEC, PROFILE_SURFACE, cmdProfile, mineRepo, parseProfileInput, profileDedupe, profileRel, profileRepoSlug, profileSafeRead, profileSelftest, profileWalk, validateProfile };
