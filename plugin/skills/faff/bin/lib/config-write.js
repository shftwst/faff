// ===========================================================================
// === region:factory — config-write — `faff config init`, `config set` and `config unset`: the surgical raw-text writers ===
// ===========================================================================
// FAFF-1389: split out of config.js, which re-exports every name below that it exported before.

const fs = require("node:fs");
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");
const { CANONICAL_CONFIG, CANONICAL_OVERLAY_CONFIG, dig, findConfig, findConfigLocation, findOverlay, findOverlayLocation, isInsideRoot, isPlainConfigMap, parseYamlSubset, scalar, stripInlineComment } = require("./shared-infra");
const { fmt, gitInRepo, gitIsIgnored, toPosix } = require("./config-core");
const { removedKeyError, validateDispatchKey, validateEvalKey } = require("./config-dispatch");
const { validateControlLabelName, validateGitHostValue, validateIsolationLane, validateLabelPrefix } = require("./config-resolve");

// ---------------------------------------------------------------------------
// config init — FAFF-5: the deterministic WRITE half of the config surface.
// Writes/merges a `tracking` block into `.faffrc.yaml`. Pure-functional except
// the final fs.writeFileSync. NO MCP, NO env reads, NO value discovery — it
// only persists values handed to it on the CLI (lane split; that is FAFF-6's
// job). The write must round-trip: a file the existing parseYamlSubset/scalar
// reads back to the values written. The merge is a SURGICAL raw-text edit —
// never parse-then-reserialise (the parser is lossy and would destroy a user's
// slots:/appetite:/comments).
// ---------------------------------------------------------------------------
const TRACKING_KEYS = [
  "tracking.tracker",
  "tracking.team_key",
  // FAFF-1080: the scalar fallback create-target for a `tracking.teams` team-set. The set
  // itself (`tracking.teams`) and the optional `tracking.team_routing` map are sequence/map
  // shaped — SEQUENCE_VALUED_KEYS below refuses them and they stay a committed-base hand-edit
  // (the `adversarial.refs` precedent); only this one scalar leaf is writer-ergonomic. No
  // DEFAULTS registry entry, matching team_key — a per-repo team has no universal default.
  "tracking.default_team",
  "tracking.repo",
  "tracking.git_host",
  "tracking.spec_docs_path",
  "tracking.prd_docs_path",
  "tracking.prdr_docs_path",
  "tracking.adr_docs_path",
  "tracking.adr_superseded_docs_path",   // FAFF-1048: where a superseded ADR lands; read by adr.js supersededDir()
  "tracking.spike_docs_path",
  "tracking.templates_path",   // FAFF-1300: committed template overrides directory; read via resolveTemplatesPath()
  "tracking.label_prefix",
];
const INIT_HEADER = `# ${CANONICAL_CONFIG} — faff configuration (written by \`faff config init\`)\n`;


// FAFF-1302: the notice for a config file resolved from the deprecated root location. PURE
// text: callers choose the stream (stderr for the posture surfaces and writers) or carry it
// in a finding (`config check`). `isIgnored(relPath)` is the git probe, or null outside a git
// repo, where there is no ignore policy to get wrong. faff prints the move; it never runs it.
function locationNoticeText(name, role, isIgnored) {
  const overlay = role === "overlay";
  const canonical = overlay ? CANONICAL_OVERLAY_CONFIG : CANONICAL_CONFIG;
  const want = overlay ? "ignored" : "not ignored";
  const lines = [];
  if (isIgnored) {
    const got = isIgnored(canonical) ? "ignored" : "not ignored";
    if (got !== want) {
      lines.push(
        `faff: ${canonical} is ${got} by this repo's ignore rules and must be ${want}.`,
        "      Run `faff gitignore-ensure` BEFORE the move below, or the move",
        `      ${overlay ? "would leave an operator-private file stageable" : "would leave the base config uncommittable"}.`,
      );
    }
  }
  lines.push(
    `faff: ${overlay ? "overlay" : "base config"} resolved from the deprecated location ${name}`,
    `      (faff now uses ${canonical}). Resolution and values are unchanged.`,
    `      To migrate:  ${overlay ? "mv" : "git mv"} ${name} ${canonical}`,
  );
  if (overlay) lines.push("      (plain mv, not git mv: the overlay is untracked and may hold machine-local values.)");
  return lines.join("\n");
}

function ignoreProbeFor(root) {
  return gitInRepo(root) ? (relPath) => gitIsIgnored(root, relPath) : null;
}

// Never standard output: `config get` and `config path` hand stdout to shell callers.
function printLocationNotice(root, location, role) {
  if (location === null || location.tier !== "deprecated") return;
  process.stderr.write(locationNoticeText(location.name, role, ignoreProbeFor(root)) + "\n");
}

// FAFF-1302: a writer edits the file the resolver resolved when it lies inside the operating
// root, whatever its tier; otherwise (no file, or resolved through the main-worktree
// fallback) it targets the canonical path under this root. Creates nothing: the caller
// makes the parent directory at the moment of writing.
function resolveWriteTarget(root, local) {
  const location = local ? findOverlayLocation(root) : findConfigLocation(root);   // may throw legacy-*-config-name; cmdConfig's catch owns it
  const canonicalPath = path.join(root, local ? CANONICAL_OVERLAY_CONFIG : CANONICAL_CONFIG);
  const target = location !== null && isInsideRoot(root, location.path) ? location.path : canonicalPath;
  return { target, targetName: toPosix(path.relative(root, target)), existingPath: location === null ? null : location.path, location };
}

function writeConfigFile(target, text) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
}

