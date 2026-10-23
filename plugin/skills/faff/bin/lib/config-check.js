// ===========================================================================
// === region:factory — config-check — `faff config check`: posture, integrity and secret scan, and its selftest ===
// ===========================================================================
// FAFF-1389: split out of config.js, which re-exports every name below that it exported before.

const fs = require("node:fs");
const path = require("node:path");
const { backendsConfigCheckFindings } = require("./backends");
const { gitignoreDirHazardLines, gitignoreMentionsFaffDir } = require("./gitignore-ensure");
const { CANONICAL_CONFIG, CANONICAL_OVERLAY_CONFIG, DEPRECATED_CONFIG, DEPRECATED_OVERLAY_CONFIG, deepMergeConfig, dig, findConfigLocation, findOverlayLocation, isInsideRoot, isPlainConfigMap, parseConfigMapStrict, parseOverlayStrict } = require("./shared-infra");
const { configFileLabel, fmt, gitInRepo, gitIsIgnored, gitIsTracked } = require("./config-core");
const { REMOVED_TREES, legacyTreeError } = require("./config-dispatch");
const { validateGitHostValue, validateTeams } = require("./config-resolve");
const { RECOGNISED_NAMESPACES, WRITABLE_NAMESPACES, locationNoticeText } = require("./config-write");

// ---------------------------------------------------------------------------
// FAFF-387 — `faff config check`: deterministic posture + integrity checker.
// Read-only, NO tracker/network/writes. Exit 0 clean / 1 >=1 finding / 2 unreadable.
// Part of the factory `config` surface; its own module since FAFF-1389.
// ---------------------------------------------------------------------------

// Secret-scan table (spec Appendix A). Two complementary detectors, tuned for
// near-zero false positives on real config (hosts, model ids, paths all carry the
// `. : /` separators the generic detector excludes; `*_env` keys are exempt by
// design). The table is DATA — one row per pattern — so extending it is a one-line
// change plus a selftest row. `known` matches the VALUE anywhere; `generic` gates on
// the KEY name AND a high-entropy value shape.
const SECRET_KNOWN_PREFIXES = [
  "sk-", "ghp_", "gho_", "ghu_", "ghs_", "github_pat_", "AKIA",
  "nvapi-", "AIza", "-----BEGIN ",
];
// xox[baps]- (Slack) is a shape, not a bare prefix — kept as an explicit regex.
const SECRET_KNOWN_REGEXES = [/xox[baps]-/];
const SECRET_KEYNAME_RE = /key|token|secret|password|credential/i;
const SECRET_GENERIC_VALUE_RE = /^[A-Za-z0-9+/=_-]{32,}$/;

// PURE: does this (keyName, value) look like a leaked credential? Returns a reason
// string ("known-prefix" | "generic-high-entropy") or null. Never returns the value.
function secretScanLeaf(keyName, value) {
  if (typeof value !== "string" || value === "") return null;
  for (const pfx of SECRET_KNOWN_PREFIXES) if (value.startsWith(pfx)) return "known-prefix";
  for (const re of SECRET_KNOWN_REGEXES) if (re.test(value)) return "known-prefix";
  // Generic: key-name-gated, `*_env` exempt (the name-indirection pattern), and the
  // value must be a long separator-free high-entropy blob (excludes hosts/ids/paths).
  if (SECRET_KEYNAME_RE.test(keyName) && !/_env$/.test(keyName) && SECRET_GENERIC_VALUE_RE.test(value)) {
    return "generic-high-entropy";
  }
  return null;
}

// Redact a suspected secret to key-path + length + first-4-chars ONLY — NEVER the
// value. The raw value must never reach any output stream (spec: a checker that
// prints the secret recreates the leak it guards against).
function redactSecret(keyPath, value) {
  const v = String(value);
  return `${keyPath} (len=${v.length}, starts "${v.slice(0, 4)}")`;
}

// PURE: walk a parsed config document, applying secretScanLeaf to every scalar
// (string) leaf. Recurses maps and sequences; keys the finding by dotted path (and
// [i] for sequence items). `fileLabel` prefixes the finding surface so a base vs
// overlay hit is distinguishable. Returns [{severity,surface,message}].
function scanDocForSecrets(doc, fileLabel) {
  const findings = [];
  const walk = (node, keyPath, leafName) => {
    if (typeof node === "string") {
      const reason = secretScanLeaf(leafName, node);
      if (reason) findings.push({ severity: "warn", surface: `${fileLabel}:${keyPath}`, message: `possible secret (${reason}) — ${redactSecret(keyPath, node)}. Move it to an env var (\`*_env\` names the var; the value never lives in config).` });
      return;
    }
    if (Array.isArray(node)) { node.forEach((item, i) => walk(item, `${keyPath}[${i}]`, leafName)); return; }
    if (isPlainConfigMap(node)) { for (const k of Object.keys(node)) walk(node[k], keyPath ? `${keyPath}.${k}` : k, k); }
  };
  walk(doc, "", "");
  return findings;
}

const MIGRATION_STEPS = [
  `1. Move machine-local values (private hosts, personal model prefs) into ${CANONICAL_OVERLAY_CONFIG}`,
  `2. Ensure .faff/.gitignore ignores the overlay and carries \`!/config.yaml\` (\`faff gitignore-ensure\` writes both)`,
  `3. Run \`faff config check\`, then commit ${CANONICAL_CONFIG}`,
];

// FAFF-1302: both tiers present for one role. The preferred file wins; the stale one is
// reported with the remedy for its tracking state (the base is tracked, the overlay is not).
function duplicateLocationMessage(role, canonicalName, staleName) {
  const overlay = role === "overlay";
  // FAFF-1302: the stale file is named "not read" rather than "ignored". Its git state is not
  // probed here, and a stale base in a repo that never carried the old root ignore lines is
  // tracked, not ignored: calling it ignored while prescribing `git rm`, which only acts on a
  // tracked file, contradicts itself. What matters is that it is not read, which is always true.
  return `two ${overlay ? "overlay" : "base"} configs present: ${canonicalName} (in use) and ${staleName} (not read). Values come only from ${canonicalName}. Remove the stale file: ${overlay ? "rm" : "git rm"} ${staleName}`;
}

const indentSteps = (steps) => steps.map((st) => "     " + st).join("\n");

// FAFF-1301: the never-committed canonical run directory, asked about through `git check-ignore`
// so the check never models ignore precedence (or `.git/info/exclude`) itself.
const FAFF_RUN_STATE_PROBE_PATH = ".faff/runs";

// Distinct lines in file order, as one plural-aware slot: (line: `a`) or (lines: `a`, `b`).
function dirHazardSlot(hazardLines) {
  const quoted = [...new Set(hazardLines)].map((l) => `\`${l}\``);
  return `${quoted.length === 1 ? "line" : "lines"}: ${quoted.join(", ")}`;
}

function dirHazardMessage(hazardLines) {
  const steps = [
    `1. Change the \`${hazardLines[0]}\` line to \`.faff/*\` in .gitignore`,
    "2. Keep any `!.faff/...` carve-out lines AFTER it (git honours a negation only after the matching ignore)",
    "3. Run `git status`; the committed parts of .faff/ should now appear",
    "4. Run `faff config check` to confirm the finding is gone",
  ];
  return `\`.gitignore\` ignores the \`.faff\` DIRECTORY (${dirHazardSlot(hazardLines)}). Git never descends into it, so every committed part of \`.faff/\` is silently skipped: the per-PR chain anchors today, and the templates and config later. Any \`!.faff/...\` carve-out below this line is dead, and a \`.gitignore\` inside \`.faff/\` is never even read. \`faff gitignore-ensure\` is append-only and cannot fix this. Hand-edit:\n${indentSteps(steps)}`;
}

const UNDERIGNORE_NONE_MESSAGE = `nothing ignores faff's run state. \`.faff/\` exists but no ignore rule covers \`${FAFF_RUN_STATE_PROBE_PATH}\`, so git is offering every run artifact, log and scratch file for commit. \`.faff/.gitignore\` is absent. Fix:\n${indentSteps([
  "1. Run `faff gitignore-ensure`",
  "2. Commit the file (or the .gitignore line) it writes, so a fresh clone inherits the rule",
  "3. Run `faff config check` to confirm the finding is gone",
])}`;

