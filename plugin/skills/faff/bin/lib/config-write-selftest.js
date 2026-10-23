// ===========================================================================
// === region:factory — config-write-selftest — the `config init`, `config set` and `config unset` selftests ===
// ===========================================================================
// FAFF-1389: split out of config.js, which re-exports every name below that it exported before.

const fs = require("node:fs");
const path = require("node:path");
const { CANONICAL_EXAMPLE_CONFIG, dig, parseYamlSubset, scalar } = require("./shared-infra");
const { resetTemplatesDeprecationNotice, resolveAdrDocsPath, resolveAdrSupersededDocsPath, resolveSpikeDocsPath, resolveTemplatesPath } = require("./config-core");
const { INIT_HEADER, SEQUENCE_VALUED_KEYS, TRACKING_KEYS, WRITABLE_NAMESPACES, emitScalar, emitTrackingBlock, isSequenceValuedKey, mergeConfigPath, mergeTrackingBlock, removeConfigPath, verifyUnset } = require("./config-write");

function configUnsetSelftest() {
  let fail = 0;
  const check = (label, cond) => {
    if (!cond) fail++;
    console.log(`${cond ? "ok  " : "FAIL"} ${label}`);
  };
  const removes = (label, text, key, want, wantPruned = []) => {
    const r = removeConfigPath(text, key.split("."));
    check(`${label}: exact text`, r.status === "removed" && r.text === want);
    check(`${label}: pruned ${JSON.stringify(wantPruned)}`, JSON.stringify(r.pruned) === JSON.stringify(wantPruned));
    check(`${label}: round-trips`, verifyUnset(text, r.text, key.split(".")) === null);
  };
  const status = (label, text, key, want) => check(`${label}: ${want}`, removeConfigPath(text, key.split(".")).status === want);

  removes("leaf", "a:\n  b: 1\n  c: 2\n", "a.b", "a:\n  c: 2\n");
  removes("block", "x: 1\nmodels:\n  build: sonnet\n  spec: opus\ny: 2\n", "models", "x: 1\ny: 2\n");
  removes("two-level prune", "keep: 1\ndispatch:\n  spec:\n    effort: low\n", "dispatch.spec.effort", "keep: 1\n", ["dispatch.spec", "dispatch"]);
  removes("comment-only parent pruned", "a:\n  b: 1\n  # note\nz: 1\n", "a.b", "z: 1\n", ["a"]);
  removes("detached comment kept", "# about models\nmodels:\n  build: sonnet\nz: 1\n", "models", "# about models\nz: 1\n");
  removes("deeper comment removed", "models:\n  # legacy\n  spec: opus\nz: 1\n", "models", "z: 1\n");
  removes("sibling comment at key indent kept", "a:\n  b: 1\n  # for c\n  c: 2\n", "a.b", "a:\n  # for c\n  c: 2\n");
  removes("inline comment goes with the key", "models: # lanes\n  build: x\nz: 1\n", "models", "z: 1\n");
  removes("blank separator collapses", "a: 1\n\nmodels:\n  build: x\n\nz: 1\n", "models", "a: 1\n\nz: 1\n");
  removes("blank kept when comment precedes", "a: 1\n\n# lanes\nmodels:\n  build: x\n\nz: 1\n", "models", "a: 1\n\n# lanes\n\nz: 1\n");
  removes("last block leaves no trailing blank", "a: 1\n\nmodels:\n  build: x\n", "models", "a: 1\n");
  removes("first block leaves no leading blank", "models:\n  build: x\n\nz: 1\n", "models", "z: 1\n");
  removes("trailing newline absent stays absent", "a: 1\nb: 2", "b", "a: 1");
  removes("trailing newline present stays present", "a: 1\nb: 2\n", "b", "a: 1\n");
  removes("emptied file is empty text", "a:\n  b: 1\n", "a.b", "", ["a"]);
  removes("block scalar leaf", "a:\n  note: |\n    one\n    two\n  keep: 1\n", "a.note", "a:\n  keep: 1\n");
  removes("null leaf (bare key)", "a: 1\nmodels:\nb: 2\n", "models", "a: 1\nb: 2\n");
  removes("null leaf (explicit)", "a: 1\nmodels: null\nb: 2\n", "models", "a: 1\nb: 2\n");
  removes("tilde leaf", "a: 1\nmodels: ~\n", "models", "a: 1\n");
  removes("4-space indent", "a:\n    b:\n        c: 1\n    d: 2\n", "a.b.c", "a:\n    d: 2\n", ["a.b"]);
  removes("4-space leaf keeps sibling", "a:\n    b: 1\n    c: 2\n", "a.b", "a:\n    c: 2\n");
  removes("inline flow map leaf", "infra: {\"a\": 1}\nz: 1\n", "infra", "z: 1\n");
  removes("subtree holding a list", "adversarial:\n  refs:\n    - a\n  timeout: 5\nz: 1\n", "adversarial", "z: 1\n");
  removes("leaf removal prunes a single-child parent", "a:\n  x: 1\nb: 1\n", "a.x", "b: 1\n", ["a"]);

  removes("block scalar whose text starts with a dash", "notes: |\n  - item one\nz: 1\n", "notes", "z: 1\n");
  removes("folded block scalar with chomping", "a:\n  notes: >-\n    - item\n  keep: 1\n", "a.notes", "a:\n  keep: 1\n");
  check("verifyUnset fails when the chain stops at a non-map", verifyUnset("a: 1\n", "", ["a", "b"]) !== null);
  status("unindented block sequence", "teams:\n- A\nz: 1\n", "teams", "list");
  status("block-sequence leaf", "tracking:\n  items:\n    - A\n    - B\n", "tracking.items", "list");
  status("bare-word inline list", "k: [a, b]\n", "k", "list");
  status("JSON inline list", "k: [\"a\",\"b\"]\n", "k", "list");
  status("inline list with comment", "k: [a, b]  # c\n", "k", "list");
  status("inline-map ancestor", "a: {\"b\": 1}\n", "a.b", "inline-ancestor");
  status("partial-path inline map", "a: {\"b\": 1}\n", "a.b.c", "absent");
  status("absent leaf", "a:\n  b: 1\n", "a.c", "absent");
  status("absent top-level", "a: 1\n", "zz", "absent");
  status("absent ancestor", "a: 1\n", "x.y", "absent");
  status("scalar ancestor", "tracking: foo\n", "tracking.provider", "absent");
  status("nested key not matched at top level", "a:\n  b: 1\n", "b", "absent");
  status("empty text", "", "a", "absent");
  status("inherited property name is not a key", "a: {\"b\": 1}\n", "a.toString", "absent");
  removes("shallower comment inside a block: leaf", "a:\n  b: 1\n# old\n  c: 2\n", "a.c", "a:\n  b: 1\n# old\n");
  removes("shallower comment inside a block: whole block", "a:\n  b: 1\n# old\n  c: 2\nz: 1\n", "a", "z: 1\n");
  removes("detached comment above next sibling survives", "a:\n  b: 1\n# next\nz: 1\n", "a", "# next\nz: 1\n");
  check("inline-ancestor names the ancestor", removeConfigPath("x:\n  a: {\"b\": 1}\n", ["x", "a", "b"]).ancestor === "x.a");
  check("absent leaves the text untouched", removeConfigPath("a: 1\n", ["q"]).text === "a: 1\n");

  const duplicate = "models:\n  a: 1\nmodels:\n  b: 2\n";
  const dupEdit = removeConfigPath(duplicate, ["models"]);
  const dupDetail = verifyUnset(duplicate, dupEdit.text, ["models"]);
  check("duplicate key: round-trip fails", typeof dupDetail === "string" && dupDetail.includes("models.b"));
  check("duplicate key: detail carries no value", !dupDetail.includes("2"));
  check("verifyUnset passes a faithful edit", verifyUnset("a:\n  b: 1\n  c: 2\n", "a:\n  c: 2\n", ["a", "b"]) === null);
  check("verifyUnset catches a damaged sibling", verifyUnset("a:\n  b: 1\n  c: 2\n", "a:\n  c: 3\n", ["a", "b"]) !== null);

  for (const key of ["adversarial.refs", "tracking.teams", "tracking.team_routing.x", "adversarial.spec_review.refs"]) {
    check(`by-name list refusal: ${key}`, isSequenceValuedKey(key));
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (config unset, ${fail} failed)`);
  return fail ? 1 : 0;
}

// In-memory self-test for cmdConfigSet's pure helpers + the round-trip contract. Mirrors
// configInitSelftest's shape: per-case ok/FAIL + a RESULT line, non-zero on any fail.
function configSetSelftest() {
  let fail = 0;
  const check = (label, cond) => {
    if (!cond) fail++;
    console.log(`${cond ? "ok  " : "FAIL"} ${label}`);
  };

  // create-fresh, two-level nested: backends.cx.provider then backends.cx.model land as one map.
  {
    let text = mergeConfigPath("", ["backends", "cx", "provider"], "codex", false).text;
    // mergeConfigPath on an empty string is only exercised via the ancestor-loop root-append
    // path (windowStart===0, windowEnd===0, expectedIndent===0); assert the produced shape.
    check("nested-create: backends header emitted", text.includes("backends:"));
    check("nested-create: cx header emitted", text.includes("  cx:"));
    check("nested-create: provider leaf round-trips", dig(parseYamlSubset(text), "backends.cx.provider") === "codex");
    const r2 = mergeConfigPath(text, ["backends", "cx", "model"], "o4-mini", false);
    check("nested-create: second key nests under same map", r2.changed === true);
    check("nested-create: both leaves present, unflattened",
      dig(parseYamlSubset(r2.text), "backends.cx.provider") === "codex" &&
      dig(parseYamlSubset(r2.text), "backends.cx.model") === "o4-mini");
  }

  // top-level scalar leaf into an existing file, other blocks + comments untouched.
  {
    const orig = "slots:\n  spec: gstack:autoplan  # custom\nappetite: full\n";
    const { text, changed } = mergeConfigPath(orig, ["dispatch", "build", "model"], "sonnet", false);
    check("top-level-leaf: changed", changed === true);
    check("top-level-leaf: slots block byte-intact", text.includes("slots:\n  spec: gstack:autoplan  # custom"));
    check("top-level-leaf: appetite intact", text.includes("appetite: full"));
    check("top-level-leaf: new key round-trips", dig(parseYamlSubset(text), "dispatch.build.model") === "sonnet");
  }

  // idempotent set: identical value, changed=false, no conflict.
  {
    const orig = "appetite: high\n";
    const { changed, conflict } = mergeConfigPath(orig, ["appetite"], "high", false);
    check("idempotent: no change", changed === false && conflict === null);
  }

  // conflict without --force refuses; --force overwrites in place, sibling untouched.
  {
    const orig = "appetite: high\nlogging: full\n";
    const r1 = mergeConfigPath(orig, ["appetite"], "low", false);
    check("conflict-refused: reported, not written", r1.changed === false && r1.conflict && r1.conflict.existing === "high" && r1.conflict.desired === "low");
    const r2 = mergeConfigPath(orig, ["appetite"], "low", true);
    check("conflict-forced: overwrote", r2.changed === true && dig(parseYamlSubset(r2.text), "appetite") === "low");
    check("conflict-forced: sibling untouched", r2.text.includes("logging: full"));
  }

  // FAFF-531 generalised: a new key inside an existing 4-space-indented map lands at that
  // map's own child indent, not a hardcoded 2.
  {
    const orig = "backends:\n    cx:\n        provider: codex\n";
    const { text, changed } = mergeConfigPath(orig, ["backends", "cx", "model"], "o4-mini", false);
    check("4-space-nested-insert: changed", changed === true);
    check("4-space-nested-insert: lands at sibling indent (8)", text.split("\n").some((l) => l === "        model: o4-mini"));
    check("4-space-nested-insert: round-trips", dig(parseYamlSubset(text), "backends.cx.model") === "o4-mini");
  }

  // scalar-where-map-expected refuses with a typeError, file unchanged.
  {
    const orig = "backends: nope\n";
    const r = mergeConfigPath(orig, ["backends", "cx", "provider"], "codex", false);
    check("scalar-blocks-descent: typeError, unchanged", r.typeError !== null && r.text === orig);
  }

  // Carve-out representation 1: block-sequence — refused, file byte-unchanged.
  {
    const orig = "adversarial:\n  refs:\n    - nvidia-glm\n    - studio-ollama\n";
    const r = mergeConfigPath(orig, ["adversarial", "refs"], "foo", true);
    check("carve-out/block-sequence: value-shape belt refuses", r.typeError !== null && r.text === orig);
  }

  // Carve-out representation 2: inline-flow `[a, b]` with BARE (unquoted) items — the
  // documented form. scalar()'s JSON.parse fails on bareword items ("a" is not valid JSON),
  // so it falls through to a plain STRING, not an Array — the value-shape belt does NOT
  // catch this any more than it catches the JSON-string form. Only the key-identity denylist
  // (cmdConfigSet step 2b, asserted below) closes it — same corruption risk class as
  // representation 3.
  {
    const orig = "adversarial:\n  refs: [nvidia-glm, studio-ollama]\n";
    const r = mergeConfigPath(orig, ["adversarial", "refs"], "foo", true);
    check("carve-out/inline-flow-bare: mergeConfigPath alone would NOT catch this (documents the risk)",
      r.typeError === null && r.changed === true);
    check("carve-out/inline-flow-bare: is denylisted by key identity", SEQUENCE_VALUED_KEYS.has("adversarial.refs"));
  }
  // A QUOTED inline-flow (`["a", "b"]`) IS valid JSON, so scalar() does return an Array here —
  // the value-shape belt catches this representation even without the denylist. Documents the
  // one shape the belt alone protects.
  {
    const orig = 'adversarial:\n  refs: ["nvidia-glm", "studio-ollama"]\n';
    const r = mergeConfigPath(orig, ["adversarial", "refs"], "foo", true);
    check("carve-out/inline-flow-quoted: value-shape belt refuses", r.typeError !== null && r.text === orig);
  }

  // Carve-out representation 3: the DOCUMENTED DEFAULT JSON-string scalar form — this is the
  // one the value-shape belt CANNOT catch (scalar() returns a plain string for a quoted value,
  // no JSON parse). Only the key-identity denylist (cmdConfigSet step 2b, exercised via
  // SEQUENCE_VALUED_KEYS membership here) closes it — asserted at the set() level below.
  {
    const orig = 'adversarial:\n  fallbacks: \'[{"provider":"ollama","model":"qwen3-next:80b"}]\'\n';
    const r = mergeConfigPath(orig, ["adversarial", "fallbacks"], "foo", true);
    check("carve-out/json-string: mergeConfigPath alone would NOT catch this (documents the risk)",
      r.typeError === null && r.changed === true);
    check("carve-out/json-string: is denylisted by key identity", SEQUENCE_VALUED_KEYS.has("adversarial.fallbacks"));
  }

  // FAFF-870: per-consumer refs (`adversarial.<consumer>.refs`) are the same
  // list-valued shape, but open-ended in the consumer name, so the regex predicate
  // (not the exact set) is what refuses them. Pin the predicate to the schema:
  // it refuses every per-consumer refs key, and refuses nothing it must not.
  {
    check("per-consumer/refs: adversarial.spec_review.refs is sequence-valued (refused)", isSequenceValuedKey("adversarial.spec_review.refs"));
    check("per-consumer/refs: adversarial.code_review.refs is sequence-valued (refused)", isSequenceValuedKey("adversarial.code_review.refs"));
    check("per-consumer/refs: adversarial.prdr_review.refs is sequence-valued (refused)", isSequenceValuedKey("adversarial.prdr_review.refs"));
    check("per-consumer/refs: a future consumer name is refused too (open-ended seam)", isSequenceValuedKey("adversarial.some_future_consumer.refs"));
    check("per-consumer/refs: the shared adversarial.refs is still refused (exact set)", isSequenceValuedKey("adversarial.refs"));
    check("per-consumer/timeout: adversarial.spec_review.timeout is a writable SCALAR (not refused)", !isSequenceValuedKey("adversarial.spec_review.timeout"));
    check("per-consumer/refs: the predicate does not over-match adversarial.timeout", !isSequenceValuedKey("adversarial.timeout"));
    check("per-consumer/refs: the predicate does not match a deeper nested refs leaf", !isSequenceValuedKey("adversarial.spec_review.sub.refs"));
  }

  // WRITABLE_NAMESPACES drift check: every top-level key documented in the example template
  // must be a member (or the guard silently refuses a legitimate future key).
  {
    try {
      const examplePath = path.join(__dirname, "..", "..", "..", "..", "..", CANONICAL_EXAMPLE_CONFIG);
      const exampleText = fs.readFileSync(examplePath, "utf8");
      const topKeys = Object.keys(parseYamlSubset(exampleText));
      const missing = topKeys.filter((k) => !WRITABLE_NAMESPACES.has(k));
      check(`namespace-drift: ${CANONICAL_EXAMPLE_CONFIG} top-level keys ⊆ WRITABLE_NAMESPACES (missing: ${missing.join(", ") || "none"})`, missing.length === 0);
    } catch (e) {
      check(`namespace-drift: could not read ${CANONICAL_EXAMPLE_CONFIG} (${e.message})`, false);
    }
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (config set, ${fail} failed)`);
  return fail ? 1 : 0;
}