// The missing inverse of scalar(): produce YAML scalar text for a string value
// such that scalar() reads it back to that exact string. Bare when safe, else
// double-quoted (the parser does NOT process single-quote `''` escaping, so we
// only emit double-quotes, escaping `\` and `"`).
function emitScalar(value) {
  const INDICATORS = new Set(['"', "'", "[", "]", "{", "}", "&", "*", "!", "|",
    ">", "@", "%", "`", ",", ":", "#", " "]);
  const firstNonSpace = value.replace(/^\s+/, "")[0];
  const needsQuote =
    value === "" ||                       // empty → "" so it's not parsed as null
    /^\s|\s$/.test(value) ||              // leading/trailing whitespace
    value.includes(" #") ||              // space-hash → stripped as inline comment
    (firstNonSpace !== undefined && INDICATORS.has(firstNonSpace)) ||
    scalar(value) !== value;             // bare token would coerce to bool/num/null
  if (needsQuote) {
    return '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  }
  return value;
}

// Emit a fresh, minimal `tracking:` block (create-from-scratch path only).
// `sets` is a map leafKey → rawValue. Keys are emitted in canonical TRACKING_KEYS
// order, restricted to the keys present in `sets`.
function emitTrackingBlock(sets) {
  let out = "tracking:\n";
  for (const fq of TRACKING_KEYS) {
    const leaf = fq.slice("tracking.".length);
    if (leaf in sets) out += "  " + leaf + ": " + emitScalar(sets[leaf]) + "\n";
  }
  return out;
}

// Surgical merge: edit the raw file text in place so only the targeted
// `tracking:` keys change; every other byte (other blocks, comments, ordering,
// trailing newline) survives. Returns { text, conflicts, changed }.
function mergeTrackingBlock(rawText, sets, force) {
  const indentOf = (line) => line.length - line.replace(/^ +/, "").length;
  const lines = rawText.split("\n");
  const conflicts = [];
  let changed = false;

  // Locate the top-level `tracking:` key (indent 0).
  let trackIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (indentOf(lines[i]) === 0 && lines[i].trim() === "tracking:") { trackIdx = i; break; }
  }

  if (trackIdx === -1) {
    // Block absent → append a fresh block. Ensure one blank line separates it
    // from prior non-empty content; preserve the original trailing-newline state.
    const hadTrailingNewline = rawText.endsWith("\n");
    let text = rawText;
    if (text.length > 0) {
      text = text.replace(/\n+$/, "");          // trim trailing blank lines
      if (text.length > 0) text += "\n\n";     // one blank-line separator
    }
    text += emitTrackingBlock(sets);            // emitTrackingBlock ends in \n
    if (!hadTrailingNewline) text = text.replace(/\n$/, "");
    return { text, conflicts, changed: true };
  }

  // Block present: its body is the run of subsequent lines at indent > 0, up to
  // the next indent-0 line (or EOF). Blank/comment lines inside stay in the run.
  let bodyEnd = trackIdx + 1;
  while (bodyEnd < lines.length) {
    const line = lines[bodyEnd];
    if (line.trim() === "") { bodyEnd++; continue; }          // blank — tentatively in body
    if (indentOf(line) > 0) { bodyEnd++; continue; }          // indented child — in body
    break;                                                     // next top-level key
  }
  // bodyEnd is the index of the first line NOT in the body (or lines.length).
  // Trim trailing blank lines back out of the body so inserts land before them.
  let insertAt = bodyEnd;
  while (insertAt > trackIdx + 1 && lines[insertAt - 1].trim() === "") insertAt--;

  // Sample the block's existing child indentation so an inserted key lands at the
  // SAME column as its siblings. parseYamlSubset's parseMap requires exact-indent
  // children (shared-infra.js:340): a line inserted at the wrong indent is read as
  // outside the block → dig() returns null → the round-trip guard fail-closes. The
  // first indented body line wins (a well-formed block's keys share one column);
  // fall back to 2 for an empty block (no indented child to sample). This honours
  // the user's own formatting (e.g. this repo's 4-space tracking body) without
  // touching any existing byte — the surgical-merge invariant. FAFF-531.
  let blockIndent = 2;
  for (let i = trackIdx + 1; i < bodyEnd; i++) {
    if (lines[i].trim() !== "" && indentOf(lines[i]) > 0) { blockIndent = indentOf(lines[i]); break; }
  }
  const pad = " ".repeat(blockIndent);

  for (const fq of TRACKING_KEYS) {
    const leaf = fq.slice("tracking.".length);
    if (!(leaf in sets)) continue;
    const rawValue = sets[leaf];
    const keyRe = new RegExp("^(\\s+)" + leaf.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*:");
    let foundIdx = -1;
    for (let i = trackIdx + 1; i < bodyEnd; i++) {
      if (keyRe.test(lines[i])) { foundIdx = i; break; }
    }
    if (foundIdx !== -1) {
      const colon = lines[foundIdx].indexOf(":");
      const existingRaw = stripInlineComment(lines[foundIdx].slice(colon + 1)).trim();
      const existingVal = scalar(existingRaw);
      // emitScalar guarantees the reader reads rawValue back AS the string rawValue,
      // so the desired post-write parsed value is the raw string itself — never
      // scalar(rawValue) (which would coerce "123" → 123 and mis-detect conflicts).
      const desiredVal = rawValue;
      if (existingVal === desiredVal) continue;              // no-op for this key
      if (!force) { conflicts.push({ key: leaf, existing: existingVal, desired: desiredVal }); continue; }
      const indent = lines[foundIdx].slice(0, indentOf(lines[foundIdx]));
      lines[foundIdx] = indent + leaf + ": " + emitScalar(rawValue);  // drops inline comment (force)
      changed = true;
    } else {
      // Insert a new child line at the end of the block body, at the block's own
      // child indent (sampled above) so it round-trips — never a hardcoded 2 (FAFF-531).
      lines.splice(insertAt, 0, pad + leaf + ": " + emitScalar(rawValue));
      insertAt++;
      bodyEnd++;
      changed = true;
    }
  }
  return { text: lines.join("\n"), conflicts, changed };
}

function cmdConfigInit(args, root) {
  // 1. Parse args.
  const sets = {};            // leafKey → rawValue
  const seen = {};            // leafKey → first rawValue seen (dup-with-conflict guard)
  const force = args.includes("--force");
  const dryRun = args.includes("--dry-run");
  // FAFF-1062: --local is the only thing that changes below — the target file and the
  // existing-file lookup it's resolved through. Everything else (merge core, round-trip
  // self-verify, conflict/legacy-name refusal) is unchanged.
  const local = args.includes("--local");
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--set") continue;
    const token = args[++i];
    if (token === undefined) {
      process.stderr.write("faff config init: --set requires KEY=VALUE\n");
      return 2;
    }
    const eq = token.indexOf("=");
    if (eq === -1) {
      process.stderr.write(`faff config init: malformed --set '${token}' (expected KEY=VALUE)\n`);
      return 2;
    }
    const rawKey = token.slice(0, eq);
    const value = token.slice(eq + 1);          // empty value is allowed
    const fq = rawKey.startsWith("tracking.") ? rawKey : "tracking." + rawKey;
    if (!TRACKING_KEYS.includes(fq)) {
      process.stderr.write(`faff config init: unknown key '${rawKey}'. Accepted keys: ${TRACKING_KEYS.join(", ")} (bare leaf keys accepted too).\n`);
      return 2;
    }
    // FAFF-430: reuse the same read-time host-vocab validator config-get enforces — a value
    // that would fail loud at read is refused at write (mirrors config-set's read⇒write belt;
    // config init has no other per-key value validation, so this seam is registered explicitly
    // here rather than assumed-inherited). Deliberately UNGUARDED by `value !== ""` — unlike
    // spec_docs_path (the documented empty-value stub key), git_host has no legitimate
    // empty-string form: an empty write must be refused here exactly as `config get` would
    // refuse reading it back (adversarial review finding, FAFF-430) — a write/read parity gap
    // would otherwise let `--set tracking.git_host=` succeed and then immediately fail loud on
    // the very next `config get`.
    // FAFF-1044: same read⇒write parity belt as git_host — a label-prefix value that would
    // fail loud at read is refused at write, so `--set tracking.label_prefix=` (or any
    // out-of-charset value) can never write-then-fail-on-next-read.
    const hostErr = validateGitHostValue(fq, value) || validateLabelPrefix(fq, value);
    if (hostErr) { process.stderr.write(hostErr + "\n"); return 2; }
    const leaf = fq.slice("tracking.".length);
    if (leaf in seen && seen[leaf] !== value) {
      process.stderr.write(`faff config init: key '${leaf}' set twice with different values ('${seen[leaf]}' vs '${value}') — ambiguous.\n`);
      return 2;
    }
    seen[leaf] = value;
    sets[leaf] = value;
  }
  if (Object.keys(sets).length === 0) {
    process.stderr.write("faff config init: nothing to set (pass --set KEY=VALUE).\n");
    return 2;
  }

  // 2. Resolve target file. findConfig/findOverlay throws legacy-config-name → propagates to
  //    cmdConfig's catch (the refuse-second-file guarantee). Do NOT catch here.
  const { target: canonicalPath, targetName, existingPath, location } = resolveWriteTarget(root, local);
  printLocationNotice(root, location, local ? "overlay" : "base");

  // 3. Compute merged text (surgical; never reserialise).
  let newText, conflicts = [], changed;
  if (existingPath === null) {
    newText = INIT_HEADER + emitTrackingBlock(sets);
    changed = true;
  } else {
    const rawText = fs.readFileSync(existingPath, "utf8");
    ({ text: newText, conflicts, changed } = mergeTrackingBlock(rawText, sets, force));
    if (conflicts.length && !force) {
      process.stderr.write("faff config init: refusing to overwrite differing value(s) without --force:\n");
      for (const c of conflicts) {
        process.stderr.write(`  tracking.${c.key} is '${fmt(c.existing)}' in the file; --set passed '${fmt(c.desired)}'.\n`);
      }
      process.stderr.write("Re-run with --force to overwrite, or change the value.\n");
      return 2;
    }
    if (!changed) {
      console.log("config init: no changes (all values already set).");
      return 0;
    }
  }

  // 4. Round-trip self-verify against the real reader before committing the write.
  const parsed = parseYamlSubset(newText);
  for (const [leaf, rawValue] of Object.entries(sets)) {
    const got = dig(parsed, "tracking." + leaf);
    // emitScalar is the inverse of scalar(): the reader must return the raw string
    // we were handed (quoting coerces "123"/"true"/"~" back to those strings).
    const want = rawValue;
    if (got !== want) {
      process.stderr.write(`faff config init: internal error — written text does not round-trip (tracking.${leaf}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}); aborting to avoid a corrupt config.\n`);
      return 2;
    }
  }

  // 5. Output.
  if (dryRun) {
    process.stdout.write(newText.endsWith("\n") ? newText : newText + "\n");
    return 0;
  }
  writeConfigFile(canonicalPath, newText);
  const n = Object.keys(sets).length;
  console.log(existingPath === null
    ? `config init: created ${targetName} with ${n} key(s).`
    : `config init: wrote ${n} key(s) to ${targetName}.`);
  return 0;
}