const UNDERIGNORE_INEFFECTIVE_MESSAGE = `\`.faff/.gitignore\` exists but does not ignore faff's run state. \`${FAFF_RUN_STATE_PROBE_PATH}\` is not ignored by any rule, so git is offering every run artifact, log and scratch file for commit. The file may be empty, truncated, or missing the rule. Fix:\n${indentSteps([
  "1. Run `faff gitignore-ensure` to restore the rules it owns",
  "2. Commit the result",
  "3. Run `faff config check` to confirm the finding is gone",
])}`;

const UNDERIGNORE_UNTRACKED_MESSAGE = `\`.faff/.gitignore\` is the only thing ignoring faff's run state and it is NOT committed. This checkout is fine; a fresh clone gets no \`.faff\` ignore rule at all, and \`faff gitignore-ensure\` is first-run only so nothing re-adds it. Fix:\n${indentSteps([
  "1. git add .faff/.gitignore",
  `2. Commit it alongside ${CANONICAL_CONFIG}`,
])}`;

// PURE: finding 1. A property of the file's text, so it needs no git.
function dirHazardFinding(rootGitignore) {
  const hazardLines = gitignoreDirHazardLines(rootGitignore);
  if (hazardLines.length === 0) return null;
  return { severity: "warn", surface: ".gitignore", message: dirHazardMessage(hazardLines) };
}

// PURE: finding 2. faffDirPresent is tested before any probe is called, so callers that
// never set it never see a `.faff/...` path in their probes.
function dirUnderignoreFinding({ rootGitignore, faffDirPresent, faffDirGitignorePresent, probes }) {
  if (!faffDirPresent || !probes.inRepo) return null;
  const finding = (message) => ({ severity: "warn", surface: ".faff/.gitignore", message });
  if (!probes.isIgnored(FAFF_RUN_STATE_PROBE_PATH)) {
    return finding(faffDirGitignorePresent ? UNDERIGNORE_INEFFECTIVE_MESSAGE : UNDERIGNORE_NONE_MESSAGE);
  }
  if (!faffDirGitignorePresent) return null;
  if (gitignoreMentionsFaffDir(rootGitignore) && probes.isTracked(".gitignore")) return null;
  if (probes.isTracked(".faff/.gitignore")) return null;
  return finding(UNDERIGNORE_UNTRACKED_MESSAGE);
}

// PURE: known-key (schema) lint over a document's TOP-LEVEL key NAMES only — values are
// never inspected (value-shape validation is out of scope, FAFF-794 §2). Classifies each
// top-level key as flat-dotted (name contains ".", the unreachable-literal-key mistake
// `dig`'s split-on-"." can't reach), unknown (no "." but absent from `knownSet`), or known
// (silent). Mirrors scanDocForSecrets' per-file attribution — `fileLabel` prefixes the
// finding surface so a base vs overlay hit is distinguishable. Every finding is `severity:
// "warn"` (forward-compat: a not-yet-allowlisted key must never hard-fail `config check`).
function knownKeyLint(doc, fileLabel, knownSet) {
  const findings = [];
  if (!isPlainConfigMap(doc)) return findings;
  const known = [...knownSet].sort().join(", ");
  for (const topKey of Object.keys(doc)) {
    if (REMOVED_TREES.includes(topKey)) continue; // reported as a legacy-tree error by computeConfigCheck
    const dotIdx = topKey.indexOf(".");
    if (dotIdx !== -1) {
      const prefix = topKey.slice(0, dotIdx);
      if (knownSet.has(prefix)) {
        findings.push({ severity: "warn", surface: `${fileLabel}:${topKey}`, message: `\`${topKey}\` is a flat dotted key — you likely meant a nested map (the segments under \`${prefix}:\`). As written it is a single unreachable literal key and resolves to the default.` });
      } else {
        findings.push({ severity: "warn", surface: `${fileLabel}:${topKey}`, message: `\`${topKey}\` is a flat dotted key with unrecognised namespace \`${prefix}\` (probable typo and flat form); nest it under a known namespace. Resolves to the default as written.` });
      }
    } else if (!knownSet.has(topKey)) {
      findings.push({ severity: "warn", surface: `${fileLabel}:${topKey}`, message: `\`${topKey}\` is an unrecognised top-level key (probable typo); silently ignored, resolves to the default. Known namespaces: ${known}.` });
    }
  }
  return findings;
}