// In-memory self-test for cmdConfigInit's pure helpers + the round-trip contract.
// Mirrors `next --selftest`: per-case ok/FAIL + a RESULT line, non-zero on any fail.
function configInitSelftest() {
  let fail = 0;
  const check = (label, cond) => {
    if (!cond) fail++;
    console.log(`${cond ? "ok  " : "FAIL"} ${label}`);
  };
  const reads = (text, leaf) => dig(parseYamlSubset(text), "tracking." + leaf);

  // create-fresh: header + canonical-order block, round-trips.
  {
    const text = INIT_HEADER + emitTrackingBlock({ team_key: "FAFF", tracker: "linear" });
    check("create-fresh: canonical order (tracker before team_key)",
      text.indexOf("tracker:") < text.indexOf("team_key:"));
    check("create-fresh: has header", text.startsWith(INIT_HEADER));
    check("create-fresh: round-trips team_key", reads(text, "team_key") === "FAFF");
    check("create-fresh: round-trips tracker", reads(text, "tracker") === "linear");
  }

  // merge-add-key into an existing tracking block, other keys + inline comments intact.
  {
    const orig = "tracking:\n  tracker: linear  # the tracker\n";
    const { text, changed, conflicts } = mergeTrackingBlock(orig, { team_key: "FAFF" }, false);
    check("merge-add-key: changed", changed === true && conflicts.length === 0);
    check("merge-add-key: existing key + inline comment intact", text.includes("tracker: linear  # the tracker"));
    check("merge-add-key: new key inserted", reads(text, "team_key") === "FAFF");
    check("merge-add-key: original tracker reads back", reads(text, "tracker") === "linear");
  }

  // comment / other-block preservation: non-tracking bytes untouched.
  {
    const orig = "# my config\nslots:\n  spec: gstack:autoplan  # custom\nappetite: full\n\ntracking:\n  repo: a/b\n";
    const { text } = mergeTrackingBlock(orig, { team_key: "FAFF" }, false);
    check("preserve: slots block byte-intact", text.includes("slots:\n  spec: gstack:autoplan  # custom"));
    check("preserve: appetite intact", text.includes("appetite: full"));
    check("preserve: leading comment intact", text.startsWith("# my config\n"));
    check("preserve: new tracking key present", reads(text, "team_key") === "FAFF");
    check("preserve: existing tracking key present", reads(text, "repo") === "a/b");
  }

  // append-block to a file that has none.
  {
    const orig = "slots:\n  spec: x\n";
    const { text, changed } = mergeTrackingBlock(orig, { repo: "a/b" }, false);
    check("append-block: changed", changed === true);
    check("append-block: slots intact", text.includes("slots:\n  spec: x"));
    check("append-block: tracking appended", reads(text, "repo") === "a/b");
  }

  // idempotent no-op: identical value, changed=false, no conflict.
  {
    const orig = "tracking:\n  team_key: FAFF\n";
    const { changed, conflicts } = mergeTrackingBlock(orig, { team_key: "FAFF" }, false);
    check("idempotent: no change", changed === false && conflicts.length === 0);
  }

  // conflict-refused-without-force.
  {
    const orig = "tracking:\n  team_key: FAFF\n";
    const { changed, conflicts } = mergeTrackingBlock(orig, { team_key: "OTHER" }, false);
    check("conflict-refused: reported, not written",
      changed === false && conflicts.length === 1 && conflicts[0].existing === "FAFF" && conflicts[0].desired === "OTHER");
  }

  // conflict-overwritten-with-force: only that line changes.
  {
    const orig = "tracking:\n  team_key: FAFF\n  repo: a/b\n";
    const { text, changed, conflicts } = mergeTrackingBlock(orig, { team_key: "OTHER" }, true);
    check("conflict-forced: overwrote", changed === true && conflicts.length === 0 && reads(text, "team_key") === "OTHER");
    check("conflict-forced: other line untouched", reads(text, "repo") === "a/b");
  }

  // quoted/bare emit round-trip (truth table from the spec).
  {
    const cases = [
      ["linear", "linear"], ["FAFF", "FAFF"], ["shftwst/faff", "shftwst/faff"],
      ["docs/specs/", "docs/specs/"], ["true", '"true"'], ["123", '"123"'],
      ["~", '"~"'], ["", '""'], ["a #b", '"a #b"'], ["[x]", '"[x]"'],
      [" lead", '" lead"'], ["trail ", '"trail "'], ["1.5", '"1.5"'], ["false", '"false"'],
    ];
    let ok = true, badEmit = "";
    for (const [input, expectEmit] of cases) {
      const emitted = emitScalar(input);
      if (emitted !== expectEmit) { ok = false; badEmit = `${JSON.stringify(input)}→${JSON.stringify(emitted)} (want ${JSON.stringify(expectEmit)})`; break; }
      // and it must round-trip back to the original string.
      if (scalar(emitted) !== input) { ok = false; badEmit = `${JSON.stringify(input)} does not round-trip`; break; }
    }
    check("emit: quoting truth table + round-trip" + (ok ? "" : " — " + badEmit), ok);
  }

  // unknown-key rejection is enforced in cmdConfigInit (arg parse) — assert the allowlist shape here.
  check("allowlist: known key normalises", TRACKING_KEYS.includes("tracking.team_key"));
  check("allowlist: ADR docs path is writable", TRACKING_KEYS.includes("tracking.adr_docs_path"));
  check("allowlist: spike docs path is writable", TRACKING_KEYS.includes("tracking.spike_docs_path"));
  check("allowlist: templates path is writable", TRACKING_KEYS.includes("tracking.templates_path"));
  check("allowlist: unknown key absent", !TRACKING_KEYS.includes("tracking.slug"));

  // FAFF-754: ADR and spike stores share the configurable docs-path contract while
  // retaining the established docs/* defaults for repositories that do not opt in.
  check("docs paths: ADR resolver keeps the legacy default",
    typeof resolveAdrDocsPath === "function" && resolveAdrDocsPath("/tmp/no-doc-tree", {}, false) === "docs/adr");
  check("docs paths: ADR resolver honours tracking.adr_docs_path",
    typeof resolveAdrDocsPath === "function" && resolveAdrDocsPath("/tmp/no-doc-tree", { tracking: { adr_docs_path: "records/adr/" } }, false) === "records/adr");
  check("docs paths: spike resolver keeps the legacy default",
    typeof resolveSpikeDocsPath === "function" && resolveSpikeDocsPath("/tmp/no-doc-tree", {}, false) === "docs/spikes");
  check("docs paths: spike resolver honours tracking.spike_docs_path",
    typeof resolveSpikeDocsPath === "function" && resolveSpikeDocsPath("/tmp/no-doc-tree", { tracking: { spike_docs_path: "records/spikes/" } }, false) === "records/spikes");

  // FAFF-1300: templates-path resolution ladder and the once-per-process deprecation notice.
  {
    const mk = (...dirs) => {
      const r = fs.mkdtempSync(path.join(require("os").tmpdir(), "faff-tpl-"));
      for (const d of dirs) fs.mkdirSync(path.join(r, d), { recursive: true });
      return r;
    };
    const captured = (fn) => {
      const lines = [];
      const orig = process.stderr.write;
      process.stderr.write = (chunk) => { lines.push(String(chunk)); return true; };
      try { fn(); } finally { process.stderr.write = orig; }
      return lines;
    };
    const resolveQuiet = (r, data = {}) => { let rel; const err = captured(() => { resetTemplatesDeprecationNotice(); rel = resolveTemplatesPath(r, data, false); }); return [rel, err]; };
    const absent = mk(), canon = mk(".faff/templates"), depr = mk(".faff-templates"), both = mk(".faff/templates", ".faff-templates");
    const [relAbsent, errAbsent] = resolveQuiet(absent);
    check("templates path: neither present resolves canonical, silent, creates nothing",
      relAbsent === ".faff/templates" && errAbsent.length === 0 && !fs.existsSync(path.join(absent, ".faff")));
    const [relCanon, errCanon] = resolveQuiet(canon);
    check("templates path: canonical only is silent", relCanon === ".faff/templates" && errCanon.length === 0);
    const [relDepr, errDepr] = resolveQuiet(depr);
    check("templates path: deprecated only falls back with the directory-level remedy",
      relDepr === ".faff-templates" && errDepr.length === 1 && errDepr[0].includes("git mv .faff-templates .faff/templates"));
    const [relBoth, errBoth] = resolveQuiet(both);
    check("templates path: both present resolves canonical with the file-level remedy",
      relBoth === ".faff/templates" && errBoth.length === 1 && errBoth[0].includes("deprecated and are now ignored") && !errBoth[0].includes("git mv .faff-templates .faff/templates"));
    const [relCfg, errCfg] = resolveQuiet(depr, { tracking: { templates_path: "records/tpl/" } });
    check("templates path: configured value wins, trailing slash stripped, silent", relCfg === "records/tpl" && errCfg.length === 0);
    resetTemplatesDeprecationNotice();
    const twice = captured(() => { resolveTemplatesPath(depr, {}, false); resolveTemplatesPath(depr, {}, false); });
    check("templates path: notice latches to once per process", twice.length === 1);
    resetTemplatesDeprecationNotice();
    const afterReset = captured(() => {
      resolveTemplatesPath(depr, {}, false); resetTemplatesDeprecationNotice(); resolveTemplatesPath(depr, {}, false);
    });
    check("templates path: reset re-arms the notice", afterReset.length === 2);
    const created = mk();
    resolveTemplatesPath(created, {}, true);
    check("templates path: --create makes the canonical directory only",
      fs.existsSync(path.join(created, ".faff/templates")) && !fs.existsSync(path.join(created, ".faff-templates")));
    for (const r of [absent, canon, depr, both, created]) fs.rmSync(r, { recursive: true, force: true });
    resetTemplatesDeprecationNotice();
  }

  // FAFF-1048: the superseded-ADR docs-path key + the resolveDocsPath fallbackRel branch.
  check("allowlist: superseded-ADR docs path is writable", TRACKING_KEYS.includes("tracking.adr_superseded_docs_path"));
  check("docs paths: superseded resolver is exported", typeof resolveAdrSupersededDocsPath === "function");
  // unset => the RESOLVED active ADR dir (never a literal docs/adr) — the no-regression contract.
  check("docs paths: superseded unset => resolved default ADR dir",
    resolveAdrSupersededDocsPath("/tmp/no-doc-tree", {}, false) === "docs/adr");
  check("docs paths: superseded unset => resolved CUSTOM ADR dir",
    resolveAdrSupersededDocsPath("/tmp/no-doc-tree", { tracking: { adr_docs_path: "records/adr/" } }, false) === "records/adr");
  check("docs paths: superseded set => trimmed value",
    resolveAdrSupersededDocsPath("/tmp/no-doc-tree", { tracking: { adr_superseded_docs_path: "records/adr/retired/" } }, false) === "records/adr/retired");
  // the fallbackRel branch must beat the docs/-then-doc/ ladder even when docs/ exists on disk:
  // a real repo root with a docs/ dir present, adr_docs_path customised, superseded key unset,
  // must still resolve to the ADR dir — the wrong-ladder failure mode this key's default guards.
  {
    const os = require("os");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-1048-"));
    try {
      fs.mkdirSync(path.join(tmp, "docs"), { recursive: true });
      const data = { tracking: { adr_docs_path: "records/adr/" } };
      check("docs paths: superseded default beats docs/ ladder (unset key, docs/ present)",
        resolveAdrSupersededDocsPath(tmp, data, false) === "records/adr");
      // the five pre-FAFF-1048 bindings pass no fallbackRel, so the ladder still fires for them.
      check("docs paths: ADR resolver still uses docs/ ladder (no fallbackRel)",
        resolveAdrDocsPath(tmp, {}, false) === "docs/adr");
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  // empty tracking block (key with null body): inserts children.
  {
    const orig = "tracking:\nslots:\n  spec: x\n";
    const { text, changed } = mergeTrackingBlock(orig, { repo: "a/b" }, false);
    check("empty-block: inserts child", changed === true && reads(text, "repo") === "a/b");
    check("empty-block: slots untouched", text.includes("slots:\n  spec: x"));
  }

  // FAFF-531: insert into a 4-space-indented tracking block (like this repo's own
  // .faffrc.yaml). The inserted key must land at the block's own indent (4), not a
  // hardcoded 2, or parseYamlSubset reads it as outside the block → null → the
  // round-trip guard aborts. The `/` in the repro value is coincidental — a
  // non-slash key reproduces the same failure, so both are asserted.
  {
    const orig = "tracking:\n    spec_docs_path: docs/specs/ # where graft commits\n";
    const { text, changed, conflicts } = mergeTrackingBlock(orig, { repo: "shftwst/faff" }, false);
    check("4-space-insert: changed, no conflict", changed === true && conflicts.length === 0);
    check("4-space-insert: slash value round-trips", reads(text, "repo") === "shftwst/faff");
    check("4-space-insert: sibling key + inline comment byte-intact",
      text.includes("    spec_docs_path: docs/specs/ # where graft commits"));
    check("4-space-insert: sibling reads back", reads(text, "spec_docs_path") === "docs/specs/");
    check("4-space-insert: inserted line at 4-space indent",
      text.split("\n").some((l) => l === "    repo: shftwst/faff"));
  }
  {
    // non-slash new key into a 4-space block — proves the fix is indent-general,
    // not slash-specific (a bare `team_key=FAFF` also returned null pre-fix).
    const orig = "tracking:\n    spec_docs_path: docs/specs/\n";
    const { text } = mergeTrackingBlock(orig, { team_key: "FAFF" }, false);
    check("4-space-insert: non-slash key round-trips", reads(text, "team_key") === "FAFF");
    check("4-space-insert: non-slash sibling intact", reads(text, "spec_docs_path") === "docs/specs/");
  }
  {
    // regression guard: inserting into a 2-space block is byte-identical to pre-fix
    // (blockIndent samples 2), so no existing merge selftest output shifts.
    const orig = "tracking:\n  tracker: linear\n";
    const { text } = mergeTrackingBlock(orig, { team_key: "FAFF" }, false);
    check("2-space-insert: byte-identical to pre-fix (2-space pad)",
      text === "tracking:\n  tracker: linear\n  team_key: FAFF\n");
  }

  // FAFF-262: block-sequence parsing (arrays of maps + arrays of scalars).
  {
    const text = "adversarial:\n  backends:\n    - provider: nvidia\n      model: nemotron\n    - provider: ollama\n      model: qwen3\n";
    const arr = dig(parseYamlSubset(text), "adversarial.backends");
    check("seq: array of maps is an Array of length 2", Array.isArray(arr) && arr.length === 2);
    check("seq: map item 1 multi-key intact", arr && arr[0] && arr[0].provider === "nvidia" && arr[0].model === "nemotron");
    check("seq: map item 2 multi-key intact", arr && arr[1] && arr[1].provider === "ollama" && arr[1].model === "qwen3");
  }
  {
    const arr = dig(parseYamlSubset("hosts:\n  - alpha\n  - beta\n"), "hosts");
    check("seq: array of scalars", Array.isArray(arr) && arr.length === 2 && arr[0] === "alpha" && arr[1] === "beta");
  }
  {
    // scalar coercion of sequence items (numbers/booleans via scalar()).
    const arr = dig(parseYamlSubset("nums:\n  - 1\n  - 2\n  - true\n"), "nums");
    check("seq: scalar coercion of items", Array.isArray(arr) && arr[0] === 1 && arr[1] === 2 && arr[2] === true);
  }
  {
    // nested map inside a sequence item.
    const arr = dig(parseYamlSubset("items:\n  - name: a\n    opts:\n      x: 1\n"), "items");
    check("seq: nested map inside item", Array.isArray(arr) && arr[0].name === "a" && arr[0].opts && arr[0].opts.x === 1);
  }
  {
    // regression guard: scalars + nested maps + block scalar + JSON-string scalar parse unchanged.
    const text = "tracking:\n  team_key: SHF\n  spec_docs_path: docs/specs/\nnote: |\n  line one\n  line two\nfallbacks: '[{\"provider\":\"x\"}]'\n";
    const d = parseYamlSubset(text);
    check("seq regression: scalar unchanged", dig(d, "tracking.team_key") === "SHF");
    check("seq regression: nested map unchanged", dig(d, "tracking.spec_docs_path") === "docs/specs/");
    check("seq regression: block scalar unchanged", dig(d, "note") === "line one\nline two\n");
    check("seq regression: JSON-string scalar stays a string", dig(d, "fallbacks") === '[{"provider":"x"}]');
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${fail} failed)`);
  return fail ? 1 : 0;
}


module.exports = { configInitSelftest, configSetSelftest, configUnsetSelftest };