// ---------------------------------------------------------------------------
// config set — FAFF-667: the general scalar-leaf writer. `config init` bootstraps the 7 flat
// tracking.* keys; every OTHER behaviour key (backends.*, dispatch.*, slots.*, appetite, ...) had
// no sanctioned write path at all. `set` fixes that: writes a scalar leaf at ANY nesting depth
// via the same surgical raw-text discipline as mergeTrackingBlock (never parse-then-reserialise),
// round-trips through the real reader before committing, and reuses config-get's own validators
// so a value that would fail loud at read is refused at write.
// ---------------------------------------------------------------------------

// The array-valued config keys a `key value` grammar cannot express. Refused BY IDENTITY,
// before the file is even read: the documented JSON-string default form of these keys
// (e.g. `fallbacks: '[{"provider":...}]'`) reads back as a plain scalar via scalar() (no JSON
// parse on quoted values), so a value-SHAPE guard alone cannot tell it apart from a legitimate
// string — a `--force` write would silently flatten the whole fallback chain. Bound to the
// schema by configSetSelftest's drift check (mirrors the WRITABLE_NAMESPACES drift check below).
const SEQUENCE_VALUED_KEYS = new Set([
  "adversarial.refs",
  "adversarial.fallbacks",
  "adversarial.backends",
  // FAFF-1080: teams is a block-sequence and team_routing a nested map — both refused by
  // `config set` for the same reason as the adversarial.* keys above (preserves the
  // scalar-only writer invariant, FAFF-667); hand-edited in the committed base instead.
  "tracking.teams",
  "tracking.team_routing",
]);