// PURE core of `config check` — takes the already-resolved inputs and returns
// { findings, skipped, exit }. Split from cmdConfigCheck's I/O so --selftest can
// drive the secret scan + posture logic in-memory without a real git repo.
// `probes` supplies { inRepo, isIgnored(rel), isTracked(rel) } (nullable inRepo).
// FAFF-1301: rootGitignore (text | null), faffDirPresent and faffDirGitignorePresent are
// optional filesystem facts; absent, the two .faff ignore-posture findings are no-ops.
function computeConfigCheck({ root, basePath, baseDoc, baseTier, staleBasePath, overlayPath, overlayDoc, overlayTier, staleOverlayPath, legacyBase, legacyOverlay, baseParseError, probes, rootGitignore, faffDirPresent, faffDirGitignorePresent }) {
  const findings = [];
  const skipped = [];
  const rel = (p) => configFileLabel(root, p);
  const baseLabel = rel(basePath);
  const overlayLabel = rel(overlayPath);
  const baseInside = Boolean(basePath) && isInsideRoot(root, basePath);
  const overlayInside = Boolean(overlayPath) && isInsideRoot(root, overlayPath);
  const probeIgnored = probes.inRepo ? probes.isIgnored : null;

  // Check 5: legacy filenames present (mirror the loud resolver error as a finding).
  for (const n of [...(legacyBase || []), ...(legacyOverlay || [])]) {
    findings.push({ severity: "error", surface: n, message: `legacy config filename \`${n}\` present — faff reads \`${CANONICAL_CONFIG}\` / \`${CANONICAL_OVERLAY_CONFIG}\` (the root \`${DEPRECATED_CONFIG[0]}\` and \`${DEPRECATED_OVERLAY_CONFIG[0]}\` names are still read, but deprecated); rename it.` });
  }

  // Check 1b (FAFF-577): a malformed base is an error-severity FINDING naming file +
  // parse detail — the diagnosis surface describes the fault it exists to catch,
  // exit 1, never an exit-2 abort.
  if (baseParseError) {
    const malformedLabel = rel(baseParseError.file) || baseLabel || CANONICAL_CONFIG;
    findings.push({ severity: "error", surface: malformedLabel, message: `malformed base config — ${baseParseError.detail}. Configured values (including budget/sentry ceilings) are NOT applied; fix the file (git diff / git checkout ${malformedLabel}).` });
  }

  // Check 2 + 3: posture (git). Skipped entirely outside a git repo. A file resolved from
  // outside this root (the main-worktree fallback) has no posture this checkout can report,
  // and git refuses a path outside the repository, so its probes are never run.
  if (probes.inRepo) {
    if (basePath && !baseInside) {
      skipped.push(`posture checks skipped for ${basePath} (resolved outside ${root}, another checkout's file)`);
    } else if (basePath) {
      if (probes.isIgnored(baseLabel) || !probes.isTracked(baseLabel)) {
        findings.push({ severity: "warn", surface: baseLabel, message: `\`${baseLabel}\` is unmigrated/uncommitted (git-ignored or untracked) — unrecoverable if corrupted. Migrate:\n${MIGRATION_STEPS.map((s) => "     " + s).join("\n")}` });
      }
    }
    if (overlayPath && !overlayInside) {
      skipped.push(`posture checks skipped for ${overlayPath} (resolved outside ${root}, another checkout's file)`);
    } else if (overlayPath) {
      if (!probes.isIgnored(overlayLabel)) {
        // FAFF-1302: the remedy is tier-dependent. A canonical overlay is ignored by the `/*`
        // that `gitignore-ensure` writes into `.faff/.gitignore`. A deprecated one sits at the
        // repo root, where the pattern set is now empty, so no faff write can ever ignore it:
        // the only fix is the move, and naming `gitignore-ensure` there would be a dead remedy.
        const remedy = overlayTier === "deprecated"
          ? `Move it with \`mv ${overlayLabel} ${CANONICAL_OVERLAY_CONFIG}\`; faff writes no root ignore lines, so \`faff gitignore-ensure\` cannot ignore it where it is.`
          : `Run \`faff gitignore-ensure\` so ${CANONICAL_OVERLAY_CONFIG} is ignored.`;
        findings.push({ severity: "warn", surface: overlayLabel, message: `\`${overlayLabel}\` is NOT git-ignored — the machine-local overlay is about to be committed. ${remedy}` });
      }
    }
  } else {
    skipped.push("posture checks skipped (not a git repo)");
  }

  // Check 13 (FAFF-1302): location. A file on the deprecated tier is fully valid; the finding
  // carries the migration command. Both tiers present: the preferred file wins and the stale
  // one is reported. Always warn, never error: the config resolves correctly either way.
  if (baseInside && baseTier === "deprecated") {
    findings.push({ severity: "warn", surface: baseLabel, message: locationNoticeText(baseLabel, "base", probeIgnored) });
  }
  if (overlayInside && overlayTier === "deprecated") {
    findings.push({ severity: "warn", surface: overlayLabel, message: locationNoticeText(overlayLabel, "overlay", probeIgnored) });
  }
  if (baseInside && baseTier === "canonical" && staleBasePath) {
    findings.push({ severity: "warn", surface: baseLabel, message: duplicateLocationMessage("base", baseLabel, rel(staleBasePath)) });
  }
  if (overlayInside && overlayTier === "canonical" && staleOverlayPath) {
    findings.push({ severity: "warn", surface: overlayLabel, message: duplicateLocationMessage("overlay", overlayLabel, rel(staleOverlayPath)) });
  }

  // Check 11 + 12 (FAFF-1301): .faff ignore posture. Over-ignore first, then under-ignore.
  const overIgnore = dirHazardFinding(rootGitignore);
  if (overIgnore) findings.push(overIgnore);
  const underIgnore = dirUnderignoreFinding({ rootGitignore, faffDirPresent, faffDirGitignorePresent, probes });
  if (underIgnore) findings.push(underIgnore);

  // Check 4: secret scan over both files' scalar leaves (redacted output).
  if (baseDoc) findings.push(...scanDocForSecrets(baseDoc, baseLabel || CANONICAL_CONFIG));
  if (overlayDoc) findings.push(...scanDocForSecrets(overlayDoc, overlayLabel || CANONICAL_OVERLAY_CONFIG));

  // Check 6 (FAFF-523): backends: namespace soundness — a name collision with
  // engines: (error) and the derived-egress residency guard (warn) over the
  // MERGED document (overlay wins scalars over base, same posture as every
  // other resolved value).
  const mergedDoc = overlayDoc ? deepMergeConfig(baseDoc || {}, overlayDoc) : (baseDoc || {});
  findings.push(...backendsConfigCheckFindings(mergedDoc));

  // Check 8 (FAFF-430): a present, non-github tracking.git_host is config theater — faff's
  // merge floor is unconditionally `gh`, so a hand-edited base carrying e.g. `git_host: gitlab`
  // would otherwise limp silently past this linter (config get / config set already fail loud
  // on the same value; this catches a base that never went through either). Unset is fine — the
  // finding fires only when the merged value is present and off-allowlist.
  const gitHostRaw = dig(mergedDoc, "tracking.git_host");
  // fmt() first — mirrors the cmdConfig read-time path (`validateGitHostValue(key, fmt(value))`)
  // so a non-string YAML scalar (e.g. `git_host: true`) produces the identical quoted message on
  // both surfaces, never a raw-value/fmt'd-value mismatch between `config check` and `config get`
  // (adversarial review finding, FAFF-430).
  const gitHost = gitHostRaw === null || gitHostRaw === undefined ? gitHostRaw : fmt(gitHostRaw);
  if (gitHost !== null && gitHost !== undefined && validateGitHostValue("tracking.git_host", gitHost)) {
    findings.push({ severity: "error", surface: "tracking.git_host", message: `git_host: "${gitHost}" is not supported — faff's merge floor is GitHub-only. Set git_host: github or leave it unset.` });
  }

  // Check 8b (FAFF-1080): tracking.teams / default_team / team_routing cross-field validation
  // over the same merged document — empty teams, an absent/dangling default_team, or a
  // team_routing value outside the team-set all fail loud here, naming the offending
  // key/value and the member set (never a silent dangling reference).
  findings.push(...validateTeams(mergedDoc));

  // Check 9 (FAFF-794): known-key (schema) lint — flags an unrecognised or flat-dotted
  // top-level key as a warn finding, so a typo (e.g. `autonymous.sentry_acting`, meant as
  // `autonomous: { sentry_acting: true }`) stops silently resolving to its fail-safe
  // default with no signal. Walks baseDoc and overlayDoc INDEPENDENTLY (never the merged
  // doc) — a mistake in either file is its own distinct silent no-op and must be attributed
  // to the file it lives in, exactly as the secret scan (Check 4) attributes per-file.
  if (baseDoc) findings.push(...knownKeyLint(baseDoc, baseLabel || CANONICAL_CONFIG, RECOGNISED_NAMESPACES));
  if (overlayDoc) findings.push(...knownKeyLint(overlayDoc, overlayLabel || CANONICAL_OVERLAY_CONFIG, RECOGNISED_NAMESPACES));

  // Check 10 (ADR-0134): a removed models:/effort: tree is an error finding per file, naming the
  // dispatch: replacements and the exact `faff config unset` command.
  for (const [doc, filePath, fallback, local] of [[baseDoc, basePath, CANONICAL_CONFIG, false], [overlayDoc, overlayPath, CANONICAL_OVERLAY_CONFIG, true]]) {
    const file = rel(filePath) || fallback;
    const message = legacyTreeError([{ file, local, doc }]);
    if (message) findings.push({ severity: "error", surface: file, message });
  }

  return { findings, skipped, exit: findings.length ? 1 : 0 };
}

// Any failure, a missing path included, yields the no-op value: the command that describes
// faults must not abort on one.
function readFaffIgnoreFacts(root) {
  const attempt = (read, fallback) => { try { return read(); } catch { return fallback; } };
  return {
    rootGitignore: attempt(() => fs.readFileSync(path.join(root, ".gitignore"), "utf8"), null),
    faffDirPresent: attempt(() => fs.statSync(path.join(root, ".faff")).isDirectory(), false),
    faffDirGitignorePresent: attempt(() => fs.statSync(path.join(root, ".faff", ".gitignore")).isFile(), false),
  };
}

// FAFF-1302: an existence test, not a second resolution. When the preferred file won inside
// this root, is a deprecated-tier file also sitting there that the resolver deliberately
// did not read? Returns its absolute path or null.
function staleLocationPath(root, location, deprecatedNames) {
  if (location === null || location.tier !== "canonical" || !isInsideRoot(root, location.path)) return null;
  const stale = deprecatedNames.map((n) => path.join(root, n)).find((p) => fs.existsSync(p));
  return stale === undefined ? null : stale;
}