// FAFF-870: per-consumer adversarial refs (`adversarial.<consumer>.refs`) are the
// same list-valued shape as `adversarial.refs`, refused for the same reason — but
// the consumer name is open-ended (spec_review / code_review / prdr_review, and
// any future adversarial consumer inherits the seam for free), so an exact key
// set cannot enumerate them. The regex closes the whole three-segment
// `adversarial.<name>.refs` shape; it never matches the two-segment
// `adversarial.refs` (already in the set above) nor `adversarial.<consumer>.timeout`
// (a legitimate writable scalar leaf). Bound to the schema by configSetSelftest.
const PER_CONSUMER_REFS_KEY = /^adversarial\.[A-Za-z0-9_]+\.refs$/;
// FAFF-1080 (adversarial review finding): `tracking.team_routing` is refused by exact-key match
// above, but `config set` writes at ANY dotted depth, so `tracking.team_routing.spike IDEAS`
// targets a LEAF under the refused key and would otherwise slip through as an ordinary nested-map
// write — building the hand-edit-only map back up key-by-key through the writer it was routed
// AROUND. Close the whole subtree, not just the exact key.
const TEAM_ROUTING_LEAF_KEY = /^tracking\.team_routing\./;
function isSequenceValuedKey(key) {
  return SEQUENCE_VALUED_KEYS.has(key) || PER_CONSUMER_REFS_KEY.test(key) || TEAM_ROUTING_LEAF_KEY.test(key);
}

// Recognised top-level config namespaces `config set` may write into — a cheap typo guard at
// the root. Low-churn: a new LEAF under an existing namespace needs no edit here; only a
// brand-new top-level namespace does (a deliberate schema addition). Every top-level key
// documented in .faffrc.example.yaml must be a member — asserted by configSetSelftest.
const WRITABLE_NAMESPACES = new Set([
  "tracking", "slots", "eval", "dispatch", "backends", "engines", "appetite",
  "concurrency_max", "worktree_root", "logging",
  "intake_gate", "gates", "convergence", "budget", "sentry", "adr", "prdr",
  "adversarial", "autonomous", "containment", "post_merge", "graft", "andon",
  "bundle_store", "install", "lanes", "producer_tick_max_secs", "conventions",
  "verification", "bridge",
]);

// Top-level namespaces faff genuinely READS (via dig(config, "<ns>.…")) but that `config set`
// does not write and `DEFAULTS` does not register — recognised by the known-key lint (FAFF-794)
// without being promoted to WRITABLE_NAMESPACES (FAFF-965). Folding a read-only namespace into
// WRITABLE_NAMESPACES would make `config set <ns>.<leaf> <value>` silently succeed for a key
// with no DEFAULTS entry (a get/set asymmetry) and would force it into .faffrc.example.yaml to
// satisfy configSetSelftest's example-drift check, over-promoting a read-only key as writable.
// Every namespace the source reads via a blessed dig() call must be a member — asserted by the
// recognised-namespaces drift --selftest case below (`faff config check --selftest`), which
// fails loud on drift instead of silently reintroducing this bug (FAFF-949 added the `capture`
// read without this entry; `provenance` was already dormant the same way).
const READ_ONLY_NAMESPACES = new Set([
  "capture",     // decision-capture.js: dig(data, "capture.decision_kernel")
  "provenance",  // harness.js: dig(cfgData, "provenance.harness" | "provenance.model")
  "commissaire", // commissaire-governor-client.js (FAFF-1179): dig(cfg, "commissaire.governor" | ".connect_timeout_ms" | ".reply_timeout_ms")
  "review",      // review-fixture-paths.js: dig(cfg, "review.fixture_paths")
]);

// The known-key lint's notion of "not a typo" — every namespace `config set` may write, PLUS
// every read-only namespace above. Kept as a derived union (never merged into WRITABLE_NAMESPACES
// itself) so the writable-vs-recognised distinction stays load-bearing for `config set`'s
// write-guard and configSetSelftest's example-drift check, both of which keep using
// WRITABLE_NAMESPACES directly, untouched by this addition.
const RECOGNISED_NAMESPACES = new Set([...WRITABLE_NAMESPACES, ...READ_ONLY_NAMESPACES]);

// Emit a brand-new nested chain (create-from-scratch path — no existing .faffrc.yaml). Each
// segment but the last becomes a bare map-header line at escalating 2-space indent; the leaf
// carries the value.
function emitChainBlock(segments, value) {
  const lines = [];
  for (let i = 0; i < segments.length - 1; i++) lines.push(" ".repeat(i * 2) + segments[i] + ":");
  lines.push(" ".repeat((segments.length - 1) * 2) + segments[segments.length - 1] + ": " + emitScalar(value));
  return lines.join("\n") + "\n";
}

// Splice `chainLines` (already indented) either as a brand-new top-level block (mirrors
// mergeTrackingBlock's block-absent branch: trim trailing blank lines, one blank-line
// separator, preserve the file's trailing-newline state) or into an existing window's body
// (trim trailing blanks within the window first, so the insert lands before them).
function spliceOrAppendChain(lines, rawText, chainLines, windowStart, windowEnd, isTopLevel) {
  if (isTopLevel) {
    const hadTrailingNewline = rawText.endsWith("\n");
    let text = rawText;
    if (text.length > 0) {
      text = text.replace(/\n+$/, "");
      if (text.length > 0) text += "\n\n";
    }
    text += chainLines.join("\n") + "\n";
    if (!hadTrailingNewline) text = text.replace(/\n$/, "");
    return text;
  }
  let insertAt = windowEnd;
  while (insertAt > windowStart && lines[insertAt - 1].trim() === "") insertAt--;
  lines.splice(insertAt, 0, ...chainLines);
  return lines.join("\n");
}

// General nested-path surgical writer — the arbitrary-depth extension of mergeTrackingBlock's
// proven discipline. Given the raw file text, a dotted key's segments, and a scalar value,
// changes only the line(s) needed to set that leaf; creates any missing intermediate maps at
// the correct sibling-matching indent (never a hardcoded 2 — FAFF-531); leaves every other byte
// alone. Returns { text, conflict, changed, typeError }.
function mergeConfigPath(rawText, segments, rawValue, force) {
  const indentOf = (line) => line.length - line.replace(/^ +/, "").length;
  const isBlankOrComment = (line) => line.trim() === "" || line.trim().startsWith("#");
  const keyOf = (line) => {
    const content = stripInlineComment(line.trim());
    const ci = content.indexOf(":");
    return (ci === -1 ? content : content.slice(0, ci)).trim();
  };
  const lines = rawText.split("\n");

  let windowStart = 0, windowEnd = lines.length, expectedIndent = 0;

  // Descend through every segment but the last, narrowing the search window to that key's body.
  for (let s = 0; s < segments.length - 1; s++) {
    const seg = segments[s];
    let foundIdx = -1;
    for (let i = windowStart; i < windowEnd; i++) {
      const line = lines[i];
      if (isBlankOrComment(line)) continue;
      if (indentOf(line) !== expectedIndent) continue;
      if (keyOf(line) === seg) { foundIdx = i; break; }
    }
    if (foundIdx === -1) {
      // `seg` (and everything below it) is absent — emit the remaining chain from here.
      const remaining = segments.slice(s);
      const chainLines = [];
      for (let k = 0; k < remaining.length - 1; k++) chainLines.push(" ".repeat(expectedIndent + k * 2) + remaining[k] + ":");
      chainLines.push(" ".repeat(expectedIndent + (remaining.length - 1) * 2) + remaining[remaining.length - 1] + ": " + emitScalar(rawValue));
      const isTopLevel = windowStart === 0 && windowEnd === lines.length && expectedIndent === 0;
      const text = spliceOrAppendChain(lines, rawText, chainLines, windowStart, windowEnd, isTopLevel);
      return { text, conflict: null, changed: true, typeError: null };
    }
    const line = lines[foundIdx];
    const colon = line.indexOf(":");
    const after = stripInlineComment(line.slice(colon + 1)).trim();
    if (after !== "") {
      return { text: rawText, conflict: null, changed: false,
        typeError: `config set: '${segments.slice(0, s + 1).join(".")}' is a scalar; can't descend into it` };
    }
    // Descend: body = the run of lines after `line` at indent > line's own indent.
    const parentIndent = indentOf(line);
    let bodyStart = foundIdx + 1, bodyEnd = bodyStart;
    while (bodyEnd < windowEnd) {
      const l = lines[bodyEnd];
      if (l.trim() === "") { bodyEnd++; continue; }
      if (indentOf(l) > parentIndent) { bodyEnd++; continue; }
      break;
    }
    // Sample the body's own child indent so an inserted key lands at the same column as its
    // siblings (FAFF-531) — fall back to parentIndent+2 for an empty body.
    let childIndent = null;
    for (let i = bodyStart; i < bodyEnd; i++) {
      if (lines[i].trim() !== "" && indentOf(lines[i]) > parentIndent) { childIndent = indentOf(lines[i]); break; }
    }
    windowStart = bodyStart; windowEnd = bodyEnd; expectedIndent = childIndent === null ? parentIndent + 2 : childIndent;
  }

  // All ancestors resolved (or there was only one segment) — locate the leaf in this window.
  const leaf = segments[segments.length - 1];
  let leafIdx = -1;
  for (let i = windowStart; i < windowEnd; i++) {
    const line = lines[i];
    if (isBlankOrComment(line)) continue;
    if (indentOf(line) !== expectedIndent) continue;
    if (keyOf(line) === leaf) { leafIdx = i; break; }
  }

  if (leafIdx === -1) {
    const chainLines = [" ".repeat(expectedIndent) + leaf + ": " + emitScalar(rawValue)];
    const isTopLevel = windowStart === 0 && windowEnd === lines.length && expectedIndent === 0;
    const text = spliceOrAppendChain(lines, rawText, chainLines, windowStart, windowEnd, isTopLevel);
    return { text, conflict: null, changed: true, typeError: null };
  }

  const line = lines[leafIdx];
  const colon = line.indexOf(":");
  const after = stripInlineComment(line.slice(colon + 1)).trim();
  const parentIndent = indentOf(line);
  // A block-sequence / nested-map target: children at indent > parentIndent immediately below.
  let hasChildren = false;
  for (let i = leafIdx + 1; i < windowEnd; i++) {
    const l = lines[i];
    if (l.trim() === "") continue;
    hasChildren = indentOf(l) > parentIndent;
    break;
  }
  const existingVal = after === "" ? null : scalar(after);
  // Inline-flow ([a,b] / {...}) also reads as a structured (non-string, non-scalar) value.
  const isArrayOrObject = existingVal !== null && typeof existingVal === "object";
  if (hasChildren || isArrayOrObject) {
    return { text: rawText, conflict: null, changed: false,
      typeError: `config set: '${segments.join(".")}' holds a list/map; scalar set can't target it — hand-edit the committed base` };
  }
  const desiredVal = rawValue;
  if (existingVal === desiredVal) return { text: rawText, conflict: null, changed: false, typeError: null };
  if (!force) return { text: rawText, conflict: { key: segments.join("."), existing: existingVal, desired: desiredVal }, changed: false, typeError: null };
  const indent = line.slice(0, parentIndent);
  lines[leafIdx] = indent + leaf + ": " + emitScalar(rawValue);
  return { text: lines.join("\n"), conflict: null, changed: true, typeError: null };
}