function cmdConfigCheck(args, root) {
  if (args.includes("--selftest")) return configCheckSelftest();
  const json = args.includes("--json");

  // Check 1: parse. Resolve both files, reading each independently so a parse fault
  // in EITHER is a loud exit 2 (never a silent skip). Legacy names are collected as
  // findings, not thrown, so `config check` reports them rather than aborting.
  let basePath = null, baseDoc = null, overlayPath = null, overlayDoc = null;
  let baseLocation = null, overlayLocation = null;
  const legacyBase = [], legacyOverlay = [];
  try {
    baseLocation = findConfigLocation(root);
    basePath = baseLocation === null ? null : baseLocation.path;
  } catch (e) {
    if (e.message === "legacy-config-name") legacyBase.push(...e.legacy);
    else { process.stderr.write(`faff config check: ${e.message}\n`); return 2; }
  }
  try {
    overlayLocation = findOverlayLocation(root);
    overlayPath = overlayLocation === null ? null : overlayLocation.path;
  } catch (e) {
    if (e.message === "legacy-overlay-config-name") legacyOverlay.push(...e.legacy);
    else { process.stderr.write(`faff config check: ${e.message}\n`); return 2; }
  }
  // FAFF-577: the diagnosis surface must be able to DESCRIBE a malformed base —
  // detection-as-finding (error severity, exit 1), never an exit-2 abort on this
  // fault (or the one command that names the problem would refuse to run), and
  // never the old silent coerce to {}. parseConfigMapStrict is called directly
  // (not readBaseConfigStrict): check reports findings, it doesn't fire the
  // chokepoint warning or honour the hatch.
  let baseParseError = null;
  if (basePath) {
    try {
      baseDoc = parseConfigMapStrict(basePath, "base-parse-error", "the base config");
    } catch (e) {
      if (e && e.message === "base-parse-error") baseParseError = { file: e.file, detail: e.detail };
      else { process.stderr.write(`faff config check: ${basePath} unreadable (${e.code || e.message})\n`); return 2; }
    }
  }
  if (overlayPath) {
    try {
      overlayDoc = parseOverlayStrict(overlayPath);
    } catch (e) {
      process.stderr.write(`faff config check: ${e.file || overlayPath} failed to parse (${e.detail || e.message})\n`);
      return 2;
    }
  }

  const inRepo = gitInRepo(root);
  const { rootGitignore, faffDirPresent, faffDirGitignorePresent } = readFaffIgnoreFacts(root);
  const probes = {
    inRepo,
    isIgnored: (relPath) => gitIsIgnored(root, relPath),
    isTracked: (relPath) => gitIsTracked(root, relPath),
  };
  const { findings, skipped, exit } = computeConfigCheck({
    root,
    basePath, baseDoc, baseTier: baseLocation && baseLocation.tier, staleBasePath: staleLocationPath(root, baseLocation, DEPRECATED_CONFIG),
    overlayPath, overlayDoc, overlayTier: overlayLocation && overlayLocation.tier, staleOverlayPath: staleLocationPath(root, overlayLocation, DEPRECATED_OVERLAY_CONFIG),
    legacyBase, legacyOverlay, baseParseError, probes,
    rootGitignore, faffDirPresent, faffDirGitignorePresent,
  });

  if (json) {
    console.log(JSON.stringify({ ok: exit === 0, findings, skipped }, null, 2));
    return exit;
  }
  for (const s of skipped) console.log(`skip  ${s}`);
  for (const f of findings) console.log(`${f.severity === "error" ? "ERROR" : "warn "} ${f.surface}: ${f.message}`);
  if (exit === 0) {
    console.log(skipped.length ? "config check: no findings (some checks skipped)" : "config check: clean");
  }
  return exit;
}

// FAFF-965: the small, explicit allowlist of variable names observed to hold a resolved
// config document (loadConfig's return, or a merge of it) at a dig() call site — the scope
// the drift guard below trusts. `dig` is a general nested-map getter used on plenty of
// non-config objects too; an unscoped scan would flood the guard with false positives and
// make it untrustworthy, so the allowlist is the point, not an afterthought.
const CONFIG_DOC_IDENTS = ["cfg", "cfgData", "data", "mergedDoc", "d", "parsed"];

// (ident, namespace) pairs deliberately excluded from the drift guard below — a blessed
// identifier that, at some specific call, holds non-config data rather than a resolved config
// document. Explicit and commented so an exclusion is a reviewable one-line addition, never a
// silent regex tweak. None known today.
const RECOGNISED_NAMESPACES_DRIFT_EXCEPTIONS = new Set([
  // "ident:namespace", e.g. "d:someHelperLocal" — add here with a comment if the scan ever
  // false-positives on a blessed ident holding non-config data.
]);