function cmdConfigSet(args, root) {
  const force = args.includes("--force");
  const dryRun = args.includes("--dry-run");
  // FAFF-1062: same overlay-vs-base switch as cmdConfigInit — only the target + the
  // existing-file lookup change; the merge core, round-trip self-verify, and every
  // validator below are unchanged.
  const local = args.includes("--local");
  const positionals = args.filter((a) => !a.startsWith("--"));
  const key = positionals[0];
  const value = positionals[1];
  if (key === undefined || value === undefined) {
    process.stderr.write("faff config set: requires <dotted.key> <value>\n");
    return 2;
  }
  const segments = key.split(".");
  const removedSetErr = removedKeyError(key);
  if (removedSetErr) { process.stderr.write(removedSetErr + "\n"); return 2; }
  if (!WRITABLE_NAMESPACES.has(segments[0])) {
    process.stderr.write(`faff config set: unknown config namespace '${segments[0]}' — writable namespaces: ${[...WRITABLE_NAMESPACES].sort().join(", ")}\n`);
    return 2;
  }
  // By NAME, before touching the file: the JSON-string form of these keys reads back as a
  // plain scalar, so a value-shape guard alone cannot catch it (see SEQUENCE_VALUED_KEYS above).
  if (isSequenceValuedKey(key)) {
    process.stderr.write(`faff config set: '${key}' is a list-valued key — hand-edit the committed base (config set writes scalar leaves only)\n`);
    return 2;
  }
  // Reuse the SAME shape/vocab validators `config get` runs for this key — a value that would
  // fail loud at read is refused at write. Engine EXISTENCE (validateEngineRef) is deliberately
  // not run here: it needs a complete engine (provider+model+host) a first `set` hasn't written
  // yet; existence is already checked at read/resolution.
  const writeErr = validateEvalKey(key, value) || validateDispatchKey(key, value) || validateGitHostValue(key, value) || validateLabelPrefix(key, value) || validateControlLabelName(key, value) || validateIsolationLane(key, value);
  if (writeErr) { process.stderr.write(writeErr + "\n"); return 2; }

  const { target: canonicalPath, targetName, existingPath, location } = resolveWriteTarget(root, local);
  printLocationNotice(root, location, local ? "overlay" : "base");
  let newText;
  if (existingPath === null) {
    newText = INIT_HEADER + emitChainBlock(segments, value);
  } else {
    const rawText = fs.readFileSync(existingPath, "utf8");
    const { text, conflict, changed, typeError } = mergeConfigPath(rawText, segments, value, force);
    if (typeError) { process.stderr.write(typeError + "\n"); return 2; }
    if (conflict && !force) {
      process.stderr.write(`faff config set: refusing to overwrite ${conflict.key} ('${fmt(conflict.existing)}' -> '${fmt(conflict.desired)}') without --force\n`);
      return 2;
    }
    if (!changed) {
      console.log(`config set: no change (${key} already '${value}')`);
      return 0;
    }
    newText = text;
  }

  // Round-trip self-verify against the real reader BEFORE writing — a wrong-indent bug in the
  // nested-path logic must fail loud (exit 2, no write), never persist a corrupt file. The
  // key-identity + value-shape guards above already refused a sequence/map target, so a
  // passing round-trip here means a genuine scalar leaf.
  const parsed = parseYamlSubset(newText);
  const got = dig(parsed, key);
  if (got !== value) {
    process.stderr.write(`faff config set: internal error — written text does not round-trip (${key}: got ${JSON.stringify(got)}, want ${JSON.stringify(value)}); aborting to avoid a corrupt config.\n`);
    return 2;
  }

  if (dryRun) {
    process.stdout.write(newText.endsWith("\n") ? newText : newText + "\n");
    return 0;
  }
  writeConfigFile(canonicalPath, newText);
  console.log(`config set: wrote ${key}=${value} to ${targetName}.`);
  return 0;
}