// Regex-extract every `dig(IDENT, "NS.…")` occurrence from `text`, where IDENT is one of
// CONFIG_DOC_IDENTS and NS is the top-level segment before the first ".". Namespace reads with
// no "." (e.g. `dig(cfg, "appetite")`) are out of this guard's scope — the known-key lint's own
// key-name check already covers a bare top-level scalar; this guard is specifically for the
// "<ns>.<leaf>" nested-read shape that WRITABLE_NAMESPACES/RECOGNISED_NAMESPACES classify.
function scanConfigReadNamespaces(text) {
  const identAlt = CONFIG_DOC_IDENTS.map((i) => i.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(`\\bdig\\(\\s*(${identAlt})\\s*,\\s*[\`"']([A-Za-z_][\\w]*)\\.[^\`"']*[\`"']`, "g");
  const out = [];
  let m;
  while ((m = re.exec(text))) out.push({ ident: m[1], ns: m[2] });
  return out;
}

// Pure core of the drift guard: given `fileTexts` ([{ name, text }]), returns a Map of
// namespace -> Set(file name) for every dig(<blessed-ident>, "<ns>.…") read whose namespace is
// NOT in RECOGNISED_NAMESPACES (after applying RECOGNISED_NAMESPACES_DRIFT_EXCEPTIONS). Split
// from the real-source scan below so a unit test can inject synthetic source text without
// touching disk (mirrors computeConfigCheck's split from cmdConfigCheck's I/O).
function missingRecognisedNamespaces(fileTexts) {
  const missing = new Map();
  for (const { name, text } of fileTexts) {
    for (const { ident, ns } of scanConfigReadNamespaces(text)) {
      if (RECOGNISED_NAMESPACES_DRIFT_EXCEPTIONS.has(`${ident}:${ns}`)) continue;
      if (RECOGNISED_NAMESPACES.has(ns)) continue;
      if (!missing.has(ns)) missing.set(ns, new Set());
      missing.get(ns).add(name);
    }
  }
  return missing;
}

// The FAFF-965 --selftest case lives inside configCheckSelftest below (invoked via
// `faff config check --selftest`) — it asserts missingRecognisedNamespaces() against the CLI's
// own current source, plus a synthetic-injection regression case, alongside the guard's sibling
// known-key cases (the natural host per FAFF-965's spec).

// In-memory selftest of the secret-pattern table + the merge (deepMergeConfig)
// behaviour + the posture logic (via computeConfigCheck's pure core). Mirrors the
// other --selftest commands: per-case ok/FAIL + a RESULT line, non-zero on any fail.
function configCheckSelftest() {
  let fail = 0;
  const check = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "ok  " : "FAIL"} ${label}`); };

  // --- secret-pattern table -------------------------------------------------
  check("secret: sk- prefix flagged", secretScanLeaf("api_key", "sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD") === "known-prefix");
  check("secret: ghp_ prefix flagged", secretScanLeaf("anything", "ghp_0123456789abcdefghij") === "known-prefix");
  check("secret: AKIA prefix flagged", secretScanLeaf("aws", "AKIAIOSFODNN7EXAMPLE") === "known-prefix");
  check("secret: nvapi- prefix flagged", secretScanLeaf("k", "nvapi-xxxxxxxxxxxxxxxxxxxx") === "known-prefix");
  check("secret: AIza prefix flagged", secretScanLeaf("k", "AIzaSyBhydeSomethingLong") === "known-prefix");
  check("secret: xoxb- shape flagged", secretScanLeaf("k", "xoxb-123-456-abcdef") === "known-prefix");
  check("secret: PEM header flagged", secretScanLeaf("k", "-----BEGIN RSA PRIVATE KEY-----") === "known-prefix");
  check("secret: generic high-entropy on key-named field flagged",
    secretScanLeaf("api_token", "aB3dEf6hIj9lMn2pQr5tUv8xYz1AbC4d") === "generic-high-entropy");
  // exemptions / non-secrets
  check("secret: *_env key exempt", secretScanLeaf("api_key_env", "NVIDIA_API_KEY") === null);
  check("secret: host NOT flagged", secretScanLeaf("host", "https://integrate.api.nvidia.com/v1") === null);
  check("secret: model id NOT flagged", secretScanLeaf("model", "qwen3-next:80b-a3b-instruct-q4_K_M") === null);
  check("secret: path NOT flagged", secretScanLeaf("spec_docs_path", "docs/specs/") === null);
  check("secret: short value on key-named field NOT flagged (below 32)", secretScanLeaf("token", "shortish") === null);
  check("secret: non-key-named long blob NOT flagged (generic gated on key name)",
    secretScanLeaf("some_field", "aB3dEf6hIj9lMn2pQr5tUv8xYz1AbC4d") === null);

  // redaction NEVER emits the raw value.
  {
    const raw = "sk-SUPERSECRETVALUE1234567890abcdef";
    const red = redactSecret("adversarial.api_key", raw);
    check("redact: raw value absent from redacted output", !red.includes("SECRETVALUE") && !red.includes(raw));
    check("redact: shows len + 4-char prefix", red.includes("len=") && red.includes(`"sk-S"`));
  }
  {
    // scanDocForSecrets full-path: the raw value must not appear in ANY finding message.
    const raw = "ghp_ZZZZZZZZZZ0123456789abcdefghij";
    const doc = { adversarial: { api_key: raw } };
    const fs2 = scanDocForSecrets(doc, ".faffrc.yaml");
    check("scan: nested leaf flagged by dotted path", fs2.length === 1 && fs2[0].surface === ".faffrc.yaml:adversarial.api_key");
    check("scan: raw value NEVER in finding message", !fs2[0].message.includes(raw) && !fs2[0].message.includes("ZZZZZZZZZZ"));
    // sequence-item leaf scanning.
    const doc2 = { fallbacks: [{ api_key: raw }] };
    const fs3 = scanDocForSecrets(doc2, "x");
    check("scan: sequence-item leaf flagged with [i] path", fs3.length === 1 && fs3[0].surface === "x:fallbacks[0].api_key");
  }

  // --- merge table (deepMergeConfig) ---------------------------------------
  check("merge: overlay wins scalar",
    deepMergeConfig({ appetite: "high" }, { appetite: "low" }).appetite === "low");
  check("merge: deep-merge maps per leaf (base sibling survives)", (() => {
    const m = deepMergeConfig({ slots: { spec: "a", review: "b" } }, { slots: { review: "c" } });
    return m.slots.spec === "a" && m.slots.review === "c";
  })());
  check("merge: sequences replaced wholesale (never element-merged)", (() => {
    const m = deepMergeConfig({ hosts: ["a", "b", "c"] }, { hosts: ["x"] });
    return Array.isArray(m.hosts) && m.hosts.length === 1 && m.hosts[0] === "x";
  })());
  check("merge: overlay-only key added", deepMergeConfig({ a: 1 }, { b: 2 }).b === 2);
  check("merge: no overlay → base unchanged (identity)", (() => {
    const base = { a: 1, b: { c: 2 } };
    return deepMergeConfig(base, {}).a === 1 && deepMergeConfig(base, {}).b.c === 2;
  })());
  check("merge: type mismatch (map over scalar) → overlay wins", (() => {
    const m = deepMergeConfig({ x: "scalar" }, { x: { nested: 1 } });
    return isPlainConfigMap(m.x) && m.x.nested === 1;
  })());
  check("merge: does not mutate base input", (() => {
    const base = { slots: { spec: "a" } };
    deepMergeConfig(base, { slots: { spec: "z" } });
    return base.slots.spec === "a";
  })());

  // --- posture logic (computeConfigCheck pure core) ------------------------
  {
    // base git-ignored → posture warn with migration steps; exit 1.
    const r = computeConfigCheck({
      root: "/r", basePath: "/r/.faff/config.yaml", baseDoc: {}, overlayPath: null, overlayDoc: null,
      legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => true, isTracked: () => false },
    });
    check("posture: ignored base → 1 finding, exit 1", r.findings.length === 1 && r.exit === 1);
    check("posture: finding carries migration steps", r.findings[0].message.includes("Migrate:") && r.findings[0].message.includes(".faff/config.local.yaml") && r.findings[0].message.includes(".faff/.gitignore"));
  }
  {
    // base tracked + not ignored → clean, exit 0.
    const r = computeConfigCheck({
      root: "/r", basePath: "/r/.faff/config.yaml", baseDoc: {}, overlayPath: null, overlayDoc: null,
      legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("posture: tracked base → clean, exit 0", r.findings.length === 0 && r.exit === 0);
  }
  {
    // overlay NOT ignored → hygiene finding.
    const r = computeConfigCheck({
      root: "/r", basePath: "/r/.faff/config.yaml", baseDoc: {}, overlayPath: "/r/.faff/config.local.yaml", overlayDoc: {},
      legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: (n) => false, isTracked: () => true },
    });
    check("hygiene: un-ignored overlay flagged", r.findings.some((f) => f.surface === ".faff/config.local.yaml" && /NOT git-ignored/.test(f.message)));
    check("hygiene: canonical un-ignored overlay names gitignore-ensure (which does fix it)", r.findings.some((f) => /Run `faff gitignore-ensure`/.test(f.message)));
  }
  {
    // FAFF-1302: a DEPRECATED-tier overlay that is not ignored must NOT be told to run
    // `gitignore-ensure`. The root pattern set is empty, so no faff write can ignore a root
    // overlay; the only working remedy is the move. Exercising the un-ignored deprecated case
    // is what keeps that remedy honest, since the tier's other cases stub isIgnored true.
    const r = computeConfigCheck({
      root: "/r", basePath: "/r/.faffrc.yaml", baseDoc: {}, baseTier: "deprecated",
      overlayPath: "/r/.faffrc.local.yaml", overlayDoc: {}, overlayTier: "deprecated",
      legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    const f = r.findings.find((x) => /NOT git-ignored/.test(x.message));
    check("hygiene: deprecated un-ignored overlay names the move, not gitignore-ensure", !!f && /mv \.faffrc\.local\.yaml \.faff\/config\.local\.yaml/.test(f.message));
    check("hygiene: deprecated un-ignored overlay says gitignore-ensure cannot help", !!f && /cannot ignore it where it is/.test(f.message));
  }
  {
    // not a git repo → posture skipped (reported), parse/secret still run; clean → exit 0.
    const r = computeConfigCheck({
      root: "/r", basePath: "/r/.faff/config.yaml", baseDoc: { slots: { spec: "x" } }, overlayPath: null, overlayDoc: null,
      legacyBase: [], legacyOverlay: [],
      probes: { inRepo: false, isIgnored: () => false, isTracked: () => false },
    });
    check("not-a-repo: posture skipped + reported", r.skipped.length === 1 && r.exit === 0);
  }

  // --- FAFF-1301: .faff ignore posture (over-ignore and under-ignore) -----------
  {
    const faffIgnore = (extra) => computeConfigCheck({
      root: "/r", basePath: "/r/.faff/config.yaml", baseDoc: {}, overlayPath: null, overlayDoc: null,
      legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
      ...extra,
    });
    const onGitignore = (r) => r.findings.filter((f) => f.surface === ".gitignore");
    const onInner = (r) => r.findings.filter((f) => f.surface === ".faff/.gitignore");
    const runStateIgnored = { inRepo: true, isIgnored: (n) => n === ".faff/runs", isTracked: () => true };

    let r = faffIgnore({ rootGitignore: ".faff/\n" });
    check("faff-ignore: `.faff/` → one warn on .gitignore, exit 1", r.findings.length === 1 && r.findings[0].severity === "warn" && r.findings[0].surface === ".gitignore" && r.exit === 1);
    check("faff-ignore: message echoes the line, names `.faff/*`, says ensure cannot fix it", /\(line: `\.faff\/`\)/.test(r.findings[0].message) && r.findings[0].message.includes("`.faff/*`") && r.findings[0].message.includes("cannot fix this"));
    check("faff-ignore: `**/.faff/` flagged", onGitignore(faffIgnore({ rootGitignore: "**/.faff/\n" })).length === 1);
    check("faff-ignore: `/**/.faff` flagged", onGitignore(faffIgnore({ rootGitignore: "/**/.faff\n" })).length === 1);
    check("faff-ignore: `.faff/**` flagged", onGitignore(faffIgnore({ rootGitignore: ".faff/**\n" })).length === 1);
    check("faff-ignore: `.faff/*` + `!.faff/anchors/` → no .gitignore finding", onGitignore(faffIgnore({ rootGitignore: ".faff/*\n!.faff/anchors/\n" })).length === 0);
    check("faff-ignore: rootGitignore omitted → no .gitignore finding", onGitignore(faffIgnore({})).length === 0);
    r = faffIgnore({ rootGitignore: ".faff\n", probes: { inRepo: false, isIgnored: () => false, isTracked: () => false } });
    check("faff-ignore: outside a repo still flagged, posture skip kept", onGitignore(r).length === 1 && r.skipped.includes("posture checks skipped (not a git repo)"));
    r = faffIgnore({ rootGitignore: ".faff/\n.faff/**\n.faff/\n" });
    check("faff-ignore: several hazard lines → one finding, plural slot, duplicates collapsed", onGitignore(r).length === 1 && r.findings[0].message.includes("(lines: `.faff/`, `.faff/**`)"));

    r = faffIgnore({ faffDirPresent: true, faffDirGitignorePresent: false });
    check("faff-ignore: nothing ignores run state → one warn on .faff/.gitignore naming ensure, exit 1", onInner(r).length === 1 && onInner(r)[0].severity === "warn" && onInner(r)[0].message.includes("faff gitignore-ensure") && onInner(r)[0].message.includes("is absent") && r.exit === 1);
    r = faffIgnore({ faffDirPresent: true, faffDirGitignorePresent: true });
    check("faff-ignore: inner file present but run state unignored → ineffective variant", onInner(r).length === 1 && onInner(r)[0].message.includes("exists but does not ignore") && !onInner(r)[0].message.includes("is absent"));
    const untracked = { probes: { ...runStateIgnored, isTracked: () => false }, faffDirPresent: true, faffDirGitignorePresent: true, rootGitignore: "node_modules/\n" };
    r = faffIgnore(untracked);
    check("faff-ignore: untracked inner file, silent root → one finding saying NOT committed", onInner(r).length === 1 && onInner(r)[0].message.includes("NOT committed"));
    check("faff-ignore: tracked inner file → silent", onInner(faffIgnore({ ...untracked, probes: runStateIgnored })).length === 0);
    check("faff-ignore: untracked inner file but committed root `.faff/*` covers a clone → silent", onInner(faffIgnore({ ...untracked, rootGitignore: ".faff/*\n", probes: { ...runStateIgnored, isTracked: (n) => n === ".gitignore" } })).length === 0);
    check("faff-ignore: untracked inner file and UNCOMMITTED root `.faff/*` → still fires", onInner(faffIgnore({ ...untracked, rootGitignore: ".faff/*\n" })).length === 1);
    check("faff-ignore: faffDirPresent with inRepo false → silent", onInner(faffIgnore({ faffDirPresent: true, probes: { inRepo: false, isIgnored: () => false, isTracked: () => false } })).length === 0);
    const faffPathCalls = [];
    const recording = (name) => (n) => { if (String(n).startsWith(".faff/") && n !== CANONICAL_CONFIG) faffPathCalls.push(`${name}:${n}`); return false; };
    faffIgnore({ rootGitignore: "x\n", probes: { inRepo: true, isIgnored: recording("isIgnored"), isTracked: recording("isTracked") } });
    check("faff-ignore: faffDirPresent omitted → no probe sees a .faff path", faffPathCalls.length === 0);
    r = faffIgnore({ rootGitignore: ".faff/\n", faffDirPresent: true, faffDirGitignorePresent: false, probes: runStateIgnored });
    check("faff-ignore: hazard line with run state still ignored → finding 1 only", r.findings.length === 1 && r.findings[0].surface === ".gitignore");
  }
  // --- FAFF-1302: config files under .faff/ -----------------------------------
  {
    const calls = [];
    const recording = (name) => (n) => { calls.push(`${name}:${n}`); return name === "isTracked"; };
    const probes = { inRepo: true, isIgnored: recording("isIgnored"), isTracked: recording("isTracked") };
    const r = computeConfigCheck({ root: "/r", basePath: "/r/.faff/config.yaml", baseDoc: {}, baseTier: "canonical", overlayPath: null, overlayDoc: null, legacyBase: [], legacyOverlay: [], probes });
    check("under-faff: base probes are handed the repo-relative path", calls.includes("isIgnored:.faff/config.yaml") && calls.includes("isTracked:.faff/config.yaml") && !calls.some((c) => c.endsWith(":config.yaml")));
    check("under-faff: a committed, unignored base is clean", r.findings.length === 0 && r.exit === 0);
  }
  {
    const calls = [];
    const probes = { inRepo: true, isIgnored: (n) => { calls.push(n); return false; }, isTracked: (n) => { calls.push(n); return false; } };
    const r = computeConfigCheck({
      root: "/wt", basePath: "/main/.faff/config.yaml", baseDoc: { bogus_key: 1 }, baseTier: "canonical",
      overlayPath: "/main/.faff/config.local.yaml", overlayDoc: { other_bogus: 1 }, overlayTier: "canonical",
      legacyBase: [], legacyOverlay: [], probes,
    });
    check("worktree fallback: neither git probe is called for an out-of-root file", calls.length === 0);
    check("worktree fallback: no posture finding", !r.findings.some((f) => /unmigrated|NOT git-ignored/.test(f.message)));
    check("worktree fallback: one skipped entry per file, naming its absolute path", r.skipped.length === 2 && r.skipped[0].includes("/main/.faff/config.yaml") && r.skipped[1].includes("/main/.faff/config.local.yaml"));
    check("worktree fallback: other findings carry the absolute path as surface", r.findings.some((f) => f.surface === "/main/.faff/config.yaml:bogus_key"));
    check("worktree fallback: no surface and no skipped entry holds a `..` segment", [...r.findings.map((f) => f.surface), ...r.skipped].every((t) => !t.split(/[\/:\s]/).includes("..")));
  }
  {
    const r = computeConfigCheck({
      root: "/r", basePath: "/r/.faff/config.yaml", baseDoc: {}, baseTier: "canonical", staleBasePath: "/r/" + DEPRECATED_CONFIG[0],
      overlayPath: "/r/.faff/config.local.yaml", overlayDoc: {}, overlayTier: "canonical", staleOverlayPath: "/r/" + DEPRECATED_OVERLAY_CONFIG[0],
      legacyBase: [], legacyOverlay: [], probes: { inRepo: true, isIgnored: (n) => n === CANONICAL_OVERLAY_CONFIG, isTracked: () => true },
    });
    const base = r.findings.find((f) => f.surface === CANONICAL_CONFIG);
    const overlay = r.findings.find((f) => f.surface === CANONICAL_OVERLAY_CONFIG);
    check("duplicate base: warn naming the stale file and `git rm`", Boolean(base) && base.severity === "warn" && base.message.includes(DEPRECATED_CONFIG[0]) && base.message.includes("git rm " + DEPRECATED_CONFIG[0]));
    check("duplicate overlay: warn naming `rm`, never `git rm`", Boolean(overlay) && overlay.severity === "warn" && overlay.message.includes("rm " + DEPRECATED_OVERLAY_CONFIG[0]) && !overlay.message.includes("git rm"));
  }
  {
    const r = computeConfigCheck({
      root: "/r", basePath: "/r/" + DEPRECATED_CONFIG[0], baseDoc: {}, baseTier: "deprecated",
      overlayPath: "/r/" + DEPRECATED_OVERLAY_CONFIG[0], overlayDoc: {}, overlayTier: "deprecated",
      legacyBase: [], legacyOverlay: [], probes: { inRepo: true, isIgnored: (n) => n === CANONICAL_OVERLAY_CONFIG || n === DEPRECATED_OVERLAY_CONFIG[0], isTracked: () => true },
    });
    const base = r.findings.find((f) => f.surface === DEPRECATED_CONFIG[0]);
    const overlay = r.findings.find((f) => f.surface === DEPRECATED_OVERLAY_CONFIG[0] && /deprecated location/.test(f.message));
    check("deprecated base: warn carrying the exact `git mv` command", Boolean(base) && base.severity === "warn" && base.message.includes(`git mv ${DEPRECATED_CONFIG[0]} ${CANONICAL_CONFIG}`));
    check("deprecated overlay: warn carrying plain `mv` and the machine-local reason", Boolean(overlay) && overlay.message.includes(`To migrate:  mv ${DEPRECATED_OVERLAY_CONFIG[0]} ${CANONICAL_OVERLAY_CONFIG}`) && !overlay.message.includes("git mv " + DEPRECATED_OVERLAY_CONFIG[0]) && overlay.message.includes("machine-local"));
    check("deprecated tier: warn never error", r.findings.every((f) => f.severity === "warn"));
  }
  {
    const r = computeConfigCheck({
      root: "/r", basePath: "/r/.faff/config.yaml", baseDoc: null, baseTier: "canonical",
      baseParseError: { file: "/r/.faff/config.yaml", detail: "does not parse to a mapping" },
      overlayPath: null, overlayDoc: null, legacyBase: [DEPRECATED_CONFIG[0] + "x"], legacyOverlay: [], probes: { inRepo: false },
    });
    const malformed = r.findings.find((f) => /malformed base config/.test(f.message));
    const legacy = r.findings.find((f) => /legacy config filename/.test(f.message));
    check("check 1b: the remedy names the resolved base path", Boolean(malformed) && malformed.message.includes("git checkout .faff/config.yaml"));
    check("check 5: the message names the new paths and calls the root names deprecated but still read", Boolean(legacy) && legacy.message.includes(CANONICAL_CONFIG) && legacy.message.includes(CANONICAL_OVERLAY_CONFIG) && /deprecated/.test(legacy.message) && /still read/.test(legacy.message));
  }
  check("computeConfigCheck's source holds no root-config literal", !computeConfigCheck.toString().includes(".faffrc"));
  check("MIGRATION_STEPS names the new overlay and .faff/.gitignore, and no longer drops a root line", MIGRATION_STEPS.join("\n").includes(CANONICAL_OVERLAY_CONFIG) && MIGRATION_STEPS.join("\n").includes(".faff/.gitignore") && !MIGRATION_STEPS.join("\n").includes(".faffrc"));
  {
    const notice = (name, role, isIgnored) => locationNoticeText(name, role, isIgnored);
    const overlayWrong = notice(DEPRECATED_OVERLAY_CONFIG[0], "overlay", () => false);
    check("notice: an un-ignored overlay destination names gitignore-ensure ahead of the mv and the stageable hazard", overlayWrong.indexOf("faff gitignore-ensure") !== -1 && overlayWrong.indexOf("faff gitignore-ensure") < overlayWrong.indexOf("To migrate") && overlayWrong.includes("operator-private file stageable"));
    const baseWrong = notice(DEPRECATED_CONFIG[0], "base", () => true);
    check("notice: an ignored base destination names gitignore-ensure ahead of the git mv and the uncommittable hazard", baseWrong.indexOf("faff gitignore-ensure") < baseWrong.indexOf("git mv") && baseWrong.includes("uncommittable"));
    check("notice: a destination with the right posture prints the move alone", !notice(DEPRECATED_OVERLAY_CONFIG[0], "overlay", () => true).includes("gitignore-ensure") && !notice(DEPRECATED_CONFIG[0], "base", () => false).includes("gitignore-ensure"));
    check("notice: no probe (outside a git repo) prints the move alone", !notice(DEPRECATED_CONFIG[0], "base", null).includes("gitignore-ensure") && notice(DEPRECATED_CONFIG[0], "base", null).includes("git mv"));
  }

  {
    // secret in base doc → exit 1, redacted (no raw value in any message).
    const raw = "sk-abcdefghijklmnopqrstuvwxyz0123456789";
    const r = computeConfigCheck({
      root: "/r", basePath: "/r/.faff/config.yaml", baseDoc: { api_key: raw }, overlayPath: null, overlayDoc: null,
      legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("secret-in-doc: exit 1", r.exit === 1);
    check("secret-in-doc: no raw value in output", !JSON.stringify(r.findings).includes(raw));
  }
  {
    // legacy filename present → error finding, exit 1.
    const r = computeConfigCheck({
      root: "/r", basePath: null, baseDoc: null, overlayPath: null, overlayDoc: null,
      legacyBase: [".faffrc.yml"], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("legacy: present filename → error finding, exit 1", r.exit === 1 && r.findings.some((f) => f.severity === "error"));
  }
  {
    // FAFF-577: malformed base → error-severity finding naming file + detail, exit 1
    // (detection-as-finding — never an exit-2 abort in the pure core's vocabulary).
    const r = computeConfigCheck({
      root: "/r", basePath: "/r/.faff/config.yaml", baseDoc: null, overlayPath: null, overlayDoc: null,
      legacyBase: [], legacyOverlay: [],
      baseParseError: { file: "/r/.faff/config.yaml", detail: "does not parse to a mapping (malformed YAML — the base config must be a key:value mapping)" },
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("malformed base: error finding naming file + detail, exit 1",
      r.exit === 1 && r.findings.some((f) => f.severity === "error" && f.surface === ".faff/config.yaml" && /malformed base config/.test(f.message) && /does not parse to a mapping/.test(f.message)));
  }

  // --- known-key (schema) lint (FAFF-794) ----------------------------------
  {
    // flat-dotted key with an UNKNOWN prefix (the live repro: typo'd "autonymous" +
    // flat form) → exactly one finding, never two, exit 1.
    const r = computeConfigCheck({
      root: "/r", basePath: "/r/.faff/config.yaml", baseDoc: { "autonymous.sentry_acting": true },
      overlayPath: null, overlayDoc: null, legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("known-key: flat-dotted unknown-prefix key → exactly 1 warn finding, exit 1",
      r.exit === 1 && r.findings.length === 1 && r.findings[0].severity === "warn"
      && r.findings[0].surface === ".faff/config.yaml:autonymous.sentry_acting"
      && /flat dotted key with unrecognised namespace `autonymous`/.test(r.findings[0].message));
  }
  {
    // flat-dotted key with a KNOWN prefix (correctly-spelled but flat) → nested-map hint.
    const r = computeConfigCheck({
      root: "/r", basePath: "/r/.faff/config.yaml", baseDoc: { "gates.fallback": "advisory" },
      overlayPath: null, overlayDoc: null, legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("known-key: flat-dotted known-prefix key → nested-map-hint warn finding",
      r.findings.length === 1 && /flat dotted key — you likely meant a nested map \(the segments under `gates:`\)/.test(r.findings[0].message));
  }
  {
    // multi-dot flat key → exactly ONE finding naming the FULL key.
    const r = computeConfigCheck({
      root: "/r", basePath: "/r/.faff/config.yaml", baseDoc: { "autonomous.guardrails.require_container": true },
      overlayPath: null, overlayDoc: null, legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("known-key: multi-dot flat key → exactly 1 finding naming the full key",
      r.findings.length === 1 && r.findings[0].surface === ".faff/config.yaml:autonomous.guardrails.require_container");
  }
  {
    // plain unknown top-level key (no dot) → warn naming it + the known namespaces.
    const r = computeConfigCheck({
      root: "/r", basePath: "/r/.faff/config.yaml", baseDoc: { appetitte: "high" },
      overlayPath: null, overlayDoc: null, legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("known-key: plain unknown key → warn finding naming key + known namespaces",
      r.findings.length === 1 && r.findings[0].surface === ".faff/config.yaml:appetitte"
      && /unrecognised top-level key/.test(r.findings[0].message) && /Known namespaces:/.test(r.findings[0].message));
  }
  {
    // overlay-only unknown key → surface names the OVERLAY file, not the base.
    const r = computeConfigCheck({
      root: "/r", basePath: "/r/.faff/config.yaml", baseDoc: {},
      overlayPath: "/r/.faff/config.local.yaml", overlayDoc: { bogus_key: 1 },
      legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => true, isTracked: () => true },
    });
    check("known-key: overlay-only unknown key → surface names the overlay file",
      r.findings.some((f) => f.surface === ".faff/config.local.yaml:bogus_key"));
  }
  {
    // known top-level key with a scalar value (not a map) → key-name-only, no finding.
    const r = computeConfigCheck({
      root: "/r", basePath: "/r/.faff/config.yaml", baseDoc: { slots: "not-a-map" },
      overlayPath: null, overlayDoc: null, legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("known-key: known top-level key with scalar value → no known-key finding (key-name-only), exit 0",
      !r.findings.some((f) => f.surface.endsWith(":slots")) && r.findings.length === 0 && r.exit === 0);
  }
  {
    // fully valid config (only known namespaces, properly nested) → no known-key findings.
    const r = computeConfigCheck({
      root: "/r", basePath: "/r/.faff/config.yaml",
      baseDoc: { tracking: { tracker: "linear" }, slots: { spec: "x" }, appetite: "high" },
      overlayPath: null, overlayDoc: null, legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("known-key: fully valid config → no known-key findings, exit 0",
      r.findings.length === 0 && r.exit === 0);
  }
  {
    // absent base and overlay → the lint contributes nothing (all-defaults stays clean).
    const r = computeConfigCheck({
      root: "/r", basePath: null, baseDoc: null, overlayPath: null, overlayDoc: null,
      legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("known-key: absent base/overlay → no findings, exit 0", r.findings.length === 0 && r.exit === 0);
  }
  {
    // WRITABLE_NAMESPACES must include "install" (gates.js's install.skill_targets is live).
    check("known-key: WRITABLE_NAMESPACES includes 'install'", WRITABLE_NAMESPACES.has("install"));
  }

  // --- FAFF-965: read-only recognised namespaces (capture, provenance) --------
  {
    // The repo's own live repro: a `capture:` stanza (decision-capture.js's read) yields no
    // known-key finding, and exit 0 absent other findings.
    const r = computeConfigCheck({
      root: "/r", basePath: "/r/.faff/config.yaml", baseDoc: { capture: { decision_kernel: "on" } },
      overlayPath: null, overlayDoc: null, legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("FAFF-965: capture stanza → no known-key finding, exit 0", r.findings.length === 0 && r.exit === 0);
  }
  {
    // provenance (harness.js's dormant read) is recognised the same way.
    const r = computeConfigCheck({
      root: "/r", basePath: "/r/.faff/config.yaml", baseDoc: { provenance: { harness: "x" } },
      overlayPath: null, overlayDoc: null, legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("FAFF-965: provenance stanza → no known-key finding, exit 0", r.findings.length === 0 && r.exit === 0);
  }
  {
    // the "Known namespaces:" help text lists the full recognised UNION (capture + provenance
    // included), sorted — proven via a genuinely-unknown key so the message is actually emitted.
    const r = computeConfigCheck({
      root: "/r", basePath: "/r/.faff/config.yaml", baseDoc: { bogus_unknown_key: 1 },
      overlayPath: null, overlayDoc: null, legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    const msg = r.findings[0] && r.findings[0].message;
    const sortedUnion = [...RECOGNISED_NAMESPACES].sort().join(", ");
    check("FAFF-965: Known-namespaces text lists the sorted recognised union incl. capture/provenance",
      !!msg && msg.includes(`Known namespaces: ${sortedUnion}.`) && msg.includes("capture") && msg.includes("provenance"));
  }
  {
    // the writable-vs-recognised distinction: capture/provenance are recognised but NOT
    // writable — config set's write-guard and configSetSelftest's example-drift check must
    // stay untouched by this change.
    check("FAFF-965: WRITABLE_NAMESPACES excludes capture/provenance (writable-vs-recognised distinction preserved)",
      !WRITABLE_NAMESPACES.has("capture") && !WRITABLE_NAMESPACES.has("provenance"));
    check("FAFF-965: RECOGNISED_NAMESPACES is the union (⊇ WRITABLE_NAMESPACES, includes capture+provenance)",
      [...WRITABLE_NAMESPACES].every((ns) => RECOGNISED_NAMESPACES.has(ns))
      && RECOGNISED_NAMESPACES.has("capture") && RECOGNISED_NAMESPACES.has("provenance"));
  }
  {
    // known-key findings never hard-fail: severity stays "warn" for an unrecognised key.
    const r = computeConfigCheck({
      root: "/r", basePath: "/r/.faff/config.yaml", baseDoc: { totally_unknown_namespace: 1 },
      overlayPath: null, overlayDoc: null, legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("FAFF-965: unrecognised key stays severity 'warn' (never hard-fails)",
      r.findings.length === 1 && r.findings[0].severity === "warn");
  }

  // --- FAFF-965: recognised-namespaces drift guard (source-scan) --------------
  {
    // the guard passes against the CLI's OWN current source — every dig(<blessed-ident>,
    // "<ns>.…") read it can see is a member of RECOGNISED_NAMESPACES.
    const libDir = __dirname;
    const fileTexts = fs.readdirSync(libDir).filter((f) => f.endsWith(".js"))
      .map((name) => ({ name, text: fs.readFileSync(path.join(libDir, name), "utf8") }));
    const missing = missingRecognisedNamespaces(fileTexts);
    check("FAFF-965: recognised-namespaces drift guard passes on current source", missing.size === 0);
  }
  {
    // scanConfigReadNamespaces only matches the small CONFIG_DOC_IDENTS allowlist — an
    // un-blessed identifier holding the same shaped call is invisible to the guard (by design).
    const hits = scanConfigReadNamespaces('const v = dig(someOtherThing, "notconfig.leaf");');
    check("FAFF-965: scan ignores dig() calls on a non-blessed identifier", hits.length === 0);
  }
  {
    // injecting a read of an unregistered namespace via a BLESSED identifier makes the guard
    // fail, naming the offending namespace — the guard's own regression coverage. The synthetic
    // call text is assembled by concatenation so this test's OWN source bytes never contain the
    // contiguous "dig(cfgData" pattern — otherwise the "current source" scan above (which reads
    // THIS file's real bytes) would self-trip on its own test fixture.
    const digCall = "dig(" + "cfgData" + ', "' + "newns" + '.field");';
    const injected = [{ name: "fake-module.js", text: `const x = ${digCall}` }];
    const missing = missingRecognisedNamespaces(injected);
    check("FAFF-965: drift guard flags an injected unregistered namespace via a blessed ident",
      missing.size === 1 && missing.has("newns") && missing.get("newns").has("fake-module.js"));
  }
  {
    // the exceptions list suppresses a specific (ident, namespace) pair — proven with a
    // temporarily-injected exception (restored immediately after) rather than depending on the
    // real (currently empty) production list. Same concatenation precaution as above.
    const digCall = "dig(" + "d" + ', "' + "excludedns" + '.field");';
    const injected = [{ name: "fake-module.js", text: `const x = ${digCall}` }];
    RECOGNISED_NAMESPACES_DRIFT_EXCEPTIONS.add("d:excludedns");
    const missing = missingRecognisedNamespaces(injected);
    RECOGNISED_NAMESPACES_DRIFT_EXCEPTIONS.delete("d:excludedns");
    check("FAFF-965: an explicit (ident, namespace) exception suppresses the guard's finding", missing.size === 0);
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (config check, ${fail} failed)`);
  return fail ? 1 : 0;
}


module.exports = { cmdConfigCheck, computeConfigCheck, configCheckSelftest, redactSecret, scanDocForSecrets, secretScanLeaf };