function hasConfigPath(data, segments) {
  let current = data;
  for (const segment of segments) {
    if (!isPlainConfigMap(current) || !Object.hasOwn(current, segment)) return false;
    current = current[segment];
  }
  return true;
}

// Surgical removal of a dotted key's line span (the key line plus every following line that is
// blank or indented deeper), then of any ancestor map left without a key line. Pure: returns
// { status: removed|absent|list|inline-ancestor, text, pruned, ancestor? } and never re-emits
// the file from a parse, so comments and every byte outside the span survive.
function removeConfigPath(rawText, segments) {
  const indentOf = (line) => line.length - line.replace(/^ +/, "").length;
  const isBlank = (line) => line.trim() === "";
  const isBlankOrComment = (line) => isBlank(line) || line.trim().startsWith("#");
  const keyOf = (line) => {
    const content = stripInlineComment(line.trim());
    const colon = content.indexOf(":");
    return (colon === -1 ? content : content.slice(0, colon)).trim();
  };
  const inlineValueOf = (line) => stripInlineComment(line.slice(line.indexOf(":") + 1)).trim();
  const unchanged = (status, extra = {}) => ({ status, text: rawText, pruned: [], ...extra });

  const endsWithNewline = rawText.endsWith("\n");
  const lines = (endsWithNewline ? rawText.slice(0, -1) : rawText).split("\n");

  const bodyEndOf = (idx, windowEnd) => {
    const indent = indentOf(lines[idx]);
    const isShallowComment = (line) => !isBlank(line) && line.trim().startsWith("#") && indentOf(line) <= indent;
    const deeperCodeFollows = (from) => {
      const next = firstKeyLine(from, windowEnd);
      return next !== undefined && indentOf(next) > indent;
    };
    let end = idx + 1;
    while (end < windowEnd) {
      const line = lines[end];
      const inBody = isBlank(line) || indentOf(line) > indent || (isShallowComment(line) && deeperCodeFollows(end + 1));
      if (!inBody) break;
      end++;
    }
    while (end > idx + 1 && (isBlank(lines[end - 1]) || isShallowComment(lines[end - 1]))) end--;
    return end;
  };
  const firstKeyLine = (from, to) => lines.slice(from, to).find((line) => !isBlankOrComment(line));

  let windowStart = 0, windowEnd = lines.length, expectedIndent = 0;
  const findKey = (segment) => {
    for (let i = windowStart; i < windowEnd; i++) {
      if (isBlankOrComment(lines[i]) || indentOf(lines[i]) !== expectedIndent) continue;
      if (keyOf(lines[i]) === segment) return i;
    }
    return -1;
  };

  const ancestors = [];
  for (let s = 0; s < segments.length - 1; s++) {
    const idx = findKey(segments[s]);
    if (idx === -1) return unchanged("absent");
    const ancestorPath = segments.slice(0, s + 1).join(".");
    const inline = inlineValueOf(lines[idx]);
    if (inline !== "") {
      const value = scalar(inline);
      return isPlainConfigMap(value) && hasConfigPath(value, segments.slice(s + 1))
        ? unchanged("inline-ancestor", { ancestor: ancestorPath })
        : unchanged("absent");
    }
    ancestors.push({ idx, path: ancestorPath });
    windowEnd = bodyEndOf(idx, windowEnd);
    windowStart = idx + 1;
    const child = firstKeyLine(windowStart, windowEnd);
    expectedIndent = child === undefined ? indentOf(lines[idx]) + 2 : indentOf(child);
  }

  const leafIdx = findKey(segments[segments.length - 1]);
  if (leafIdx === -1) return unchanged("absent");
  const leafInline = inlineValueOf(lines[leafIdx]);
  const firstChild = firstKeyLine(leafIdx + 1, bodyEndOf(leafIdx, windowEnd));
  const isInlineList = leafInline.startsWith("[") && leafInline.endsWith("]");
  const isListItem = (line) => /^-(\s|$)/.test(line.trim());
  const nextKeyLine = firstKeyLine(leafIdx + 1, windowEnd);
  const isUnindentedList = leafInline === "" && nextKeyLine !== undefined && indentOf(nextKeyLine) === indentOf(lines[leafIdx]) && isListItem(nextKeyLine);
  const isBlockList = isUnindentedList || (leafInline === "" && firstChild !== undefined && isListItem(firstChild));
  if (isInlineList || isBlockList) return unchanged("list");

  const spanEndOf = (idx) => {
    let end = bodyEndOf(idx, lines.length);
    while (end > idx + 1 && isBlank(lines[end - 1])) end--;
    return end;
  };
  const removeSpan = (start, end) => {
    const nothingFollows = lines.slice(end).every(isBlank);
    if (nothingFollows) {
      lines.length = start;
      while (lines.length && isBlank(lines[lines.length - 1])) lines.pop();
      return;
    }
    const precededByBlank = start === 0 || isBlank(lines[start - 1]);
    const dropFollowingBlank = precededByBlank && isBlank(lines[end]);
    lines.splice(start, end - start + (dropFollowingBlank ? 1 : 0));
  };

  removeSpan(leafIdx, spanEndOf(leafIdx));
  const pruned = [];
  for (let a = ancestors.length - 1; a >= 0; a--) {
    const { idx, path: ancestorPath } = ancestors[a];
    if (lines.slice(idx + 1, bodyEndOf(idx, lines.length)).some((line) => !isBlankOrComment(line))) break;
    removeSpan(idx, spanEndOf(idx));
    pruned.push(ancestorPath);
  }
  const text = lines.length ? lines.join("\n") + (endsWithNewline ? "\n" : "") : "";
  return { status: "removed", text, pruned };
}

function leafPaths(data, prefix = []) {
  if (prefix.length === 0 && isPlainConfigMap(data) && Object.keys(data).length === 0) return [];
  if (!isPlainConfigMap(data) || Object.keys(data).length === 0) return [[prefix.join("."), JSON.stringify(data)]];
  return Object.entries(data).flatMap(([key, value]) => leafPaths(value, [...prefix, key]));
}

// Proves a removal against the real reader: the new parse must equal the old parse minus
// exactly the key and the ancestors it emptied. Returns null on success, else a detail that
// names key paths only, never values.
function verifyUnset(rawText, newText, segments) {
  const expected = structuredClone(parseYamlSubset(rawText));
  const chain = [expected];
  for (const segment of segments.slice(0, -1)) {
    const next = chain[chain.length - 1][segment];
    if (!isPlainConfigMap(next)) break;
    chain.push(next);
  }
  if (chain.length !== segments.length) return "key path does not resolve to a map chain in the original parse";
  delete chain[chain.length - 1][segments[chain.length - 1]];
  for (let depth = chain.length - 1; depth > 0 && Object.keys(chain[depth]).length === 0; depth--) {
    delete chain[depth - 1][segments[depth - 1]];
  }
  const after = parseYamlSubset(newText);
  if (isDeepStrictEqual(after, expected)) return null;
  const want = new Map(leafPaths(expected)), got = new Map(leafPaths(after));
  const differing = [...new Set([...want.keys(), ...got.keys()])].filter((p) => want.get(p) !== got.get(p));
  return `differs at ${differing.join(", ") || "(root)"}; a duplicate key can cause this, so repair it or regenerate with faff config init`;
}

function cmdConfigUnset(args, root) {
  const local = args.includes("--local");
  const dryRun = args.includes("--dry-run");
  const positionals = args.filter((a) => !a.startsWith("--"));
  const segments = positionals.length === 1 ? positionals[0].split(".") : [];
  if (segments.length === 0 || segments.includes("")) {
    process.stderr.write("faff config unset: requires exactly one <dotted.key>\n");
    return 2;
  }
  const key = positionals[0];
  if (isSequenceValuedKey(key)) return refuseListKey(key);

  const { target, targetName, existingPath, location } = resolveWriteTarget(root, local);
  printLocationNotice(root, location, local ? "overlay" : "base");
  if (existingPath === null) {
    process.stderr.write(`faff config unset: no ${targetName} in ${root}; nothing to unset\n`);
    return 3;
  }
  const rawText = fs.readFileSync(existingPath, "utf8");
  const result = removeConfigPath(rawText, segments);
  if (result.status === "absent") {
    process.stderr.write(`faff config unset: '${key}' is not set in ${targetName}\n`);
    return 3;
  }
  if (result.status === "list") return refuseListKey(key);
  if (result.status === "inline-ancestor") {
    process.stderr.write(`faff config unset: '${result.ancestor}' is an inline map; unset '${result.ancestor}' instead\n`);
    return 2;
  }
  const mismatch = verifyUnset(rawText, result.text, segments);
  if (mismatch) {
    process.stderr.write(`faff config unset: internal error, edited text does not round-trip (${mismatch}); aborting to avoid a corrupt config.\n`);
    return 2;
  }
  if (dryRun) {
    process.stdout.write(result.text.endsWith("\n") || result.text === "" ? result.text : result.text + "\n");
    return 0;
  }
  writeConfigFile(target, result.text);
  const prunedNote = result.pruned.length ? ` Pruned empty ${result.pruned.join(", ")}.` : "";
  console.log(`config unset: removed ${key} from ${targetName}.${prunedNote}`);
  noteKeyStillSetElsewhere(root, local, segments, key);
  return 0;
}

function refuseListKey(key) {
  process.stderr.write(`faff config unset: '${key}' is a list-valued key; hand-edit the committed base (config unset removes maps and scalars only)\n`);
  return 2;
}

function noteKeyStillSetElsewhere(root, editedLocal, segments, key) {
  try {
    const otherPath = editedLocal ? findConfig(root) : findOverlay(root);
    if (otherPath === null) return;
    if (hasConfigPath(parseYamlSubset(fs.readFileSync(otherPath, "utf8")), segments)) {
      const shown = isInsideRoot(root, otherPath) ? toPosix(path.relative(root, otherPath)) : otherPath;
      process.stderr.write(`note: ${key} is still set in ${shown}; faff config get reads the merged value.\n`);
    }
  } catch { /* best-effort: the note never changes the outcome */ }
}

// In-memory self-test for removeConfigPath and verifyUnset. Every editing case asserts the exact
// edited text, because the round-trip proof cannot see comment or blank-line damage.

module.exports = { cmdConfigInit, cmdConfigSet, cmdConfigUnset, emitChainBlock, emitScalar, emitTrackingBlock, INIT_HEADER, isSequenceValuedKey, locationNoticeText, mergeConfigPath, mergeTrackingBlock, printLocationNotice, RECOGNISED_NAMESPACES, removeConfigPath, SEQUENCE_VALUED_KEYS, TRACKING_KEYS, verifyUnset, WRITABLE_NAMESPACES };
