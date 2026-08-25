// ===========================================================================
// === region:factory — bundle — FAFF-819: Phase 0 recovery bundle publish + fail-closed verify ===
// Publishes an immutable, independently-verifiable recovery bundle at each safe boundary
// (the per-issue merge-floor anchor, and — git-only mode only — the run-close anchor) and
// verifies one through a fail-closed verdict ladder (CLEAN/STALE/MISSING/MALFORMED/TAMPERED/
// VERIFICATION_UNAVAILABLE). Two pure cores (buildBundle / classifyBundle) sit behind a
// top-level `bundle_store` config key resolved to one of two occupants satisfying the same fixed
// BundleStore contract (put/headDigest/member/listBoundaries): the default LOCAL occupant (nothing leaves
// the box) and the GIT-REMOTE occupant (each bundle a write-once orphan commit pushed to its
// own `refs/faff/bundles/<run_id>/seg-<segment>/<boundary_key>` ref — no PR, no CI). Tamper
// detection REUSES buildManifest/diffAgainstManifest (integrity-digest.js) and verifyChain/
// verifyEffectsChain (events.js) verbatim — never forked. FAFF-845 adds the b2 manifest version
// and its `contract_fingerprint` member (mint-time governance posture + local contract-schema
// hashes); requiredMembersFor(version) gates the required-member set so an already-published b1
// bundle still verifies CLEAN. Still out of scope: bundle consumption/recover (FAFF-820), merge-
// evidence acceptance (FAFF-823), a third-party object-store occupant, unresolved_effects/
// restart_descriptor members, and a posture-aware recovery gate (all deferred past FAFF-845 too).
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parseArgs, usageError } = require("./argv");
const { dig, findRoot, HERE, isSafeAnchorRelPath } = require("./shared-infra");
const { loadConfig, DEFAULTS } = require("./config");
const { buildManifest, diffAgainstManifest, sha256 } = require("./integrity-digest");
const { verifyChain, verifyEffectsChain, appendEventRecord } = require("./events");
const { resolveKnownSecretValues } = require("./redact");
const { computeBundleVerdict, CONTRACTS } = require("./contract-defs");

const REDACTED_PLACEHOLDER = "[REDACTED]";
const BUNDLE_MANIFEST_VERSION = "b2"; // was "b1" — FAFF-845 adds the contract_fingerprint member
// REQUIRED_MEMBERS_B1 — FAFF-819's shipped 6. REQUIRED_MEMBERS_B2 — FAFF-845 adds
// contract_fingerprint. requiredMembersFor(version) is the version gate: an already-published b1
// bundle still verifies against the b1 set, and only a new b2-stamped bundle requires the 7th
// member. REQUIRED_MEMBERS stays exported as a back-compat alias for the b1 set (some call sites
// may still import the flat list); all classify/fetch loops below use requiredMembersFor().
const REQUIRED_MEMBERS_B1 = ["ledger_snapshot", "admitted_outcomes", "anchors", "artifact_manifest", "last_safe_boundary", "redaction"];
const REQUIRED_MEMBERS_B2 = [...REQUIRED_MEMBERS_B1, "contract_fingerprint"];
const REQUIRED_MEMBERS = REQUIRED_MEMBERS_B1;
function requiredMembersFor(version) {
  // An absent/unknown version reads as the original b1 contract, never as "b2 minus
  // contract_fingerprint" — that would false-flag every already-published b1 bundle MISSING.
  return version === "b2" ? REQUIRED_MEMBERS_B2 : REQUIRED_MEMBERS_B1;
}
const BUNDLE_BOUNDARY_KINDS = ["issue-merge-floor", "run-close"];
// Identity-component charset (spec §4 "Identity-component validation") — applied by the
// store-agnostic layer BEFORE any component is interpolated into a ref name / filesystem path /
// object-store key, so every occupant inherits the guard. run_id and boundary_key: no ".."
// segment, and — defence in depth for the git-remote occupant's argv construction — the first
// character is never `-` (a token that could otherwise be read as a flag if a future call site
// ever passed one as a bare, unprefixed git argv element; every current call site embeds the
// token inside a longer `refs/faff/bundles/...`-prefixed string, but the charset itself should
// not rely on that).
const IDENTITY_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// ---------------------------------------------------------------------------
// canonical(members) — pinned deterministic serialisation (spec §3): object keys sorted
// lexicographically at every depth, UTF-8, no insignificant whitespace, integers as plain
// decimals. A second machine recomputes byte-identical bytes from the same member-ref map.
// ---------------------------------------------------------------------------
function canonicalJSON(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJSON).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJSON(value[k])).join(",") + "}";
}

function validIdentityToken(tok) {
  return typeof tok === "string" && tok.length > 0 && IDENTITY_TOKEN_RE.test(tok) && !tok.includes("..");
}

// Validate every identity component BEFORE it is interpolated into any store handle. Returns a
// non-empty array of violation strings, or [] when the identity is handle-safe. Deliberately
// standalone (not folded into computeBundleVerdict's looser contract-shape check) — this is the
// hard, store-agnostic invariant every occupant inherits; a failing component is a hard error.
function validateIdentityForHandle(identity) {
  const violations = [];
  if (!identity || typeof identity !== "object") return ["identity must be an object"];
  if (!validIdentityToken(identity.run_id)) violations.push(`run_id ${JSON.stringify(identity.run_id)} fails the identity charset`);
  if (!Number.isInteger(identity.run_segment_id) || identity.run_segment_id < 0) violations.push(`run_segment_id must be a non-negative integer, got ${JSON.stringify(identity.run_segment_id)}`);
  if (!BUNDLE_BOUNDARY_KINDS.includes(identity.boundary_kind)) violations.push(`boundary_kind ${JSON.stringify(identity.boundary_kind)} not in {${BUNDLE_BOUNDARY_KINDS.join(",")}}`);
  if (!validIdentityToken(identity.boundary_key)) violations.push(`boundary_key ${JSON.stringify(identity.boundary_key)} fails the identity charset`);
  if (identity.boundary_kind === "run-close" && identity.boundary_key !== "run-close") violations.push('boundary_kind "run-close" requires boundary_key === "run-close"');
  return violations;
}

// ---------------------------------------------------------------------------
// Pure core: buildBundle(runDir, identityInput, root) — assembles the 7-member minimal set.
// run_segment_id is deliberately NOT trusted from identityInput — it is derived from the SAME
// ledger read that produces ledger_snapshot (spec DONE: "never a second read"), so identityInput
// carries only { run_id, boundary_kind, boundary_key, boundary_seq }.
// ---------------------------------------------------------------------------
// FAFF-876 — boundary_kind selects the anchor dir: "run-close" reads the run-anchor ROOT
// directly (anchor-run mints summary.md + one subdir per admitted issue there, per ADR 0109 —
// there is no separate "run-close" subdirectory; boundary_key === "run-close" is an identity
// constant, never a path segment). Every other boundary_kind (issue-merge-floor) keeps today's
// <root>/.faff/anchors/<run_id>/<boundary_key>/ resolution, byte-identical.
function readAnchorDir(root, run_id, boundary_kind, boundary_key) {
  const dir = boundary_kind === "run-close"
    ? path.join(root, ".faff", "anchors", run_id)
    : path.join(root, ".faff", "anchors", run_id, boundary_key);
  const files = {};
  // FAFF-876 — creation-side walk hardened to parity with the verify-side guard (bundle.js
  // isSafeAnchorRelPath check above, FAFF-865): lstat (never follow a symlink) + reject any
  // unsafe rel-path. Fails LOUD (throws, naming the entry) rather than silently skipping — a
  // planted symlink/traversal entry under .faff/anchors/ is a fault the operator must see, not
  // a subset the bundle quietly omits.
  const walk = (d, rel) => {
    let names;
    try { names = fs.readdirSync(d).sort(); } catch { return; }
    for (const name of names) {
      const abs = path.join(d, name);
      const relPath = rel ? path.join(rel, name) : name;
      const relPosix = relPath.split(path.sep).join("/");
      let st;
      try { st = fs.lstatSync(abs); } catch { continue; }
      if (st.isSymbolicLink() || !isSafeAnchorRelPath(relPosix)) {
        throw new Error(`readAnchorDir: unsafe anchor entry: ${relPosix}`);
      }
      if (st.isDirectory()) walk(abs, relPath);
      else files[relPosix] = fs.readFileSync(abs).toString("base64");
    }
  };
  walk(dir, "");
  return { dir, relDir: path.relative(root, dir), files };
}

function buildBundle(runDir, identityInput, root = findRoot()) {
  if (!identityInput || !BUNDLE_BOUNDARY_KINDS.includes(identityInput.boundary_kind)) {
    throw new Error(`buildBundle: identityInput.boundary_kind must be one of {${BUNDLE_BOUNDARY_KINDS.join(",")}}`);
  }
  if (!validIdentityToken(identityInput.run_id)) throw new Error(`buildBundle: invalid run_id ${JSON.stringify(identityInput.run_id)}`);
  if (!validIdentityToken(identityInput.boundary_key)) throw new Error(`buildBundle: invalid boundary_key ${JSON.stringify(identityInput.boundary_key)}`);
  if (identityInput.boundary_kind === "run-close" && identityInput.boundary_key !== "run-close") {
    throw new Error('buildBundle: boundary_kind "run-close" requires boundary_key === "run-close"');
  }

  // ledger_snapshot — verbatim bytes; ALSO the source of run_segment_id (owner.epoch), the one
  // ledger read this bundle's segment id is derived from.
  const ledgerBytes = fs.readFileSync(path.join(runDir, "run-ledger.json"));
  let ledgerObj;
  try { ledgerObj = JSON.parse(ledgerBytes.toString("utf8")); }
  catch (e) { throw new Error(`buildBundle: run-ledger.json is not valid JSON: ${e.message}`); }
  const run_segment_id = Number((ledgerObj.owner && ledgerObj.owner.epoch) || 0);
  const identity = {
    run_id: identityInput.run_id,
    run_segment_id,
    boundary_kind: identityInput.boundary_kind,
    boundary_key: identityInput.boundary_key,
    boundary_seq: identityInput.boundary_seq,
  };

  // admitted_outcomes — projection over the SAME ledger bytes, no fields added.
  const admittedOutcomesBytes = Buffer.from(JSON.stringify({
    admitted: Array.isArray(ledgerObj.admitted) ? ledgerObj.admitted : [],
    outcomes: (ledgerObj.outcomes && typeof ledgerObj.outcomes === "object" && !Array.isArray(ledgerObj.outcomes)) ? ledgerObj.outcomes : {},
  }), "utf8");

  // anchors — verbatim bytes from .faff/anchors/<run_id>/<boundary_key>/ for issue-merge-floor,
  // or the run-anchor ROOT .faff/anchors/<run_id>/ for run-close (FAFF-876 — see readAnchorDir):
  // mintIssueAnchor's own output (events.jsonl, run-ledger.json, chain-head.json,
  // +declared-effects.jsonl/witness and the copied merge-floor files when present), plus —
  // run-close only — the run-level summary.md and every admitted issue's own subdir. A directory
  // snapshot, one blob member.
  const anchor = readAnchorDir(root, identity.run_id, identity.boundary_kind, identity.boundary_key);
  if (Object.keys(anchor.files).length === 0) {
    throw new Error(`buildBundle: no anchor found at ${anchor.dir} — publish must run AFTER the anchor mint, never before`);
  }
  const anchorsBytes = Buffer.from(JSON.stringify({ dir: anchor.relDir, files: anchor.files }), "utf8");

  // artifact_manifest — the existing d1 manifest (integrity-digest.js's buildManifest), reused
  // verbatim — never forked.
  const issueForManifest = identity.boundary_kind === "issue-merge-floor" ? identity.boundary_key : null;
  const artifactManifest = buildManifest(runDir, issueForManifest, true);
  const artifactManifestBytes = Buffer.from(JSON.stringify(artifactManifest), "utf8");

  // last_safe_boundary — the one invented member: the recovery pointer. `ts` is the anchor's OWN
  // mint time (the chain-head witness's mtime), never wall-clock-at-publish — a re-publish of the
  // SAME already-minted anchor must produce byte-identical members (the idempotent-no-op
  // invariant), which a fresh `new Date()` on every call would silently break.
  const chainHeadPath = path.join(anchor.dir, "chain-head.json");
  let anchorTs;
  try { anchorTs = fs.statSync(chainHeadPath).mtime.toISOString(); }
  catch { anchorTs = fs.statSync(anchor.dir).mtime.toISOString(); }
  const lastSafeBoundary = {
    boundary_kind: identity.boundary_kind,
    boundary_key: identity.boundary_key,
    run_segment_id: identity.run_segment_id,
    boundary_seq: identity.boundary_seq,
    anchor_ref: anchor.relDir,
    ts: anchorTs,
  };
  const lastSafeBoundaryBytes = Buffer.from(JSON.stringify(lastSafeBoundary), "utf8");

  // redaction — metadata only: never a secret value.
  const secretValues = resolveKnownSecretValues(root);
  const redactionBytes = Buffer.from(JSON.stringify({ ran: true, placeholder: REDACTED_PLACEHOLDER, applied_count: secretValues.length }), "utf8");

  // contract_fingerprint — FAFF-845: the mint-time governance posture plus the publisher's local
  // contract-schema hashes, capture-now-or-never facts a drifted recovering box cannot
  // reconstruct after the fact. Posture is read off the SAME already-parsed ledgerObj — never a
  // second run-ledger.json read (mirrors run_segment_id's own rule above). Every posture field is
  // null-tolerant (?? null): a missing field folds to null and the mint never throws.
  const posture = {
    dial_profile: ledgerObj.dial_profile ?? null,
    floor: ledgerObj.floor ?? null,
    corrective_authority: ledgerObj.corrective_authority ?? null,
    prd_creative_licence: ledgerObj.prd_creative_licence ?? null,
  };
  // contract_schema_versions — one sha256 per CONTRACTS name, sorted, resolved via the SAME
  // path.resolve(HERE, "..", "contracts", "<name>.schema.json") form contract-defs.js uses, so
  // the two can never drift. A missing/unreadable schema file stores null, never throws.
  const schemaMap = {};
  for (const name of Object.keys(CONTRACTS).sort()) {
    const schemaPath = path.resolve(HERE, "..", "contracts", `${name}.schema.json`);
    try { schemaMap[name] = sha256(fs.readFileSync(schemaPath)); }
    catch { schemaMap[name] = null; }
  }
  const fingerprintInputs = { version: "cf1", posture, contract_schema_versions: schemaMap };
  const fingerprint = { digest: sha256(Buffer.from(canonicalJSON(fingerprintInputs), "utf8")), inputs: fingerprintInputs };
  const contractFingerprintBytes = Buffer.from(canonicalJSON(fingerprint), "utf8");

  const memberBytes = {
    ledger_snapshot: ledgerBytes,
    admitted_outcomes: admittedOutcomesBytes,
    anchors: anchorsBytes,
    artifact_manifest: artifactManifestBytes,
    last_safe_boundary: lastSafeBoundaryBytes,
    redaction: redactionBytes,
    contract_fingerprint: contractFingerprintBytes,
  };
  const memberRefs = {};
  for (const [name, bytes] of Object.entries(memberBytes)) memberRefs[name] = { sha256: sha256(bytes), bytes_len: bytes.length };
  const bundle_manifest_digest = sha256(Buffer.from(canonicalJSON(memberRefs), "utf8"));
  const manifest = { version: BUNDLE_MANIFEST_VERSION, identity, members: memberRefs, bundle_manifest_digest };
  return { manifest, memberBytes };
}

// ---------------------------------------------------------------------------
// Pure core: classifyBundle(read) — the fail-closed verdict ladder (spec §4). `read` carries
// ALREADY-fetched bytes from the store (assembled by the I-O shell below) — this function makes
// no store/network call. Local temp-fs materialisation to re-run diffAgainstManifest/
// verifyChain/verifyEffectsChain is the "reuse, never fork" seam; it touches no store.
// ---------------------------------------------------------------------------
function bundleVerdict(verdict, identity, cause, superseded_by = null) {
  return { verdict, identity, cause, superseded_by };
}

// Sub-manifest containing only the members that overlap the bundle's own member set (run-
// ledger.json <- ledger_snapshot, events.jsonl <- the anchors' own copy) — the artifact_manifest
// enumerates the runDir's full corrective/+per-issue evidence set, most of which this minimal
// 7-member bundle deliberately does not carry (FAFF-819 spec §2 out-of-scope), so a raw
// diffAgainstManifest over the FULL manifest would spuriously flag every un-bundled path as
// "disappeared". Checking the genuine overlap still catches a real tamper (ledger_snapshot edited
// without updating artifact_manifest, or vice versa) via the SAME unforked function.
function overlapManifest(fullManifest) {
  const keep = ["run-ledger.json", "events.jsonl"];
  const members = {};
  if (fullManifest && fullManifest.members) for (const k of keep) if (fullManifest.members[k]) members[k] = fullManifest.members[k];
  return { version: (fullManifest && fullManifest.version) || "d1", grain: (fullManifest && fullManifest.grain) || "run", members };
}

function withTempDir(fn) {
  const os = require("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "faff-bundle-verify-"));
  try { return fn(dir); }
  finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ } }
}

// FAFF-876 — deterministic (sorted) search for the first events.jsonl nested one level under
// `root` (a materialised run-close anchor tree's per-issue subdirs: <root>/<issue>/events.jsonl).
// Returns null when none exists (e.g. an all-parked run with zero admitted issues) — the caller
// then leaves the cross-check's tmp/events.jsonl unwritten, same as any other absent member.
function firstNestedEventsPath(root) {
  let names;
  try { names = fs.readdirSync(root).sort(); } catch { return null; }
  for (const name of names) {
    const candidate = path.join(root, name, "events.jsonl");
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function classifyBundle(read) {
  const identity = read && read.identity;
  if (!read || read.headStatus === "bundle-unreadable" || read.headStatus === "store-unreachable") {
    return bundleVerdict("VERIFICATION_UNAVAILABLE", identity || null, (read && read.headStatus) || "store-unreachable");
  }
  if (read.headStatus === "bundle-missing") return bundleVerdict("MISSING", identity, "bundle-missing");
  if (read.headStatus === "bundle-malformed") return bundleVerdict("MALFORMED", identity, "manifest-malformed");

  // FAFF-845 — the version gate: b1 -> the shipped 6, b2 -> those 6 plus contract_fingerprint,
  // absent/unknown -> b1 (never a false MISSING on an already-published b1 bundle).
  const required = requiredMembersFor(read.version);
  const members = read.members || {};
  for (const name of required) {
    if (!members[name] || members[name].status === "missing") return bundleVerdict("MISSING", identity, name);
  }
  for (const name of required) {
    if (members[name].status !== "ok") return bundleVerdict("MALFORMED", identity, name);
  }
  const parsed = {};
  for (const name of required) {
    try { parsed[name] = JSON.parse(members[name].bytes.toString("utf8")); }
    catch { return bundleVerdict("MALFORMED", identity, name); }
  }
  if (!parsed.anchors || typeof parsed.anchors !== "object" || typeof parsed.anchors.files !== "object") {
    return bundleVerdict("MALFORMED", identity, "anchors");
  }

  // Recompute per-member digests + the top manifest digest — never trust the store's own claim.
  const recomputedRefs = {};
  for (const name of required) recomputedRefs[name] = { sha256: sha256(members[name].bytes), bytes_len: members[name].bytes.length };
  const recomputedDigest = sha256(Buffer.from(canonicalJSON(recomputedRefs), "utf8"));
  if (recomputedDigest !== read.headDigest) return bundleVerdict("TAMPERED", identity, "manifest-digest");
  if (read.manifestMemberRefs) {
    for (const name of required) {
      const claimed = read.manifestMemberRefs[name];
      if (claimed && claimed.sha256 !== recomputedRefs[name].sha256) return bundleVerdict("TAMPERED", identity, name);
    }
  }

  // FAFF-865 — validate EVERY anchor key before materialising ANY file below. A CLEAN/verified
  // manifest digest proves the anchors member's bytes are unmodified; it proves nothing about
  // the rel-paths encoded inside those bytes being safe to join onto a real directory. Reject
  // before withTempDir ever runs, so a hostile key never reaches disk even transiently — the
  // same containment posture bundle-recover.js's reconstructProjection already enforces.
  for (const rel of Object.keys(parsed.anchors.files)) {
    if (!isSafeAnchorRelPath(rel)) return bundleVerdict("MALFORMED", identity, "anchors-unsafe-path");
  }

  // Reused tamper primitives — materialise the overlap + the anchor tree into a scratch dir.
  const tamperResult = withTempDir((tmp) => {
    fs.writeFileSync(path.join(tmp, "run-ledger.json"), members.ledger_snapshot.bytes);
    const anchorTmp = path.join(tmp, "anchor");
    fs.mkdirSync(anchorTmp, { recursive: true });
    for (const [rel, b64] of Object.entries(parsed.anchors.files)) {
      const dest = path.join(anchorTmp, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, Buffer.from(b64, "base64"));
    }
    // hasOwnProperty, never a truthiness check — an empty (but PRESENT) events.jsonl base64-
    // decodes to "", which is falsy and would wrongly read as absent.
    // FAFF-876 — a run-close anchor tree has no flat root-level events.jsonl (the run-anchor
    // root nests one verbatim copy per admitted issue subdir, never a copy at its own root —
    // see readAnchorDir). Every per-issue copy is byte-identical (mintIssueAnchor always
    // copies the SAME run-level events.jsonl), so the first one found (deterministic, sorted)
    // suffices for this cross-check; issue-merge-floor keeps its unchanged flat-root lookup.
    const anchorEventsPath = identity.boundary_kind === "run-close"
      ? firstNestedEventsPath(anchorTmp)
      : path.join(anchorTmp, "events.jsonl");
    if (anchorEventsPath && fs.existsSync(anchorEventsPath)) fs.copyFileSync(anchorEventsPath, path.join(tmp, "events.jsonl"));
    const diffs = diffAgainstManifest(tmp, overlapManifest(parsed.artifact_manifest));
    if (diffs.length > 0) return { tampered: true, cause: diffs[0] };

    const chain = verifyChain(anchorTmp);
    if (!["verified", "legacy-unverifiable", "mixed"].includes(chain.status)) return { tampered: true, cause: "events-chain" };
    const effects = verifyEffectsChain(anchorTmp);
    if (!["verified", "legacy-unverifiable", "mixed"].includes(effects.status)) return { tampered: true, cause: "effects-chain" };
    return { tampered: false };
  });
  if (tamperResult.tampered) return bundleVerdict("TAMPERED", identity, tamperResult.cause);

  // FAFF-845 — additive deep cross-check for contract_fingerprint (b2 only), over BUNDLE-CARRIED
  // bytes only: recompute the digest from the member's own inputs, and compare inputs.posture
  // against the posture read off the ALREADY-VERIFIED ledger_snapshot member. Never recomputes
  // contract_schema_versions from the verifying box's local contracts/ — publisher-vs-recoverer
  // schema drift is exactly what this member records, so a local re-derivation would false-flag
  // TAMPERED on a box whose shipped schemas simply differ.
  if (required.includes("contract_fingerprint")) {
    const fp = parsed.contract_fingerprint;
    if (!fp || typeof fp !== "object" || !fp.inputs || typeof fp.inputs !== "object" || typeof fp.digest !== "string") {
      return bundleVerdict("TAMPERED", identity, "contract_fingerprint");
    }
    if (sha256(Buffer.from(canonicalJSON(fp.inputs), "utf8")) !== fp.digest) {
      return bundleVerdict("TAMPERED", identity, "contract_fingerprint");
    }
    const ledgerSnapshot = (parsed.ledger_snapshot && typeof parsed.ledger_snapshot === "object") ? parsed.ledger_snapshot : {};
    const posture = {
      dial_profile: ledgerSnapshot.dial_profile ?? null,
      floor: ledgerSnapshot.floor ?? null,
      corrective_authority: ledgerSnapshot.corrective_authority ?? null,
      prd_creative_licence: ledgerSnapshot.prd_creative_licence ?? null,
    };
    if (canonicalJSON(fp.inputs.posture ?? null) !== canonicalJSON(posture)) {
      return bundleVerdict("TAMPERED", identity, "contract_fingerprint");
    }
  }

  const superseded_by = deriveSupersededBy(identity, read.laterBoundaries || []);
  if (superseded_by) return bundleVerdict("STALE", identity, "superseded", superseded_by);
  return bundleVerdict("CLEAN", identity, "clean");
}

// Staleness precedence (spec §4): a per-issue boundary is superseded by a higher-boundary_seq
// per-issue boundary in the same segment, and ANY per-issue boundary is superseded by a run-close
// boundary. `candidates` is the raw listBoundaries() result for (identity.run_id,
// identity.run_segment_id) — pure over caller-supplied data, no store/network call.
function deriveSupersededBy(identity, candidates) {
  if (!identity || identity.boundary_kind !== "issue-merge-floor") return null;
  const later = (candidates || []).filter((c) => c.boundary_kind === "issue-merge-floor" && c.boundary_seq > identity.boundary_seq);
  if (later.length) {
    later.sort((a, b) => b.boundary_seq - a.boundary_seq);
    return { run_id: identity.run_id, run_segment_id: identity.run_segment_id, boundary_kind: later[0].boundary_kind, boundary_key: later[0].boundary_key, boundary_seq: later[0].boundary_seq };
  }
  const runClose = (candidates || []).find((c) => c.boundary_kind === "run-close");
  if (runClose) return { run_id: identity.run_id, run_segment_id: identity.run_segment_id, boundary_kind: "run-close", boundary_key: "run-close", boundary_seq: runClose.boundary_seq };
  return null;
}

// ---------------------------------------------------------------------------
// BundleStore occupants — put/headDigest/member/listBoundaries, the one fixed contract every
// occupant satisfies (spec §3). The publisher/verifier below hold NO store-specific logic.
// ---------------------------------------------------------------------------

// --- local occupant (default): nothing leaves the box ---
function localBundleSegDir(root, run_id, run_segment_id) {
  return path.join(root, ".faff", "bundles", run_id, `seg-${run_segment_id}`);
}
function localBundleDir(root, identity) {
  return path.join(localBundleSegDir(root, identity.run_id, identity.run_segment_id), identity.boundary_key);
}

// Read an already-materialised bundle dir's manifest.json and classify it against the digest
// this `put` was about to write — shared by the pre-write check and the race-recovery path
// below, so both apply the identical idempotent/conflict rule.
function localExistingBundleResult(dir, wantDigest) {
  let existing;
  try { existing = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")); }
  catch (e) { return { ok: false, reason: "identity-conflict", detail: `existing bundle at ${dir} is unreadable: ${e.message}` }; }
  if (existing && existing.bundle_manifest_digest === wantDigest) return { ok: true, idempotent: true };
  return { ok: false, reason: "identity-conflict", detail: `a different bundle already exists at ${dir} (write-once — never overwritten)` };
}

function localBundleStore(root) {
  return {
    name: "local",
    put(identity, memberBytesMap, manifest) {
      const dir = localBundleDir(root, identity);
      if (fs.existsSync(dir)) return localExistingBundleResult(dir, manifest.bundle_manifest_digest);
      const tmp = `${dir}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      fs.mkdirSync(tmp, { recursive: true });
      for (const [name, bytes] of Object.entries(memberBytesMap)) fs.writeFileSync(path.join(tmp, `${name}.bin`), bytes);
      fs.writeFileSync(path.join(tmp, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      // Atomic on the same filesystem — the whole bundle appears at once. A genuine concurrent
      // publish of the SAME identity can lose the existsSync-vs-rename race (both racers pass the
      // check above before either renames): the loser's target now exists (non-empty), so
      // renameSync throws ENOTEMPTY/EEXIST rather than silently overwriting. Recover exactly like
      // the pre-check above — idempotent on a matching digest, identity-conflict otherwise — never
      // let a race surface as an uncaught fs exception or a silent overwrite.
      try {
        fs.renameSync(tmp, dir);
      } catch (e) {
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort cleanup of the losing racer's own tmp dir */ }
        if ((e.code === "ENOTEMPTY" || e.code === "EEXIST") && fs.existsSync(dir)) return localExistingBundleResult(dir, manifest.bundle_manifest_digest);
        throw e;
      }
      return { ok: true, idempotent: false };
    },
    headDigest(identity) {
      const dir = localBundleDir(root, identity);
      let raw;
      try { raw = fs.readFileSync(path.join(dir, "manifest.json"), "utf8"); }
      catch (e) { return { status: e.code === "ENOENT" ? "bundle-missing" : "bundle-unreadable" }; }
      let parsed;
      try { parsed = JSON.parse(raw); } catch { return { status: "bundle-malformed" }; }
      if (!parsed || typeof parsed.bundle_manifest_digest !== "string" || typeof parsed.members !== "object") return { status: "bundle-malformed" };
      return { status: "ok", digest: parsed.bundle_manifest_digest, memberRefs: parsed.members, identity: parsed.identity, version: parsed.version };
    },
    member(identity, name) {
      const dir = localBundleDir(root, identity);
      try { return { status: "ok", bytes: fs.readFileSync(path.join(dir, `${name}.bin`)) }; }
      catch (e) { return { status: e.code === "ENOENT" ? "missing" : "unreadable" }; }
    },
    listBoundaries(run_id, run_segment_id) {
      const segDir = localBundleSegDir(root, run_id, run_segment_id);
      let names;
      try { names = fs.readdirSync(segDir); } catch { return []; }
      const out = [];
      for (const n of names) {
        try {
          const m = JSON.parse(fs.readFileSync(path.join(segDir, n, "manifest.json"), "utf8"));
          if (m && m.identity) out.push({ boundary_kind: m.identity.boundary_kind, boundary_key: m.identity.boundary_key, boundary_seq: m.identity.boundary_seq });
        } catch { /* an unreadable sibling is skipped, not fatal to the listing */ }
      }
      return out;
    },
  };
}

// --- git-remote occupant: extends the local shape with an off-box push to a dedicated,
// write-once orphan ref (spec §3/§4). Reads are checkout-free (git fetch + git show), mirroring
// resolveAnchorLevel's model (merge-gate.js). Uses the git binary directly — a same-family
// mitigation to the corrective-integrity/integrity-digest absolute-tool posture is out of scope
// here (git plumbing, not a hash tool); PATH resolution is acceptable for this occupant.
function bundleRefName(identity) {
  return `refs/faff/bundles/${identity.run_id}/seg-${identity.run_segment_id}/${identity.boundary_key}`;
}
const STORE_UNAVAILABLE_RE = /no such remote|does not appear to be a git repository|could not read from remote|permission denied|repository not found|timed out|could not resolve host|unable to access|connection (refused|timed out)|fatal: unable to connect/i;

function gitRun(root, args, input) {
  return spawnSync("git", ["-C", root, ...args], { input });
}
function gitRunText(root, args, input) {
  return spawnSync("git", ["-C", root, ...args], { input, encoding: "utf8" });
}

function gitReadRefManifest(root, remoteName, ref) {
  const ls = gitRunText(root, ["ls-remote", remoteName, ref]);
  if (ls.status !== 0 || ls.error) return { status: "store-unreachable" };
  const line = ls.stdout.trim();
  if (!line) return { status: "bundle-missing" };
  const sha = line.split(/\s+/)[0];
  const fetch = gitRunText(root, ["fetch", "--no-tags", remoteName, ref]);
  if (fetch.status !== 0) return { status: "bundle-unreadable" };
  const show = gitRun(root, ["show", `${sha}:manifest.json`]);
  if (show.status !== 0) return { status: "bundle-unreadable" };
  let parsed;
  try { parsed = JSON.parse(show.stdout.toString("utf8")); } catch { return { status: "bundle-malformed" }; }
  if (!parsed || typeof parsed.bundle_manifest_digest !== "string" || typeof parsed.members !== "object") return { status: "bundle-malformed" };
  return { status: "ok", digest: parsed.bundle_manifest_digest, memberRefs: parsed.members, identity: parsed.identity, version: parsed.version, commitSha: sha };
}

function gitRemoteBundleStore(root, remoteName = "origin") {
  return {
    name: "git-remote",
    put(identity, memberBytesMap, manifest) {
      const ref = bundleRefName(identity);
      const existing = gitReadRefManifest(root, remoteName, ref);
      if (existing.status === "store-unreachable") return { ok: false, reason: "store_unavailable", detail: "cannot reach the configured remote to check the identity" };
      if (existing.status === "ok") {
        return existing.digest === manifest.bundle_manifest_digest
          ? { ok: true, idempotent: true }
          : { ok: false, reason: "identity-conflict", detail: `${ref} already exists with a different digest (write-once — never overwritten)` };
      }
      // bundle-missing (or a benign malformed/unreadable prior partial write we still refuse to
      // silently overwrite via a normal push) — proceed to build and push a fresh orphan commit.
      if (existing.status !== "bundle-missing") return { ok: false, reason: "identity-conflict", detail: `${ref} exists but its manifest could not be read cleanly` };

      const blobShas = {};
      for (const [name, bytes] of Object.entries(memberBytesMap)) {
        const h = gitRunText(root, ["hash-object", "-w", "--stdin"], bytes);
        if (h.status !== 0) throw new Error(`git hash-object failed for ${name}: ${h.stderr}`);
        blobShas[`${name}.bin`] = h.stdout.trim();
      }
      const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8");
      const hManifest = gitRunText(root, ["hash-object", "-w", "--stdin"], manifestBytes);
      if (hManifest.status !== 0) throw new Error(`git hash-object failed for manifest.json: ${hManifest.stderr}`);
      blobShas["manifest.json"] = hManifest.stdout.trim();

      const treeInput = Object.entries(blobShas).map(([name, sha]) => `100644 blob ${sha}\t${name}`).join("\n") + "\n";
      const mktree = gitRunText(root, ["mktree"], treeInput);
      if (mktree.status !== 0) throw new Error(`git mktree failed: ${mktree.stderr}`);
      const treeSha = mktree.stdout.trim();

      const commitMsg = `bundle ${identity.run_id}/seg-${identity.run_segment_id}/${identity.boundary_key}`;
      const commitTree = gitRunText(root, ["commit-tree", treeSha, "-m", commitMsg]);
      if (commitTree.status !== 0) throw new Error(`git commit-tree failed: ${commitTree.stderr}`);
      const commitSha = commitTree.stdout.trim();

      // Never a branch, never the code commit, never a force-update — a single push to the
      // dedicated per-identity ref. A custom ref (not refs/heads/* or refs/tags/*) opens no PR
      // and triggers no CI.
      const push = gitRunText(root, ["push", remoteName, `${commitSha}:${ref}`]);
      if (push.status !== 0) {
        const stderr = push.stderr || "";
        if (STORE_UNAVAILABLE_RE.test(stderr) || push.error) return { ok: false, reason: "store_unavailable", detail: stderr.trim() || String(push.error) };
        throw new Error(`git push failed for ${ref}: ${stderr}`);
      }
      return { ok: true, idempotent: false };
    },
    headDigest(identity) {
      const r = gitReadRefManifest(root, remoteName, bundleRefName(identity));
      if (r.status === "store-unreachable") return { status: "bundle-unreadable" };
      return r;
    },
    member(identity, name) {
      const ref = bundleRefName(identity);
      const ls = gitRunText(root, ["ls-remote", remoteName, ref]);
      if (ls.status !== 0) return { status: "unreadable" };
      const line = ls.stdout.trim();
      if (!line) return { status: "missing" };
      const sha = line.split(/\s+/)[0];
      const fetch = gitRunText(root, ["fetch", "--no-tags", remoteName, ref]);
      if (fetch.status !== 0) return { status: "unreadable" };
      const show = gitRun(root, ["show", `${sha}:${name}.bin`]);
      if (show.status !== 0) return { status: "missing" };
      return { status: "ok", bytes: show.stdout };
    },
    listBoundaries(run_id, run_segment_id) {
      const pattern = `refs/faff/bundles/${run_id}/seg-${run_segment_id}/*`;
      const ls = gitRunText(root, ["ls-remote", remoteName, pattern]);
      if (ls.status !== 0) return [];
      const out = [];
      for (const line of ls.stdout.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const [sha, refPath] = trimmed.split(/\s+/);
        const boundary_key = refPath.split("/").pop();
        const show = gitRun(root, ["show", `${sha}:manifest.json`]);
        if (show.status !== 0) continue;
        try {
          const m = JSON.parse(show.stdout.toString("utf8"));
          if (m && m.identity) out.push({ boundary_kind: m.identity.boundary_kind, boundary_key: m.identity.boundary_key || boundary_key, boundary_seq: m.identity.boundary_seq });
        } catch { /* an unreadable sibling ref is skipped, not fatal to the listing */ }
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// recoveryClaimStore — FAFF-863: a write-once ref on the git-remote store that gates the
// `lights-out --resume` continuation boundary against a cross-box double-continue. Distinct from
// the BundleStore occupants above (a different ref namespace, a single claim.json member rather
// than a 7-member bundle, and a lease-matched reclaim path the bundle refs never need — bundle
// refs are pure write-once-forever) but built from the SAME primitives (gitRunText, hash-object /
// mktree / commit-tree, STORE_UNAVAILABLE_RE) rather than a second git-plumbing path. There is no
// "local" occupant here: the call site (lights-out.js resumeLightsOut) constructs this store only
// when resolveBundleStoreName(root) === "git-remote" — under the default `local` bundle store,
// single-box resume is already serialised by the run-dir exclusive-create, so there is no
// cross-box surface to gate (the spec's "local store no-op").
// ---------------------------------------------------------------------------
function recoveryClaimRefName(identity) {
  return `refs/faff/recovery-claims/${identity.run_id}/seg-${identity.run_segment_id}`;
}

// Read the claim.json carried by a claim ref's head orphan commit — the claim-ref sibling of
// gitReadRefManifest (bundle refs read manifest.json; claim refs read claim.json). Checkout-free:
// ls-remote finds the head sha, fetch just that ref, `git show` the blob.
function gitReadClaimManifest(root, remoteName, ref) {
  const ls = gitRunText(root, ["ls-remote", remoteName, ref]);
  if (ls.status !== 0 || ls.error) return { status: "store-unreachable" };
  const line = ls.stdout.trim();
  if (!line) return { status: "claim-missing" };
  const sha = line.split(/\s+/)[0];
  const fetch = gitRunText(root, ["fetch", "--no-tags", remoteName, ref]);
  if (fetch.status !== 0) return { status: "claim-unreadable" };
  const show = gitRun(root, ["show", `${sha}:claim.json`]);
  if (show.status !== 0) return { status: "claim-unreadable" };
  let parsed;
  try { parsed = JSON.parse(show.stdout.toString("utf8")); }
  catch { return { status: "claim-malformed" }; }
  if (!parsed || typeof parsed !== "object" || !parsed.owner || typeof parsed.owner !== "object") return { status: "claim-malformed" };
  return { status: "ok", sha, claim: parsed };
}

// Build a single-blob orphan commit carrying claim.json and push it per `pushArgSpec(commitSha)`
// — either a non-force create (`["<sha>:<ref>"]`) or a lease-matched reclaim
// (`["--force-with-lease=<ref>:<staleSha>", "<sha>:<ref>"]`). The exact write-once idiom
// gitRemoteBundleStore.put uses (hash-object / mktree / commit-tree / push), reused rather than
// forked; only the push's own argv differs per caller.
//
// FAFF-889: `commitMsg` is an OPTIONAL parameter — omitted (the recovery-claim binding and the
// bundle selftest's direct lease-race call) it defaults to the byte-identical FAFF-863 message, so
// the recovery path is unchanged; the build-claim binding passes its own `build-claim <issue>
// epoch=<n>` message. The claim object's own shape/order is the caller's concern (spec.buildClaim).
function pushClaimCommit(root, remoteName, ref, claimObj, pushArgSpec, commitMsg) {
  const bytes = Buffer.from(JSON.stringify(claimObj, null, 2) + "\n", "utf8");
  const h = gitRunText(root, ["hash-object", "-w", "--stdin"], bytes);
  if (h.status !== 0) throw new Error(`git hash-object failed for claim.json: ${h.stderr}`);
  const blobSha = h.stdout.trim();
  const treeInput = `100644 blob ${blobSha}\tclaim.json\n`;
  const mktree = gitRunText(root, ["mktree"], treeInput);
  if (mktree.status !== 0) throw new Error(`git mktree failed: ${mktree.stderr}`);
  const treeSha = mktree.stdout.trim();
  const msg = commitMsg != null ? commitMsg : `recovery-claim ${claimObj.run_id}/seg-${claimObj.run_segment_id} epoch=${claimObj.claim_epoch}`;
  const commitTree = gitRunText(root, ["commit-tree", treeSha, "-m", msg]);
  if (commitTree.status !== 0) throw new Error(`git commit-tree failed: ${commitTree.stderr}`);
  const commitSha = commitTree.stdout.trim();
  const push = gitRunText(root, ["push", remoteName, ...pushArgSpec(commitSha)]);
  return { commitSha, push };
}

// ---------------------------------------------------------------------------
// claimStoreCore — FAFF-889: the generalised write-once-ref claim mutex, extracted from the
// FAFF-863 recoveryClaimStore so a SECOND boundary (the build-queue claim) reuses the exact
// acquire / readHolder / confirmHead / reclaimIfStale git plumbing rather than a forked copy.
// The `spec` parametrises ONLY what differs between the two callers:
//   refName(identity)          -> the ref path                       (recovery: recovery-claims; build: build-claims)
//   buildClaim(identity, arg, epoch) -> the full claim.json object   (its shape/key-order is the caller's — recovery stays byte-identical)
//   commitMessage(claim)       -> the orphan commit message          (recovery: "recovery-claim …"; build: "build-claim …")
//   stalePredicate(claim, nowMs, env) -> Bool "is the holder alive?" (recovery: runIsHeld on the frozen snapshot; build: buildClaimStaleAware)
//   name                       -> the returned store's name
// Everything else — the server-side-CAS acquire, the self-session idempotent re-acquire, the
// head-confirm safety pin, the lease-matched reclaim, STORE_UNAVAILABLE_RE handling — is shared.
// `release` (a lease-matched delete) is exposed on the core; the recovery binding OMITS it from its
// returned object (a run segment is monotonic and never released — FAFF-863), the build binding
// keeps it (an issue legitimately returns to Todo and is rebuilt — FAFF-889 §4.2).
// ---------------------------------------------------------------------------
function claimStoreCore(root, remoteName, spec) {
  // Write-once acquire: a non-force `git push <sha>:<ref>`. Git's server-side ref-update
  // atomicity is the compare-and-swap — creating a ref that already exists is rejected as
  // non-fast-forward, so of two racing pushes to the SAME ref exactly one wins.
  function acquire(identity, ownerSnapshot) {
    const ref = spec.refName(identity);
    const existing = gitReadClaimManifest(root, remoteName, ref);
    if (existing.status === "store-unreachable") return { acquired: false, reason: "store_unavailable", detail: "cannot reach the configured remote to check the claim ref" };
    if (existing.status === "ok") {
      // Self-recognition idempotent re-acquire: the SAME session (identical, non-empty
      // session_id — the same identity proof runIsOwned uses elsewhere) already holds this exact
      // claim, most likely because it acquired successfully on a prior attempt but the owner-state
      // write that followed then failed transiently (e.g. LEDGER_LOCKED) and the operator re-ran
      // --resume (or, for a build claim, re-ran `/faff-graft ISSUE-XX`). Without this, a
      // same-session retry would see its own fresh claim as "exists" and refuse for up to
      // heartbeatStaleSecs — a needless self-lockout, since there is no genuine cross-box race
      // here at all. Never fires for a DIFFERENT session (the ordinary contested path below still
      // applies), so it adds no new trust assumption beyond the one runIsOwned's session_id match
      // already relies on.
      const holderSid = existing.claim.owner && existing.claim.owner.session_id;
      if (holderSid && ownerSnapshot.session_id && holderSid === ownerSnapshot.session_id) {
        return { acquired: true, sha: existing.sha, claim: existing.claim, idempotent: true };
      }
      return { acquired: false, reason: "exists", holder: existing.claim, sha: existing.sha };
    }
    if (existing.status !== "claim-missing") return { acquired: false, reason: "store_unavailable", detail: `${ref} exists but its claim could not be read cleanly (${existing.status})` };

    const claimObj = spec.buildClaim(identity, ownerSnapshot, 0);
    let built;
    try { built = pushClaimCommit(root, remoteName, ref, claimObj, (sha) => [`${sha}:${ref}`], spec.commitMessage(claimObj)); }
    catch (e) { return { acquired: false, reason: "error", detail: e.message }; }
    if (built.push.status !== 0) {
      const stderr = built.push.stderr || "";
      if (STORE_UNAVAILABLE_RE.test(stderr) || built.push.error) return { acquired: false, reason: "store_unavailable", detail: stderr.trim() || String(built.push.error) };
      // Non-force push rejected: a racing executor's push landed first — re-read to surface the
      // winning holder, never silently retry.
      const reread = gitReadClaimManifest(root, remoteName, ref);
      if (reread.status === "ok") return { acquired: false, reason: "exists", holder: reread.claim, sha: reread.sha };
      return { acquired: false, reason: "store_unavailable", detail: stderr.trim() || "push rejected and the ref could not be re-read" };
    }
    return { acquired: true, sha: built.commitSha, claim: claimObj };
  }

  function readHolder(identity) {
    const r = gitReadClaimManifest(root, remoteName, spec.refName(identity));
    if (r.status === "store-unreachable") return { status: "store_unavailable" };
    if (r.status === "claim-missing") return { status: "missing" };
    if (r.status !== "ok") return { status: "unreadable" };
    return { status: "ok", sha: r.sha, claim: r.claim };
  }

  // Read-after-write head-confirm (spec: "the safety pin"). The ref head — not any staleness
  // timer — is the single source of truth for who continues. Called immediately before the
  // owner-state write (recovery) / the first irreversible build side effect (build); a mismatch
  // means a reclaimer superseded the claim after acquisition.
  function confirmHead(identity, mySha) {
    const ref = spec.refName(identity);
    const ls = gitRunText(root, ["ls-remote", remoteName, ref]);
    if (ls.status !== 0 || ls.error) return { confirmed: false, reason: "store_unavailable" };
    const line = ls.stdout.trim();
    if (!line) return { confirmed: false, reason: "missing" };
    const sha = line.split(/\s+/)[0];
    return sha === mySha ? { confirmed: true, sha } : { confirmed: false, reason: "superseded", sha };
  }

  // Staleness judged by the spec's OWN predicate (recovery: runIsHeld / heartbeatStaleSecs from
  // runcheck.js on the frozen owner snapshot; build: buildClaimStaleAware — machine-aware,
  // heartbeat-only). Reclaim lands only via a lease-matched `--force-with-lease` CAS against the
  // exact stale sha read here — a live claim is never overwritten (reclaim is only attempted after
  // the staleness verdict below), and two racing reclaimers of the SAME stale sha cannot both win:
  // the first CAS moves the head, the second's lease no longer matches.
  //
  // FAFF-906: this `--force-with-lease` CAS is the answer to the check-then-act TOCTOU BETWEEN TWO
  // RECLAIMERS — it is what makes "two readers both judge the claim stale" resolve to exactly one
  // winner instead of both overwriting. It is NOT the answer to a wrongly-judged-stale LIVE
  // holder — that is a different risk (a bad staleness verdict, closed by `confirmHead`'s own CAS
  // on the true holder's next write, not by this one), and the skew tolerance above is a mitigation
  // for that risk, not for this TOCTOU. Do not conflate the two: the CAS proves "the ref hadn't
  // moved since I read it," never "the holder is actually dead."
  function reclaimIfStale(identity, ownerSnapshot, env) {
    const ref = spec.refName(identity);
    const existing = gitReadClaimManifest(root, remoteName, ref);
    if (existing.status === "store-unreachable") return { reclaimed: false, reason: "store_unavailable" };
    if (existing.status === "claim-missing") {
      // The holder vanished between reads (or there never was one) — nothing stale to reclaim;
      // fall through to a fresh acquire so the caller still gets a claim once the coast is clear.
      const acq = acquire(identity, ownerSnapshot);
      return acq.acquired ? { reclaimed: true, sha: acq.sha, claim: acq.claim } : { reclaimed: false, reason: acq.reason, holder: acq.holder, detail: acq.detail };
    }
    if (existing.status !== "ok") return { reclaimed: false, reason: "store_unavailable", detail: `claim ref unreadable (${existing.status})` };

    // FAFF-906: the tolerance corrects for the READING (reclaiming) machine's clock running ahead
    // of the holder's by up to `toleranceSecs`. It does NOT correct skew in the other direction
    // (holder's clock ahead of reader's — that direction already biases toward "held", the safe
    // direction) and does NOT correct reader-ahead skew beyond `toleranceSecs`: a reader whose
    // clock runs more than `toleranceSecs` ahead of the holder's still misjudges a live holder as
    // stale. This is a best-effort, bounded mitigation, not a guarantee — `confirmHead`'s CAS
    // (below the reclaim write, and on the true holder's own next write) is the actual backstop
    // for a wrong verdict, tolerance or not. `applySkewTolerance` is per-binding, not blanket: only
    // a binding whose reclaim decision carries cross-machine wrong-verdict cost pays the delay
    // (`recoveryClaimStore` opts out with `applySkewTolerance: false` — see its own header comment).
    const toleranceSecs = spec.applySkewTolerance === false ? 0 : resolveClaimClockSkewToleranceSecs(env);
    const skewedNowMs = Date.now() - toleranceSecs * 1000;
    const held = spec.stalePredicate(existing.claim, skewedNowMs, env);
    if (held) return { reclaimed: false, reason: "held", holder: existing.claim, sha: existing.sha };

    const priorClaimEpoch = Number(existing.claim.claim_epoch) || 0;
    const newClaim = spec.buildClaim(identity, ownerSnapshot, priorClaimEpoch + 1);
    let built;
    try { built = pushClaimCommit(root, remoteName, ref, newClaim, (sha) => [`--force-with-lease=${ref}:${existing.sha}`, `${sha}:${ref}`], spec.commitMessage(newClaim)); }
    catch (e) { return { reclaimed: false, reason: "error", detail: e.message }; }
    if (built.push.status !== 0) {
      const stderr = built.push.stderr || "";
      if (STORE_UNAVAILABLE_RE.test(stderr) || built.push.error) return { reclaimed: false, reason: "store_unavailable", detail: stderr.trim() || String(built.push.error) };
      // Lease mismatch: a concurrent reclaimer (or re-acquirer) already moved the ref — re-read to
      // surface the new holder, never a bare --force retry.
      const reread = gitReadClaimManifest(root, remoteName, ref);
      if (reread.status === "ok") return { reclaimed: false, reason: "lease-lost", holder: reread.claim, sha: reread.sha };
      return { reclaimed: false, reason: "store_unavailable", detail: stderr.trim() || "force-with-lease rejected and the ref could not be re-read" };
    }
    return { reclaimed: true, sha: built.commitSha, claim: newClaim };
  }

  // FAFF-889: the release verb the recovery claim never had. A lease-matched DELETE
  // (`git push --force-with-lease=<ref>:<mySha> <remote> :<ref>`) — the ref is deleted ONLY if it
  // still points at the releaser's own claim sha, so a claim a reclaimer already superseded is
  // never deleted (that would re-open the double-build the mutex exists to prevent). No bare
  // `--force` anywhere. A `superseded` no-op is correct behaviour (the reclaimer is the legitimate
  // current holder), a `missing` no-op means the ref is already gone; the next drain's
  // reclaimIfStale backstops a missed release either way.
  function release(identity, mySha) {
    const ref = spec.refName(identity);
    const push = gitRunText(root, ["push", remoteName, `--force-with-lease=${ref}:${mySha}`, `:${ref}`]);
    if (push.status === 0) return { released: true };
    const stderr = push.stderr || "";
    if (STORE_UNAVAILABLE_RE.test(stderr) || push.error) return { released: false, reason: "store_unavailable", detail: stderr.trim() || String(push.error) };
    // Delete rejected: either the lease no longer matches (a reclaimer moved the ref) or the ref
    // is already gone. Re-read to distinguish — never a bare --force retry.
    const reread = gitReadClaimManifest(root, remoteName, ref);
    if (reread.status === "ok") return { released: false, reason: "superseded", holder: reread.claim, sha: reread.sha };
    if (reread.status === "claim-missing") return { released: false, reason: "missing" };
    return { released: false, reason: "store_unavailable", detail: stderr.trim() || "delete rejected and the ref could not be re-read" };
  }

  return { name: spec.name, acquire, readHolder, confirmHead, reclaimIfStale, release };
}

// FAFF-863 binding — a THIN binding over claimStoreCore, byte-identical to today for its caller
// (resumeLightsOut STEP 4b) and the bundle recovery-claim selftest: same `refs/faff/recovery-
// claims/<run_id>/seg-<n>` ref, same `{ run_id, run_segment_id, owner, claim_epoch, claimed_at }`
// claim.json shape and key order, same `recovery-claim …` commit message, same heartbeat-only
// staleness (runIsHeld on the frozen snapshot). `release` is deliberately NOT exposed — a run
// segment is monotonic and claimed once.
function recoveryClaimStore(root, remoteName = "origin") {
  const core = claimStoreCore(root, remoteName, {
    name: "git-remote-recovery-claim",
    refName: (identity) => recoveryClaimRefName(identity),
    buildClaim: (identity, owner, epoch) => ({ run_id: identity.run_id, run_segment_id: identity.run_segment_id, owner, claim_epoch: epoch, claimed_at: new Date().toISOString() }),
    commitMessage: (claim) => `recovery-claim ${claim.run_id}/seg-${claim.run_segment_id} epoch=${claim.claim_epoch}`,
    stalePredicate: (claim, nowMs, env) => require("./runcheck").runIsHeld({ owner: claim.owner }, nowMs, env),
    // FAFF-906: applySkewTolerance: false — NOT a claim that this ref namespace is same-box (it
    // can be read cross-box; see the header comment above this binding). Set false because a wrong
    // verdict here costs one avoided-but-harmless resume attempt (confirmHead's CAS refuses the
    // loser), while on buildClaimStore/landingClaimStore a wrong verdict hands over live,
    // destructive work — see FAFF-906's "Design decision rationale" (ADR-0119) for the full
    // argument. The default (an undeclared applySkewTolerance) stays true elsewhere; this binding
    // is the one deliberate opt-out.
    applySkewTolerance: false,
  });
  // Return WITHOUT `release` — the recovery claim has no release lifecycle.
  return { name: core.name, acquire: core.acquire, readHolder: core.readHolder, confirmHead: core.confirmHead, reclaimIfStale: core.reclaimIfStale };
}

// FAFF-889: resolve claim_ttl_hours from config (the same key claim-verdict.js consumes), used as
// the staleness fallback for a NON-heartbeating (bare human `/faff-graft`) claim.
function resolveClaimTtlHours(root, env) {
  const envRaw = env && env.FAFF_CLAIM_TTL_HOURS; // test/override seam, mirrors FAFF_RUN_HEARTBEAT_STALE_SECS
  if (envRaw != null && String(envRaw).trim() !== "") {
    const n = Number(envRaw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  let raw;
  try { const [cfg] = loadConfig(root); raw = dig(cfg, "claim_ttl_hours"); }
  catch { raw = undefined; }
  const val = (raw === null || raw === undefined || raw === "") ? DEFAULTS["claim_ttl_hours"] : raw;
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? n : 6; // config.js CANONICAL_CONFIG default
}

// FAFF-906: the cross-machine clock-skew tolerance `reclaimIfStale` subtracts from `Date.now()`
// before handing `nowMs` to a binding's `stalePredicate`, so a reader whose clock runs ahead of
// the holder's by up to this many seconds does not misjudge a live, heartbeating holder as stale.
// Env-var-only (no `.faffrc.yaml` key), mirroring FAFF_RUN_HEARTBEAT_STALE_SECS's own precedent.
// A best-effort mitigation, not a guarantee: skew beyond this value is unmitigated (see the WHY
// section of FAFF-906's spec / ADR-0119) — `confirmHead`'s CAS is the actual backstop regardless.
const CLAIM_CLOCK_SKEW_TOLERANCE_SECS_DEFAULT = 60;
function resolveClaimClockSkewToleranceSecs(env) {
  const raw = env && env.FAFF_CLAIM_CLOCK_SKEW_TOLERANCE_SECS;
  if (raw != null && String(raw).trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return CLAIM_CLOCK_SKEW_TOLERANCE_SECS_DEFAULT;
}

// FAFF-889: given a build claim's frozen owner snapshot, resolve its run-dir on THIS filesystem
// (`<root>/.faff/runs/<session_id>`) — the same-box fast path reads that live heartbeat file. Null
// when the owner has no session_id or the run-dir is not present locally (a cross-box owner, or a
// reconstructed-elsewhere run-dir) → the caller falls back to the frozen-snapshot cross-box row.
function defaultResolveClaimRunDir(root, owner) {
  const sid = owner && owner.session_id;
  if (!sid || typeof sid !== "string") return null;
  const cand = path.join(root, ".faff", "runs", sid);
  try { return fs.existsSync(path.join(cand, "run-ledger.json")) ? cand : null; }
  catch { return null; }
}

// FAFF-889 §4.3 — the three-row, heartbeat-only, machine-aware staleness predicate for a BUILD
// claim. Returns true = HELD (alive — do NOT reclaim), false = stale (reclaimable). NEVER probes
// owner.pid (FAFF-233): the recorded pid rolls and a dead recorded pid is no evidence of death.
//   Row 1 — heartbeating:false (a bare human graft, no heartbeating owner) → judge by the
//           claim_ttl_hours AGE, not the 900s heartbeat window (a human build legitimately
//           outlasts the seconds window). Reuses claim-verdict.js's pure age→verdict.
//   Row 2 — SAME BOX (machine_id matches thisMachineId() AND the owner's run-dir resolves
//           locally) → read the LIVE FAFF-355 heartbeat file (fresh), overlay it over the frozen
//           snapshot, and apply runIsHeld — a same-box crashed claim reclaims immediately off the
//           stale live heartbeat, no conservative wait.
//   Row 3 — CROSS BOX (or same-box run-dir gone) → only the FROZEN snapshot is available; apply
//           runIsHeld, which waits out heartbeatStaleSecs.
// `deps` injects thisMachineId / readHeartbeatFile / runIsHeld / resolveClaimRunDir / claimTtlHours
// / myMachineId so the selftest drives every row without a real filesystem, machine id, or config.
function buildClaimStaleAware(root, claim, nowMs, env, deps = {}) {
  const runIsHeld = deps.runIsHeld || require("./runcheck").runIsHeld;

  // Row 1 — non-heartbeating: TTL age.
  if (claim.heartbeating === false) {
    const { claimVerdict } = require("./claim-verdict");
    const ttlHours = deps.claimTtlHours != null ? deps.claimTtlHours : resolveClaimTtlHours(root, env);
    try {
      return claimVerdict(claim.claimed_at, new Date(nowMs).toISOString(), ttlHours).verdict === "live";
    } catch {
      // A malformed claimed_at cannot be judged live → fail-safe toward reclaimable (matches
      // runIsHeld's own "unparseable → not held" direction). The CAS + head-confirm still arbitrate.
      return false;
    }
  }

  // Row 2 — same box: live heartbeat-file read, gated by an explicit machine-id match.
  const myId = deps.myMachineId != null ? deps.myMachineId : (deps.thisMachineId || require("./machine-id").thisMachineId)(env);
  if (claim.machine_id && myId && claim.machine_id === myId) {
    const resolveRunDir = deps.resolveClaimRunDir || defaultResolveClaimRunDir;
    const runDir = resolveRunDir(root, claim.owner);
    if (runDir) {
      const readHb = deps.readHeartbeatFile || require("./heartbeat").readHeartbeatFile;
      const liveHb = readHb(runDir);
      const overlaidOwner = { ...claim.owner, last_heartbeat: liveHb != null ? liveHb : (claim.owner && claim.owner.last_heartbeat) };
      return runIsHeld({ owner: overlaidOwner }, nowMs, env);
    }
    // machine_id matched but the run-dir is gone → fall through to the frozen-snapshot row.
  }

  // Row 3 — cross box (or same-box run-dir gone): frozen snapshot only.
  return runIsHeld({ owner: claim.owner }, nowMs, env);
}

// FAFF-889 build-queue binding — a THIN binding over claimStoreCore. The claim ref lives on
// `origin` (which graft always has), independent of `bundle_store`, so it works under
// `bundle_store: local` and git-only mode alike (§4.1). claim.json adds `machine_id` (collision-
// resistant, from FAFF-891 thisMachineId — gates only the same-box fast path) and `heartbeating`
// (selects the staleness branch). `release` IS exposed — an issue returns to Todo and is rebuilt.
// The second acquire arg is `{ ...ownerSnapshot, machine_id?, heartbeating }` (graft merges them
// in per §4.4); buildClaim destructures the two extras out so `owner` stays the clean snapshot and
// machine_id/heartbeating are its siblings.
function buildClaimStore(root, remoteName = "origin") {
  return claimStoreCore(root, remoteName, {
    name: "git-remote-build-claim",
    refName: (identity) => `refs/faff/build-claims/${identity.issue}`,
    buildClaim: (identity, arg, epoch) => {
      const a = arg || {};
      const { machine_id, heartbeating, ...owner } = a;
      return {
        issue: identity.issue,
        owner,
        machine_id: machine_id != null ? machine_id : require("./machine-id").thisMachineId(),
        heartbeating: heartbeating === true,
        claim_epoch: epoch,
        claimed_at: new Date().toISOString(),
      };
    },
    commitMessage: (claim) => `build-claim ${claim.issue} epoch=${claim.claim_epoch}`,
    stalePredicate: (claim, nowMs, env) => buildClaimStaleAware(root, claim, nowMs, env),
  });
}

// ---------------------------------------------------------------------------
// Store resolution — the top-level `bundle_store` config key (a MODE ENUM, not a slot: slots
// delegate to user-swappable Skills, whereas these occupants are BUILT-IN implementations of the
// fixed BundleStore contract — FAFF-861). The default occupant is "local" (nothing off-box);
// "git-remote" is the built-here distributing swap-in.
// ---------------------------------------------------------------------------
const BUNDLE_STORE_OCCUPANTS = ["local", "git-remote"];

function resolveBundleStoreName(root) {
  const [cfg] = loadConfig(root);
  const raw = dig(cfg, "bundle_store");
  const value = (raw === null || raw === undefined || raw === "") ? (DEFAULTS["bundle_store"] || "local") : String(raw).trim();
  return BUNDLE_STORE_OCCUPANTS.includes(value) ? value : "local"; // unrecognised occupant name -> fail-safe to the local default, never a distributing guess
}

function resolveBundleStore(root) {
  const name = resolveBundleStoreName(root);
  return name === "git-remote" ? gitRemoteBundleStore(root) : localBundleStore(root);
}

// ---------------------------------------------------------------------------
// I-O: publishBundle — resolves the occupant, builds, and writes (spec §4 PROCEDURE publish_bundle).
// ---------------------------------------------------------------------------
function publishBundle(runDir, boundaryKind, boundaryKey, opts = {}) {
  const root = opts.root || findRoot();
  const store = opts.store || resolveBundleStore(root);
  const run_id = path.basename(runDir);

  const idErrsPre = validateIdentityForHandle({ run_id, run_segment_id: 0, boundary_kind: boundaryKind, boundary_key: boundaryKey });
  // run_segment_id is resolved inside buildBundle (from the ledger) — validate only the
  // components known before that read; the full identity is re-validated below.
  const idErrsPreFiltered = idErrsPre.filter((v) => !v.startsWith("run_segment_id"));
  if (idErrsPreFiltered.length) throw new Error(`publishBundle: invalid identity component(s): ${idErrsPreFiltered.join("; ")}`);

  // Resolve boundary_seq — the monotonic sequence scoped to (run_id, run_segment_id), which
  // requires knowing run_segment_id first (it comes from the ledger, via buildBundle). An
  // explicit opts.boundarySeq (tests, or a caller that already knows it) is honoured directly.
  // Otherwise: build ONCE with a placeholder boundary_seq purely to learn run_segment_id from
  // buildBundle's own single ledger read, discard THAT result, then build again with the real
  // boundary_seq for the actual publish — each call independently satisfies "run_segment_id from
  // the same read as ledger_snapshot" for its own output, and only the second call is ever used
  // or written. (A prior cut skipped this probe and defaulted every CLI-driven publish to
  // boundary_seq 0, silently defeating the per-issue-supersedes-per-issue staleness precedence —
  // fixed here.)
  let built;
  if (Number.isInteger(opts.boundarySeq)) {
    built = buildBundle(runDir, { run_id, boundary_kind: boundaryKind, boundary_key: boundaryKey, boundary_seq: opts.boundarySeq }, root);
  } else {
    const probe = buildBundle(runDir, { run_id, boundary_kind: boundaryKind, boundary_key: boundaryKey, boundary_seq: 0 }, root);
    const boundary_seq = nextBoundarySeq(store, run_id, probe.manifest.identity.run_segment_id, boundaryKey);
    built = boundary_seq === 0 ? probe : buildBundle(runDir, { run_id, boundary_kind: boundaryKind, boundary_key: boundaryKey, boundary_seq }, root);
  }
  const { manifest, memberBytes } = built;
  const idErrs = validateIdentityForHandle(manifest.identity);
  if (idErrs.length) throw new Error(`publishBundle: invalid identity component(s): ${idErrs.join("; ")}`);

  const result = store.put(manifest.identity, memberBytes, manifest);
  if (result.ok === false && result.reason === "store_unavailable") {
    // "Emit a run event noting store_unavailable" (spec §4 publish_bundle step 4a) — advisory
    // only, never thrown, never blocks the "return without failing the run" step that follows.
    // A run dir that has moved past its writable window (e.g. a scratch/no-run-dir caller) is a
    // best-effort miss here, not a publish failure — the store_unavailable disposition itself
    // is still returned to the caller either way.
    try {
      appendEventRecord(runDir, run_id, {
        phase: boundaryKind === "run-close" ? "run" : "build",
        type: "bundle-store-unavailable",
        data: { boundary_kind: boundaryKind, boundary_key: boundaryKey, detail: String(result.detail || "").slice(0, 500) },
      });
    } catch { /* best-effort — the store_unavailable disposition is still returned below */ }
  }
  return { ...result, identity: manifest.identity, manifest };
}

// A monotonic boundary_seq scoped to (run_id, run_segment_id) — resolved from the store's own
// listing (best-effort: the occupant's own listBoundaries; a store that cannot list yet — e.g. a
// fresh segment — starts at 0). `run_segment_id` is always a real integer here — the caller
// (publishBundle) resolves it from the ledger first. CRITICAL: a re-publish of the SAME
// boundary_key must get back its OWN existing seq, never a freshly incremented one — otherwise a
// re-publish (matching digest, meant to be an idempotent no-op) would carry a different
// last_safe_boundary.boundary_seq and so a different digest, tripping the store's own
// write-once/identity-conflict guard instead of resolving to idempotent.
function nextBoundarySeq(store, run_id, run_segment_id, boundary_key) {
  const existing = store.listBoundaries(run_id, run_segment_id) || [];
  const mine = existing.find((b) => b.boundary_key === boundary_key);
  if (mine && Number.isInteger(mine.boundary_seq)) return mine.boundary_seq;
  return existing.reduce((max, b) => Math.max(max, Number.isInteger(b.boundary_seq) ? b.boundary_seq : -1), -1) + 1;
}

// ---------------------------------------------------------------------------
// I-O: verifyBundleIdentity — resolves the occupant, fetches bytes, and folds them through the
// PURE classifyBundle ladder (spec §4 PROCEDURE classify_bundle).
// ---------------------------------------------------------------------------
function verifyBundleIdentity(identity, opts = {}) {
  const root = opts.root || findRoot();
  const store = opts.store || resolveBundleStore(root);
  // A verify caller queries by (run_id, run_segment_id, boundary_kind, boundary_key) — the CLI
  // takes no --boundary-seq, since a verifier does not (and should not need to) already know the
  // store-internal ordering. boundary_seq is genuinely unknown until a bundle is actually found;
  // default it to a schema-conformant placeholder for the store lookup and swap in the bundle's
  // OWN recorded identity (real boundary_seq) once a head is actually read.
  const queryIdentity = { ...identity, boundary_seq: Number.isInteger(identity.boundary_seq) ? identity.boundary_seq : 0 };
  const idErrs = validateIdentityForHandle(queryIdentity);
  if (idErrs.length) throw new Error(`verifyBundleIdentity: invalid identity component(s): ${idErrs.join("; ")}`);

  const head = store.headDigest(queryIdentity);
  const resolvedIdentity = (head.status === "ok" && head.identity) ? head.identity : queryIdentity;
  const read = { identity: resolvedIdentity, headStatus: head.status, headDigest: head.digest || null, manifestMemberRefs: head.memberRefs || null, version: head.version, members: {} };
  if (head.status === "ok") {
    for (const name of requiredMembersFor(head.version)) read.members[name] = store.member(queryIdentity, name);
    read.laterBoundaries = store.listBoundaries(queryIdentity.run_id, queryIdentity.run_segment_id) || [];
  }
  return classifyBundle(read);
}

// Verdict -> exit code (spec §4): CLEAN=0, the four determinate non-clean verdicts=1,
// VERIFICATION_UNAVAILABLE=2 — the full six-value verdict is always what's printed.
function bundleExitCode(verdict) {
  if (verdict === "CLEAN") return 0;
  if (verdict === "VERIFICATION_UNAVAILABLE") return 2;
  return 1;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const BUNDLE_SPEC = {
  flags: {
    "--selftest": { arity: 0 }, "--json": { arity: 0 },
    "--run-dir": { arity: 1 }, "--root": { arity: 1 },
    "--boundary-kind": { arity: 1, enum: BUNDLE_BOUNDARY_KINDS },
    "--boundary-key": { arity: 1 },
    "--run-id": { arity: 1 }, "--run-segment-id": { arity: 1 }, "--boundary-seq": { arity: 1 },
  },
  positionals: { min: 0, max: 1, name: "action" },
};

function cmdBundle(args) {
  if (args.includes("--selftest")) return bundleSelftest();
  const { values, positionals, errors } = parseArgs(args, BUNDLE_SPEC);
  if (errors.length) return usageError(errors, "usage: faff bundle <publish|verify> [--run-dir DIR] [--boundary-kind issue-merge-floor|run-close] [--boundary-key KEY] [--run-id ID --run-segment-id N] [--root DIR] [--json]");
  const action = positionals[0];
  const json = !!values["--json"];
  const root = values["--root"] || findRoot();

  if (action === "publish") {
    const runDir = values["--run-dir"];
    const boundaryKind = values["--boundary-kind"];
    const boundaryKey = values["--boundary-key"];
    if (!runDir || !boundaryKind || !boundaryKey) { process.stderr.write("faff bundle publish: --run-dir, --boundary-kind, and --boundary-key are all required\n"); return 2; }
    if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) { process.stderr.write(`faff bundle publish: --run-dir is not a directory: ${runDir}\n`); return 2; }
    try {
      const r = publishBundle(runDir, boundaryKind, boundaryKey, { root });
      if (r.ok === false && r.reason === "store_unavailable") {
        if (json) console.log(JSON.stringify({ published: false, reason: "store_unavailable", detail: r.detail || null }));
        else console.log(`bundle publish: store_unavailable — ${r.detail || "the configured store's backing remote is unreachable"} (run continues locally)`);
        return 0; // never fails the run — the run continues locally (spec §4)
      }
      if (r.ok === false) {
        process.stderr.write(`faff bundle publish: ${r.reason} — ${r.detail || ""}\n`);
        return 1;
      }
      if (json) console.log(JSON.stringify({ published: true, idempotent: !!r.idempotent, identity: r.identity, bundle_manifest_digest: r.manifest.bundle_manifest_digest }));
      else console.log(`bundle publish: ${r.idempotent ? "no-op (already published, matching digest)" : "published"} — ${r.identity.run_id}/seg-${r.identity.run_segment_id}/${r.identity.boundary_key} (${r.manifest.bundle_manifest_digest.slice(0, 12)}…)`);
      return 0;
    } catch (e) {
      process.stderr.write(`faff bundle publish: ${e.message}\n`);
      return 1;
    }
  }

  if (action === "verify") {
    const run_id = values["--run-id"];
    const run_segment_id = values["--run-segment-id"];
    const boundaryKind = values["--boundary-kind"];
    const boundaryKey = values["--boundary-key"];
    if (!run_id || run_segment_id === undefined || !boundaryKind || !boundaryKey) {
      process.stderr.write("faff bundle verify: --run-id, --run-segment-id, --boundary-kind, and --boundary-key are all required\n");
      return 2;
    }
    if (!/^-?\d+$/.test(run_segment_id)) { process.stderr.write("faff bundle verify: --run-segment-id must be an integer\n"); return 2; }
    const identity = { run_id, run_segment_id: Number(run_segment_id), boundary_kind: boundaryKind, boundary_key: boundaryKey };
    let result;
    try {
      result = verifyBundleIdentity(identity, { root });
    } catch (e) {
      process.stderr.write(`faff bundle verify: ${e.message}\n`);
      return 2;
    }
    // Belt-and-braces: the emitted verdict must itself conform to the bundle-verdict contract.
    const { contractData, failLoud } = computeBundleVerdict(result);
    if (failLoud || !contractData || !contractData.conformant) {
      process.stderr.write(`faff bundle verify: internal — emitted verdict non-conformant: ${failLoud || (contractData && contractData.violations.join("; "))}\n`);
      return 2;
    }
    if (json) console.log(JSON.stringify(contractData));
    else console.log(`${contractData.verdict} — ${contractData.cause}${contractData.superseded_by ? ` (superseded by ${contractData.superseded_by.boundary_key})` : ""}`);
    return bundleExitCode(contractData.verdict);
  }

  process.stderr.write("faff bundle: expected one of publish | verify (or --selftest)\n");
  return 2;
}

// ---------------------------------------------------------------------------
// In-memory + scratch-fs selftest — mirrors the sibling governance/factory modules' shape.
// ---------------------------------------------------------------------------
function bundleSelftest() {
  const os = require("node:os");
  let total = 0, fail = 0;
  const ok = (cond, label) => { total++; if (!cond) fail++; console.log(`${cond ? "ok  " : "FAIL"} ${label}`); };

  // --- canonicalJSON: sorted keys at every depth, deterministic ---
  ok(canonicalJSON({ b: 1, a: 2 }) === '{"a":2,"b":1}', "canonicalJSON: sorts top-level keys");
  ok(canonicalJSON({ b: { d: 1, c: 2 } }) === '{"b":{"c":2,"d":1}}', "canonicalJSON: sorts nested keys");
  ok(canonicalJSON([3, 1, 2]) === "[3,1,2]", "canonicalJSON: arrays preserve order (not sorted)");
  ok(canonicalJSON(canonicalJSON({ x: 1 })) === canonicalJSON(canonicalJSON({ x: 1 })), "canonicalJSON: deterministic / idempotent shape");

  // --- validateIdentityForHandle: charset + run-close coupling ---
  const goodId = { run_id: "run-20260101-000000-x", run_segment_id: 0, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 };
  ok(validateIdentityForHandle(goodId).length === 0, "validateIdentityForHandle: well-formed identity passes");
  ok(validateIdentityForHandle({ ...goodId, run_id: "../etc" }).length > 0, "validateIdentityForHandle: '..' segment rejected");
  ok(validateIdentityForHandle({ ...goodId, boundary_key: "a/b" }).length > 0, "validateIdentityForHandle: '/' in boundary_key rejected");
  ok(validateIdentityForHandle({ ...goodId, boundary_kind: "run-close", boundary_key: "run-close" }).length === 0, "validateIdentityForHandle: run-close pairs with boundary_key run-close");
  ok(validateIdentityForHandle({ ...goodId, boundary_kind: "run-close", boundary_key: "FAFF-1" }).length > 0, "validateIdentityForHandle: run-close requires boundary_key === run-close");

  // --- deriveSupersededBy: staleness precedence ---
  const id1 = { run_id: "r", run_segment_id: 0, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 };
  ok(deriveSupersededBy(id1, [{ boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 }]) === null, "deriveSupersededBy: self alone -> not stale");
  const laterIssue = deriveSupersededBy(id1, [
    { boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 },
    { boundary_kind: "issue-merge-floor", boundary_key: "FAFF-2", boundary_seq: 1 },
  ]);
  ok(laterIssue && laterIssue.boundary_key === "FAFF-2", "deriveSupersededBy: superseded by a later per-issue boundary");
  const byRunClose = deriveSupersededBy(id1, [
    { boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 },
    { boundary_kind: "run-close", boundary_key: "run-close", boundary_seq: 5 },
  ]);
  ok(byRunClose && byRunClose.boundary_kind === "run-close", "deriveSupersededBy: any per-issue boundary superseded by run-close");
  const runCloseId = { run_id: "r", run_segment_id: 0, boundary_kind: "run-close", boundary_key: "run-close", boundary_seq: 5 };
  ok(deriveSupersededBy(runCloseId, [{ boundary_kind: "run-close", boundary_key: "run-close", boundary_seq: 5 }]) === null, "deriveSupersededBy: run-close is never itself superseded");

  // --- classifyBundle: the fail-closed ladder over synthetic `read` objects ---
  ok(classifyBundle({ identity: id1, headStatus: "bundle-unreadable" }).verdict === "VERIFICATION_UNAVAILABLE", "classifyBundle: unreadable head -> VERIFICATION_UNAVAILABLE");
  ok(classifyBundle({ identity: id1, headStatus: "store-unreachable" }).verdict === "VERIFICATION_UNAVAILABLE", "classifyBundle: unreachable store -> VERIFICATION_UNAVAILABLE");
  ok(classifyBundle({ identity: id1, headStatus: "bundle-missing" }).verdict === "MISSING", "classifyBundle: bundle-missing -> MISSING");
  ok(classifyBundle({ identity: id1, headStatus: "bundle-malformed" }).verdict === "MALFORMED", "classifyBundle: bundle-malformed manifest -> MALFORMED");
  ok(classifyBundle({ identity: id1, headStatus: "ok", headDigest: "x", members: { ledger_snapshot: { status: "missing" } } }).verdict === "MISSING", "classifyBundle: a required member missing -> MISSING (cause names it)");
  ok(classifyBundle({ identity: id1, headStatus: "ok", headDigest: "x", members: Object.fromEntries(REQUIRED_MEMBERS.map((n) => [n, { status: n === "redaction" ? "unreadable" : "ok", bytes: Buffer.from("{}") }])) }).verdict === "MALFORMED", "classifyBundle: a required member unreadable -> MALFORMED");

  // --- buildBundle + local store + classifyBundle: full round trip in a scratch fixture ---
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-bundle-rt-"));
  try {
    const run_id = "run-selftest-000000-fx";
    const runDir = path.join(tmp, ".faff", "runs", run_id);
    fs.mkdirSync(runDir, { recursive: true });
    const ledger = { admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" }, owner: { epoch: 0, status: "done" } };
    fs.writeFileSync(path.join(runDir, "run-ledger.json"), JSON.stringify(ledger));
    fs.writeFileSync(path.join(runDir, "events.jsonl"), '{"schema":1,"run_id":"' + run_id + '","seq":0,"ts":"2026-01-01T00:00:00.000Z","phase":"run","type":"run-start"}\n');
    fs.mkdirSync(path.join(runDir, "FAFF-1"), { recursive: true });
    fs.writeFileSync(path.join(runDir, "FAFF-1", "ac-checklist.json"), '{"all_verified":true}');

    // Mint the anchor exactly as `faff events anchor` would (the SAME core, reused directly).
    const { mintIssueAnchor } = require("./events");
    const anchorDest = path.join(tmp, ".faff", "anchors", run_id, "FAFF-1");
    const mint = mintIssueAnchor(runDir, "FAFF-1", anchorDest);
    ok(mint.ok, "selftest fixture: anchor minted cleanly");

    const store = localBundleStore(tmp);
    const pub = publishBundle(runDir, "issue-merge-floor", "FAFF-1", { root: tmp, store, boundarySeq: 0 });
    ok(pub.ok === true && !pub.idempotent, "publishBundle: first publish succeeds, not idempotent");
    const verdict1 = verifyBundleIdentity(pub.identity, { root: tmp, store });
    ok(verdict1.verdict === "CLEAN", `publish -> verify round trip is CLEAN (got ${verdict1.verdict}/${verdict1.cause})`);

    // Idempotent re-publish: same digest -> no-op, never a rewrite.
    const pub2 = publishBundle(runDir, "issue-merge-floor", "FAFF-1", { root: tmp, store, boundarySeq: 0 });
    ok(pub2.ok === true && pub2.idempotent === true, "publishBundle: re-publish at the same identity is an idempotent no-op");

    // Tamper: edit the CONTENT of the stored ledger_snapshot member (still valid JSON, so this
    // exercises the digest-mismatch tamper leg specifically, not the malformed-parse leg).
    const memberPath = path.join(localBundleDir(tmp, pub.identity), "ledger_snapshot.bin");
    const original = fs.readFileSync(memberPath);
    const tamperedJson = JSON.stringify({ ...JSON.parse(original.toString("utf8")), owner: { epoch: 999, status: "done" } });
    fs.writeFileSync(memberPath, Buffer.from(tamperedJson));
    const verdictTampered = verifyBundleIdentity(pub.identity, { root: tmp, store });
    ok(verdictTampered.verdict === "TAMPERED", `tampered member -> TAMPERED (got ${verdictTampered.verdict}/${verdictTampered.cause})`);
    fs.writeFileSync(memberPath, original); // restore

    // Missing member -> MISSING.
    const anchorsMemberPath = path.join(localBundleDir(tmp, pub.identity), "anchors.bin");
    const savedAnchors = fs.readFileSync(anchorsMemberPath);
    fs.rmSync(anchorsMemberPath);
    const verdictMissing = verifyBundleIdentity(pub.identity, { root: tmp, store });
    ok(verdictMissing.verdict === "MISSING" && verdictMissing.cause === "anchors", "missing member -> MISSING naming the member");
    fs.writeFileSync(anchorsMemberPath, savedAnchors); // restore

    // A bundle with no store entry at all -> MISSING.
    const verdictNoEntry = verifyBundleIdentity({ run_id, run_segment_id: 0, boundary_kind: "issue-merge-floor", boundary_key: "NO-SUCH-ISSUE" }, { root: tmp, store });
    ok(verdictNoEntry.verdict === "MISSING", "an identity with no published bundle -> MISSING");

    // Staleness: publish a second, later per-issue boundary -> the FIRST reads STALE.
    fs.mkdirSync(path.join(runDir, "FAFF-2"), { recursive: true });
    const anchorDest2 = path.join(tmp, ".faff", "anchors", run_id, "FAFF-2");
    mintIssueAnchor(runDir, "FAFF-2", anchorDest2);
    const pub3 = publishBundle(runDir, "issue-merge-floor", "FAFF-2", { root: tmp, store, boundarySeq: 1 });
    ok(pub3.ok === true, "selftest fixture: second boundary published");
    const verdictStale = verifyBundleIdentity(pub.identity, { root: tmp, store });
    ok(verdictStale.verdict === "STALE" && verdictStale.superseded_by && verdictStale.superseded_by.boundary_key === "FAFF-2", "an earlier per-issue boundary reads STALE once a later one is published");
    const verdictLatestClean = verifyBundleIdentity(pub3.identity, { root: tmp, store });
    ok(verdictLatestClean.verdict === "CLEAN", "the latest per-issue boundary itself stays CLEAN");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // --- git-remote occupant: put/headDigest/member/listBoundaries against a scratch bare repo ---
  const gitTmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-bundle-git-"));
  try {
    const bareRemote = path.join(gitTmp, "remote.git");
    const workRoot = path.join(gitTmp, "work");
    fs.mkdirSync(workRoot, { recursive: true });
    const initBare = spawnSync("git", ["init", "--bare", "-q", bareRemote]);
    const initWork = spawnSync("git", ["-C", workRoot, "init", "-q"]);
    spawnSync("git", ["-C", workRoot, "config", "user.email", "faff-selftest@example.com"]);
    spawnSync("git", ["-C", workRoot, "config", "user.name", "faff-selftest"]);
    spawnSync("git", ["-C", workRoot, "remote", "add", "origin", bareRemote]);
    if (initBare.status === 0 && initWork.status === 0) {
      const run_id2 = "run-selftest-git-000000";
      const runDir2 = path.join(workRoot, ".faff", "runs", run_id2);
      fs.mkdirSync(runDir2, { recursive: true });
      const ledger2 = { admitted: ["FAFF-9"], outcomes: {}, owner: { epoch: 0, status: "running" } };
      fs.writeFileSync(path.join(runDir2, "run-ledger.json"), JSON.stringify(ledger2));
      fs.writeFileSync(path.join(runDir2, "events.jsonl"), "");
      const { mintIssueAnchor: mintFn } = require("./events");
      const anchorDest3 = path.join(workRoot, ".faff", "anchors", run_id2, "FAFF-9");
      mintFn(runDir2, "FAFF-9", anchorDest3);

      const gstore = gitRemoteBundleStore(workRoot, "origin");
      const gpub = publishBundle(runDir2, "issue-merge-floor", "FAFF-9", { root: workRoot, store: gstore, boundarySeq: 0 });
      ok(gpub.ok === true, `git-remote publish succeeds against a scratch bare repo (got ${JSON.stringify(gpub)})`);
      const gverdict = verifyBundleIdentity(gpub.identity, { root: workRoot, store: gstore });
      ok(gverdict.verdict === "CLEAN", `git-remote publish -> verify round trip is CLEAN (got ${gverdict.verdict}/${gverdict.cause})`);
      const gpub2 = publishBundle(runDir2, "issue-merge-floor", "FAFF-9", { root: workRoot, store: gstore, boundarySeq: 0 });
      ok(gpub2.ok === true && gpub2.idempotent === true, "git-remote re-publish at the same identity is an idempotent no-op (no new push)");

      // No PR / no CI surface: the pushed ref is a custom ref, never refs/heads/* or refs/tags/*.
      const refCheck = spawnSync("git", ["-C", workRoot, "ls-remote", "origin", "refs/heads/*"], { encoding: "utf8" });
      ok((refCheck.stdout || "").trim() === "", "git-remote publish creates no branch (no PR/CI surface)");

      // A checkout-free read from a directory with no .faff/runs still resolves CLEAN.
      const freshTmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-bundle-fresh-"));
      try {
        const fetchAll = spawnSync("git", ["-C", freshTmp, "init", "-q"]);
        spawnSync("git", ["-C", freshTmp, "remote", "add", "origin", bareRemote]);
        const gstoreFresh = gitRemoteBundleStore(freshTmp, "origin");
        const gverdictFresh = verifyBundleIdentity(gpub.identity, { root: freshTmp, store: gstoreFresh });
        ok(fetchAll.status === 0 && gverdictFresh.verdict === "CLEAN", `checkout-free verify from a fresh directory (no .faff/runs) is CLEAN (got ${gverdictFresh.verdict})`);
      } finally {
        fs.rmSync(freshTmp, { recursive: true, force: true });
      }

      // store_unavailable: an occupant pointed at a non-existent remote never fails the run.
      const badWorkRoot = path.join(gitTmp, "work-bad");
      fs.mkdirSync(badWorkRoot, { recursive: true });
      spawnSync("git", ["-C", badWorkRoot, "init", "-q"]);
      spawnSync("git", ["-C", badWorkRoot, "remote", "add", "origin", path.join(gitTmp, "nonexistent.git")]);
      const runDirBad = path.join(badWorkRoot, ".faff", "runs", "run-bad");
      fs.mkdirSync(runDirBad, { recursive: true });
      fs.writeFileSync(path.join(runDirBad, "run-ledger.json"), JSON.stringify({ admitted: [], outcomes: {}, owner: { epoch: 0 } }));
      fs.writeFileSync(path.join(runDirBad, "events.jsonl"), "");
      const anchorDestBad = path.join(badWorkRoot, ".faff", "anchors", "run-bad", "FAFF-1");
      require("./events").mintIssueAnchor(runDirBad, "FAFF-1", anchorDestBad);
      const badStore = gitRemoteBundleStore(badWorkRoot, "origin");
      const badPub = publishBundle(runDirBad, "issue-merge-floor", "FAFF-1", { root: badWorkRoot, store: badStore, boundarySeq: 0 });
      ok(badPub.ok === false && badPub.reason === "store_unavailable", `an unreachable remote reports store_unavailable, never throws (got ${JSON.stringify(badPub)})`);
      const badEvents = fs.readFileSync(path.join(runDirBad, "events.jsonl"), "utf8");
      ok(badEvents.includes('"bundle-store-unavailable"') && badEvents.includes("FAFF-1"), "store_unavailable records a run event noting it (spec: never fails the run)");
    } else {
      console.log("skip  git-remote occupant checks (git init unavailable in this environment)");
    }
  } finally {
    fs.rmSync(gitTmp, { recursive: true, force: true });
  }

  // --- recoveryClaimStore (FAFF-863): race / live-block / stale-reclaim / lease-race /
  // head-confirm-defeats-mistimed-reclaim / no-force-overwrite, against a scratch bare remote
  // with two independent work roots standing in for two racing executors. ---
  const claimTmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-recovery-claim-"));
  try {
    const bareRemote = path.join(claimTmp, "remote.git");
    const rootA = path.join(claimTmp, "executor-a");
    const rootB = path.join(claimTmp, "executor-b");
    fs.mkdirSync(rootA, { recursive: true });
    fs.mkdirSync(rootB, { recursive: true });
    const initBare = spawnSync("git", ["init", "--bare", "-q", bareRemote]);
    for (const r of [rootA, rootB]) {
      spawnSync("git", ["-C", r, "init", "-q"]);
      spawnSync("git", ["-C", r, "config", "user.email", "faff-selftest@example.com"]);
      spawnSync("git", ["-C", r, "config", "user.name", "faff-selftest"]);
      spawnSync("git", ["-C", r, "remote", "add", "origin", bareRemote]);
    }
    if (initBare.status === 0) {
      const runId = "run-selftest-claim-000000";
      const storeA = recoveryClaimStore(rootA, "origin");
      const storeB = recoveryClaimStore(rootB, "origin");
      const freshOwner = (sid) => ({ status: "running", epoch: 1, session_id: sid, pid: 1, started_at: new Date().toISOString(), last_heartbeat: new Date().toISOString() });
      const staleOwner = (sid) => ({ status: "running", epoch: 1, session_id: sid, pid: 1, started_at: new Date(Date.now() - 2000000).toISOString(), last_heartbeat: new Date(Date.now() - 2000000).toISOString() });

      // Race → exactly one continues: A and B both attempt acquire on the SAME identity.
      const raceIdentity = { run_id: runId, run_segment_id: 1 };
      const raceA = storeA.acquire(raceIdentity, freshOwner("session-a"));
      const raceB = storeB.acquire(raceIdentity, freshOwner("session-b"));
      const raceWinners = [raceA, raceB].filter((r) => r.acquired === true);
      const raceLosers = [raceA, raceB].filter((r) => r.acquired === false);
      ok(raceWinners.length === 1 && raceLosers.length === 1, `recoveryClaimStore: exactly one of two racing acquires wins (got ${JSON.stringify([raceA.acquired, raceB.acquired])})`);
      ok(raceLosers[0].reason === "exists" && raceLosers[0].holder && raceLosers[0].holder.owner, "recoveryClaimStore: the losing racer's refusal names the winning holder");

      // Live claim blocks: a fresh (held) claim refuses reclaim outright.
      const liveBlock = storeB.reclaimIfStale(raceIdentity, freshOwner("session-c"), process.env);
      ok(liveBlock.reclaimed === false && liveBlock.reason === "held", `recoveryClaimStore: a live (fresh) claim refuses reclaim (got ${JSON.stringify(liveBlock)})`);

      // Stale claim reclaimable: a claim whose frozen last_heartbeat predates heartbeatStaleSecs
      // IS reclaimable, so a genuinely-stuck run is never permanently deadlocked.
      const staleIdentity = { run_id: runId, run_segment_id: 2 };
      const staleAcquire = storeA.acquire(staleIdentity, staleOwner("dead-session"));
      ok(staleAcquire.acquired === true, "recoveryClaimStore selftest fixture: stale-identity claim acquired");
      const reclaim = storeB.reclaimIfStale(staleIdentity, freshOwner("session-b2"), process.env);
      ok(reclaim.reclaimed === true, `recoveryClaimStore: a claim whose frozen heartbeat is stale IS reclaimable (got ${JSON.stringify(reclaim)})`);

      // No double reclaim: two reclaimers who both read the SAME stale head sha before either
      // writes, then both attempt the lease-matched CAS against it — exactly one wins (the
      // second's lease no longer matches once the first's push lands). Exercised at the
      // pushClaimCommit level (module-internal, same closure) to force the genuine race a
      // sequential reclaimIfStale-vs-reclaimIfStale call pair cannot reproduce (the second call
      // would simply observe the first's already-landed fresh claim and refuse as held).
      const leaseRaceIdentity = { run_id: runId, run_segment_id: 3 };
      storeA.acquire(leaseRaceIdentity, staleOwner("dead-session-2"));
      const leaseRef = recoveryClaimRefName(leaseRaceIdentity);
      const preRead = gitReadClaimManifest(rootA, "origin", leaseRef);
      ok(preRead.status === "ok", "recoveryClaimStore selftest fixture: lease-race pre-read finds the stale claim");
      const claimX = { run_id: leaseRaceIdentity.run_id, run_segment_id: leaseRaceIdentity.run_segment_id, owner: freshOwner("reclaimer-x"), claim_epoch: 1, claimed_at: new Date().toISOString() };
      const claimY = { run_id: leaseRaceIdentity.run_id, run_segment_id: leaseRaceIdentity.run_segment_id, owner: freshOwner("reclaimer-y"), claim_epoch: 1, claimed_at: new Date().toISOString() };
      const pushX = pushClaimCommit(rootA, "origin", leaseRef, claimX, (sha) => [`--force-with-lease=${leaseRef}:${preRead.sha}`, `${sha}:${leaseRef}`]);
      const pushY = pushClaimCommit(rootB, "origin", leaseRef, claimY, (sha) => [`--force-with-lease=${leaseRef}:${preRead.sha}`, `${sha}:${leaseRef}`]);
      ok((pushX.push.status === 0) !== (pushY.push.status === 0), `recoveryClaimStore: two lease-matched CAS pushes against the SAME stale sha — exactly one succeeds (got X=${pushX.push.status}, Y=${pushY.push.status})`);

      // Head-confirm defeats a mistimed reclaim: A holds a fresh claim; B (wrongly) judges it
      // stale via an injected near-zero staleness window and reclaims it. A's pre-owner-write
      // head-confirm against its OWN sha must then fail — the ref head, not the staleness
      // verdict, is what actually decides who wins.
      // A's claim carries a heartbeat baked 2s in the past — genuinely LIVE under the default
      // 900s window (an ordinary fresh claim), but B judges staleness through an injected 1s
      // window, under which that same 2s-old heartbeat reads as stale. This reproduces "B
      // wrongly judges A's claim stale" deterministically, with no dependency on real wall-clock
      // elapsing between the acquire and reclaim calls below.
      const hcIdentity = { run_id: runId, run_segment_id: 4 };
      const recentOwner = (sid) => ({ status: "running", epoch: 1, session_id: sid, pid: 1, started_at: new Date(Date.now() - 2000).toISOString(), last_heartbeat: new Date(Date.now() - 2000).toISOString() });
      const hcAcquireA = storeA.acquire(hcIdentity, recentOwner("session-hc-a"));
      ok(hcAcquireA.acquired === true, "recoveryClaimStore selftest fixture: head-confirm scenario claim acquired by A");
      const wrongEnv = { ...process.env, FAFF_RUN_HEARTBEAT_STALE_SECS: "1" };
      const hcReclaimB = storeB.reclaimIfStale(hcIdentity, freshOwner("session-hc-b"), wrongEnv);
      ok(hcReclaimB.reclaimed === true, "recoveryClaimStore selftest fixture: B's mistimed reclaim (injected 1s window) lands");
      const hcConfirmA = storeA.confirmHead(hcIdentity, hcAcquireA.sha);
      ok(hcConfirmA.confirmed === false && hcConfirmA.reason === "superseded", `recoveryClaimStore: A's head-confirm against its own (now-superseded) sha fails after B's mistimed reclaim (got ${JSON.stringify(hcConfirmA)})`);
      const hcConfirmB = storeB.confirmHead(hcIdentity, hcReclaimB.sha);
      ok(hcConfirmB.confirmed === true, "recoveryClaimStore: B's head-confirm against its own (winning) sha succeeds");

      // FAFF-906 QA regression guard: proves recoveryClaimStore's `applySkewTolerance: false` is
      // LOAD-BEARING, not incidental — the identical hcReclaimB scenario (2s-old heartbeat, an
      // injected 1s staleness window) run against a binding that inherits the DEFAULT tolerance
      // (applySkewTolerance omitted -> true) must NOT reclaim: the 60s tolerance shifts
      // skewedNowMs enough that the 2s-old heartbeat reads as still fresh even under the injected
      // 1s window (effective age is negative). A build that dropped `applySkewTolerance: false`
      // from recoveryClaimStore's spec object fails THIS assertion, not just a silently-still-
      // green hcReclaimB above.
      const defaultedToleranceStore = claimStoreCore(rootB, "origin", {
        name: "git-remote-recovery-claim-defaulted-tolerance-selftest",
        refName: (identity) => recoveryClaimRefName(identity),
        buildClaim: (identity, owner, epoch) => ({ run_id: identity.run_id, run_segment_id: identity.run_segment_id, owner, claim_epoch: epoch, claimed_at: new Date().toISOString() }),
        commitMessage: (claim) => `recovery-claim ${claim.run_id}/seg-${claim.run_segment_id} epoch=${claim.claim_epoch}`,
        stalePredicate: (claim, nowMs, env) => require("./runcheck").runIsHeld({ owner: claim.owner }, nowMs, env),
        // applySkewTolerance intentionally OMITTED — exercises the default (true), i.e. what
        // recoveryClaimStore's reclaim would compute if it inherited the tolerance instead of
        // opting out.
      });
      const hcIdentityDefaulted = { run_id: runId, run_segment_id: 6 };
      const hcAcquireADefaulted = storeA.acquire(hcIdentityDefaulted, recentOwner("session-hc-a-defaulted"));
      ok(hcAcquireADefaulted.acquired === true, "recoveryClaimStore selftest fixture: defaulted-tolerance regression-guard claim acquired by A");
      const hcReclaimBDefaulted = defaultedToleranceStore.reclaimIfStale(hcIdentityDefaulted, freshOwner("session-hc-b-defaulted"), wrongEnv);
      ok(hcReclaimBDefaulted.reclaimed === false && hcReclaimBDefaulted.reason === "held", `recoveryClaimStore regression guard: the identical hcReclaimB scenario against a defaulted-tolerance binding does NOT reclaim (got ${JSON.stringify(hcReclaimBDefaulted)})`);

      // No force-overwrite of a live claim: a refused reclaim (the live-block case above) never
      // moves the ref head — a bare --force would have silently replaced it; instead the head is
      // provably unchanged.
      const noOverwriteIdentity = { run_id: runId, run_segment_id: 5 };
      const noOverwriteAcquire = storeA.acquire(noOverwriteIdentity, freshOwner("session-no-ovr"));
      storeB.reclaimIfStale(noOverwriteIdentity, freshOwner("attacker"), process.env); // refused (held)
      const noOverwriteHead = storeA.readHolder(noOverwriteIdentity);
      ok(noOverwriteHead.status === "ok" && noOverwriteHead.sha === noOverwriteAcquire.sha, "recoveryClaimStore: a refused reclaim never moves a live claim's ref head");
    } else {
      console.log("skip  recoveryClaimStore checks (git init unavailable in this environment)");
    }
  } finally {
    fs.rmSync(claimTmp, { recursive: true, force: true });
  }

  // --- CLI exit-code mapping ---
  ok(bundleExitCode("CLEAN") === 0, "bundleExitCode: CLEAN -> 0");
  for (const v of ["STALE", "MISSING", "MALFORMED", "TAMPERED"]) ok(bundleExitCode(v) === 1, `bundleExitCode: ${v} -> 1`);
  ok(bundleExitCode("VERIFICATION_UNAVAILABLE") === 2, "bundleExitCode: VERIFICATION_UNAVAILABLE -> 2");

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${total} checks, ${fail} failed)`);
  return fail ? 1 : 0;
}

// ---------------------------------------------------------------------------
// FAFF-889 — `faff build-claim <acquire|confirm|reclaim|release|read>`: the CLI surface graft's
// Step-5 claim (and tidy's stale-reclaim) drive the buildClaimStore primitive through, the same way
// graft prose already calls `faff eligible` / `faff heartbeat`. The claim ref lives on `origin`
// (default remote), so this works under every bundle_store and in git-only mode.
//   acquire  — acquire the build claim; on `exists`, transparently reclaimIfStale (the §4.4 compose
//              — one prose call, matching resumeLightsOut STEP 4b). exit 0 = won (build), 1 = refuse.
//   confirm  — head-confirm before the first irreversible build side effect. exit 0/1.
//   reclaim  — tidy's stale-reclaim (release+re-acquire is graft's; reclaim is tidy's grooming). exit 0/1.
//   release  — lease-matched delete on a terminal disposition / retry-later. Best-effort: exit 0 always
//              (a superseded/missing no-op is benign; the next drain's reclaim backstops a miss).
//   read     — read the current holder (diagnostic). exit 0.
// Owner snapshot is derived from the run env (FAFF_SESSION_ID / FAFF_RUN_DIR); machine_id from
// thisMachineId(); heartbeating from --heartbeating/--no-heartbeating or, absent a flag, whether
// FAFF_RUN_DIR resolves to a running-owner ledger (a lights-out build) vs a bare human graft.
// ---------------------------------------------------------------------------
// FAFF-889 — the buildClaimStore + buildClaimStaleAware selftest (the build-queue mutex's own
// negative-test harness, the sibling of bundleSelftest's recovery-claim block). Run by
// `faff build-claim --selftest` and the `regions selftest --region factory` sweep. A scratch bare
// remote + two work roots stand in for two racing grafts; the staleness rows are pure/injected.
function buildClaimSelftest() {
  const os = require("node:os");
  let total = 0, fail = 0;
  const ok = (cond, label) => { total++; if (!cond) fail++; console.log(`${cond ? "ok  " : "FAIL"} ${label}`); };

  // --- buildClaimStore: the build-queue mutex (on origin, release lifecycle, machine-aware
  // staleness) against a scratch bare remote. Covers §5 scenarios + §8 DONE / smoke: race→one-
  // winner, claim.json shape, confirmHead, release→re-acquire, release-superseded no-op, crash-
  // after-build missed-release recovery, live-claim refuse, same-session idempotent, store_unavailable. ---
  const buildClaimTmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-build-claim-"));
  try {
    const bareRemote = path.join(buildClaimTmp, "remote.git");
    const rootA = path.join(buildClaimTmp, "graft-a");
    const rootB = path.join(buildClaimTmp, "graft-b");
    fs.mkdirSync(rootA, { recursive: true });
    fs.mkdirSync(rootB, { recursive: true });
    const initBare = spawnSync("git", ["init", "--bare", "-q", bareRemote]);
    for (const r of [rootA, rootB]) {
      spawnSync("git", ["-C", r, "init", "-q"]);
      spawnSync("git", ["-C", r, "config", "user.email", "faff-selftest@example.com"]);
      spawnSync("git", ["-C", r, "config", "user.name", "faff-selftest"]);
      spawnSync("git", ["-C", r, "remote", "add", "origin", bareRemote]);
    }
    if (initBare.status === 0) {
      const storeA = buildClaimStore(rootA, "origin");
      const storeB = buildClaimStore(rootB, "origin");
      // The graft Step-5 second arg: the clean owner snapshot MERGED with machine_id + heartbeating.
      const arg = (sid, machineId, heartbeating, hbAgeMs = 0) => ({ status: "running", epoch: 1, session_id: sid, pid: 1, started_at: new Date().toISOString(), last_heartbeat: new Date(Date.now() - hbAgeMs).toISOString(), machine_id: machineId, heartbeating });

      // Race → exactly one graft builds (§5 scenario 1 / §8 smoke).
      const idX = { issue: "FAFF-X" };
      const acqA = storeA.acquire(idX, arg("sess-a", "machine-A", true));
      const acqB = storeB.acquire(idX, arg("sess-b", "machine-B", true));
      ok(acqA.acquired === true && acqB.acquired === false && acqB.reason === "exists",
        `buildClaimStore: exactly one of two racing grafts wins the build claim (got A=${acqA.acquired}, B=${JSON.stringify([acqB.acquired, acqB.reason])})`);
      ok(acqB.holder && acqB.holder.issue === "FAFF-X" && acqB.holder.machine_id === "machine-A" && acqB.holder.heartbeating === true,
        "buildClaimStore: claim.json carries issue + machine_id + heartbeating (the loser sees the winner's claim)");
      // owner snapshot stays clean — machine_id/heartbeating are its SIBLINGS, not merged into owner.
      ok(acqA.claim.owner && acqA.claim.owner.machine_id === undefined && acqA.claim.owner.heartbeating === undefined && acqA.claim.owner.session_id === "sess-a",
        "buildClaimStore: owner snapshot stays clean; machine_id/heartbeating are its siblings");
      ok(acqA.claim.claim_epoch === 0 && typeof acqA.claim.claimed_at === "string",
        "buildClaimStore: a fresh acquire is claim_epoch 0 with a claimed_at");

      // confirmHead — the safety pin: A's own sha confirms; a wrong sha refuses.
      ok(storeA.confirmHead(idX, acqA.sha).confirmed === true, "buildClaimStore: confirmHead against the winner's own sha succeeds");
      const badConfirm = storeB.confirmHead(idX, "0".repeat(40));
      ok(badConfirm.confirmed === false && badConfirm.reason === "superseded", "buildClaimStore: confirmHead against a wrong sha refuses (superseded)");

      // Release then re-acquire: a re-queued issue is re-claimable (§5 scenario 2 / §8 smoke).
      const rel = storeA.release(idX, acqA.sha);
      ok(rel.released === true, `buildClaimStore: lease-matched release deletes the ref against its own sha (got ${JSON.stringify(rel)})`);
      const reAcq = storeB.acquire(idX, arg("sess-b2", "machine-B", true));
      ok(reAcq.acquired === true, "buildClaimStore: a released issue is re-acquirable on the next drain (no permanent refuse)");

      // release-superseded is a safe no-op: A holds a stale claim, B reclaims, A's release no-ops
      // and B's claim survives (§5 oracle "release superseded is a safe no-op").
      const idS = { issue: "FAFF-S" };
      const sAcq = storeA.acquire(idS, arg("sess-s-a", "machine-A", true, 2000000)); // stale frozen hb
      const sReclaim = storeB.reclaimIfStale(idS, arg("sess-s-b", "machine-B", true), process.env);
      ok(sReclaim.reclaimed === true, "buildClaimStore: a cross-box stale claim is reclaimable via lease-matched CAS");
      const sRel = storeA.release(idS, sAcq.sha);
      ok(sRel.released === false && sRel.reason === "superseded", `buildClaimStore: release against a superseded sha is a safe no-op (got ${JSON.stringify(sRel)})`);
      const stillHeld = storeB.readHolder(idS);
      ok(stillHeld.status === "ok" && stillHeld.sha === sReclaim.sha, "buildClaimStore: the superseding reclaimer's claim is NOT deleted by the loser's release");

      // Crash-after-build missed-release recovery: a stale claim never released self-heals via the
      // next drain's reclaim, epoch++ — the issue is not stranded (§8 crash fixture).
      const idC = { issue: "FAFF-C" };
      const cAcq = storeA.acquire(idC, arg("sess-c-a", "machine-A", true, 2000000));
      ok(cAcq.acquired === true && cAcq.claim.claim_epoch === 0, "buildClaimStore: crash fixture — initial claim epoch 0");
      const cReclaim = storeB.reclaimIfStale(idC, arg("sess-c-b", "machine-B", true), process.env);
      ok(cReclaim.reclaimed === true && cReclaim.claim.claim_epoch === 1,
        `buildClaimStore: a missed release self-heals via the next drain's reclaim, epoch++ (got ${JSON.stringify(cReclaim && cReclaim.claim && cReclaim.claim.claim_epoch)})`);

      // A live (fresh frozen heartbeat) cross-box claim refuses reclaim (§5 scenario 5).
      const idL = { issue: "FAFF-L" };
      storeA.acquire(idL, arg("sess-l-a", "machine-A", true, 0));
      const lReclaim = storeB.reclaimIfStale(idL, arg("sess-l-b", "machine-B", true), process.env);
      ok(lReclaim.reclaimed === false && lReclaim.reason === "held", `buildClaimStore: a live cross-box claim refuses reclaim (got ${JSON.stringify(lReclaim)})`);

      // Same-session idempotent re-acquire (no self-lockout — §8 DONE).
      const idI = { issue: "FAFF-I" };
      const iAcq1 = storeA.acquire(idI, arg("sess-i", "machine-A", true));
      const iAcq2 = storeA.acquire(idI, arg("sess-i", "machine-A", true));
      ok(iAcq1.acquired === true && iAcq2.acquired === true && iAcq2.idempotent === true,
        "buildClaimStore: a same-session re-acquire is idempotent (no self-lockout)");

      // store_unavailable refuses, never builds unguarded (§5 oracle) — an unreachable remote.
      const storeBad = buildClaimStore(rootA, "no-such-remote");
      const badAcq = storeBad.acquire({ issue: "FAFF-U" }, arg("sess-u", "machine-A", true));
      ok(badAcq.acquired === false && badAcq.reason === "store_unavailable",
        `buildClaimStore: an unreachable remote refuses with store_unavailable, never builds unguarded (got ${JSON.stringify(badAcq)})`);

      // git-only parity: the build claim lives on origin regardless of bundle_store.
      ok(storeA.name === "git-remote-build-claim", "buildClaimStore: named store, origin-keyed (bundle_store-independent)");

      // release-if-stale gate (tidy's groom): a FRESH holder reads NOT-stale under the ref's own
      // buildClaimStaleAware (cross-machine_id here → frozen snapshot, fresh hb → held), so tidy
      // would leave it — a live build is never yanked. (The stale→release path is the crash fixture above.)
      const idT = { issue: "FAFF-T" };
      storeA.acquire(idT, arg("sess-t", "machine-A", true, 0));
      const tHolder = storeB.readHolder(idT);
      ok(tHolder.status === "ok" && buildClaimStaleAware(rootB, tHolder.claim, Date.now(), process.env) === true,
        "buildClaimStore: release-if-stale gate leaves a fresh holder (buildClaimStaleAware reads held)");

      // FAFF-906 Problem 1 — cross-box skew tolerance, exercised through reclaimIfStale (real
      // process.env, no injected deps — buildClaimStaleAware's Row 3 cross-box path, matching the
      // sReclaim/cReclaim/lReclaim fixtures above).
      const idSkew1 = { issue: "FAFF-SKEW-920" };
      storeA.acquire(idSkew1, arg("sess-skew1-a", "machine-A", true, 920 * 1000)); // 900s window + 20s into the 60s tolerance
      const skew920 = storeB.reclaimIfStale(idSkew1, arg("sess-skew1-b", "machine-B", true), process.env);
      ok(skew920.reclaimed === false && skew920.reason === "held",
        `buildClaimStore: a cross-box claim 920s stale (20s into the 60s tolerance) is forgiven — reads held (got ${JSON.stringify(skew920)})`);

      const idSkew2 = { issue: "FAFF-SKEW-990" };
      storeA.acquire(idSkew2, arg("sess-skew2-a", "machine-A", true, 990 * 1000)); // 900s window + 90s, past the 60s tolerance
      const skew990 = storeB.reclaimIfStale(idSkew2, arg("sess-skew2-b", "machine-B", true), process.env);
      ok(skew990.reclaimed === true,
        `buildClaimStore: a cross-box claim 990s stale (past the 60s tolerance) is still reclaimable — the tolerance is a bounded grace period, not a permanent deadlock (got ${JSON.stringify(skew990)})`);

      // FAFF-906 QA fix (round 4): a paired two-case pin on the DEFAULT tolerance value itself —
      // case A only pins a LOWER bound (any tolerance >= 59.5s passes, including a buggy 61s
      // default); case B is the paired upper-bound (reclaims only at tolerance <= 60.5s, so a 61s
      // default fails it). Together they pin the default to exactly 60 integer seconds, not merely
      // a floor. Both cases explicitly delete FAFF_RUN_HEARTBEAT_STALE_SECS and
      // FAFF_CLAIM_CLOCK_SKEW_TOLERANCE_SECS from the env passed to reclaimIfStale (never rely on
      // ambient process.env state) so a CI environment that happens to set either cannot silently
      // shift this test's oracle — no injected window override, since the DEFAULT itself is what
      // must be pinned.
      const pinEnv = { ...process.env };
      delete pinEnv.FAFF_RUN_HEARTBEAT_STALE_SECS;
      delete pinEnv.FAFF_CLAIM_CLOCK_SKEW_TOLERANCE_SECS;

      const idPinA = { issue: "FAFF-SKEW-PIN-A" };
      storeA.acquire(idPinA, arg("sess-pinA-a", "machine-A", true, 959500)); // 900s window + 59.5s
      const pinA = storeB.reclaimIfStale(idPinA, arg("sess-pinA-b", "machine-B", true), pinEnv);
      ok(pinA.reclaimed === false && pinA.reason === "held",
        `buildClaimStore: default-tolerance pin, case A (lower bound) — 959500ms stale reads held; a 59s default would reclaim and fail this (got ${JSON.stringify(pinA)})`);

      const idPinB = { issue: "FAFF-SKEW-PIN-B" };
      storeA.acquire(idPinB, arg("sess-pinB-a", "machine-A", true, 960500)); // 900s window + 60.5s
      const pinB = storeB.reclaimIfStale(idPinB, arg("sess-pinB-b", "machine-B", true), pinEnv);
      ok(pinB.reclaimed === true,
        `buildClaimStore: default-tolerance pin, case B (upper bound) — 960500ms stale reclaims; a 61s default would stay held and fail this (got ${JSON.stringify(pinB)})`);

      // FAFF-906 Problem 2 — the build-claims lease race, mirroring the recovery-claims pushX/pushY
      // fixture above: two reclaimers who both read the SAME stale head sha, then both attempt the
      // lease-matched CAS against it — exactly one wins. Exercised at the pushClaimCommit level
      // (module-internal) for the same reason the recovery-claims fixture is: a sequential
      // reclaimIfStale-vs-reclaimIfStale pair cannot reproduce the race (the second call would just
      // observe the first's already-landed fresh claim and refuse as held).
      const idLeaseRace = { issue: "FAFF-LEASE-RACE" };
      storeA.acquire(idLeaseRace, arg("sess-lr-a", "machine-A", true, 2000000)); // stale frozen hb
      const leaseRaceRef = `refs/faff/build-claims/${idLeaseRace.issue}`;
      const preReadBc = gitReadClaimManifest(rootA, "origin", leaseRaceRef);
      ok(preReadBc.status === "ok", "buildClaimStore selftest fixture: lease-race pre-read finds the stale claim");
      const bcClaimX = { issue: idLeaseRace.issue, owner: { session_id: "reclaimer-x" }, machine_id: "machine-X", heartbeating: true, claim_epoch: 1, claimed_at: new Date().toISOString() };
      const bcClaimY = { issue: idLeaseRace.issue, owner: { session_id: "reclaimer-y" }, machine_id: "machine-Y", heartbeating: true, claim_epoch: 1, claimed_at: new Date().toISOString() };
      const bcPushX = pushClaimCommit(rootA, "origin", leaseRaceRef, bcClaimX, (sha) => [`--force-with-lease=${leaseRaceRef}:${preReadBc.sha}`, `${sha}:${leaseRaceRef}`]);
      const bcPushY = pushClaimCommit(rootB, "origin", leaseRaceRef, bcClaimY, (sha) => [`--force-with-lease=${leaseRaceRef}:${preReadBc.sha}`, `${sha}:${leaseRaceRef}`]);
      ok((bcPushX.push.status === 0) !== (bcPushY.push.status === 0),
        `buildClaimStore: two lease-matched CAS pushes against the SAME stale sha on refs/faff/build-claims/<issue> — exactly one succeeds (got X=${bcPushX.push.status}, Y=${bcPushY.push.status})`);
    } else {
      console.log("skip  buildClaimStore checks (git init unavailable in this environment)");
    }
  } finally {
    fs.rmSync(buildClaimTmp, { recursive: true, force: true });
  }

  // --- buildClaimStaleAware: the three-row, heartbeat-only, machine-aware staleness predicate.
  // PURE (injected deps — no real fs / machine id / config). true = held (alive). ---
  {
    const now = Date.parse("2026-06-22T16:00:00Z");
    const iso = (agoS) => new Date(now - agoS * 1000).toISOString();
    const owner = (sid, hbAgoS) => ({ status: "running", epoch: 1, session_id: sid, pid: 1, started_at: iso(10000), last_heartbeat: iso(hbAgoS) });
    const base = (over) => ({ issue: "FAFF-1", machine_id: "M1", heartbeating: true, claim_epoch: 0, claimed_at: iso(3600), owner: owner("s1", 3600), ...over });
    const WINDOW = 900; // heartbeatStaleSecs default (shared-infra RUN_HEARTBEAT_STALE_SECS_DEFAULT)

    // Row 1 — heartbeating:false → judged by claim_ttl_hours AGE (injected 6h), not the window.
    ok(buildClaimStaleAware("/root", base({ heartbeating: false, claimed_at: iso(5 * 3600) }), now, {}, { claimTtlHours: 6 }) === true,
      "buildClaimStaleAware: heartbeating:false within claim_ttl_hours reads held (TTL age)");
    ok(buildClaimStaleAware("/root", base({ heartbeating: false, claimed_at: iso(7 * 3600) }), now, {}, { claimTtlHours: 6 }) === false,
      "buildClaimStaleAware: heartbeating:false past claim_ttl_hours reads stale");

    // Row 2 — same box (machine_id match + run-dir resolves) → the LIVE heartbeat file, NOT the
    // frozen snapshot: fresh live file ⇒ held; stale live file ⇒ stale NOW (no window wait).
    const sbDeps = (liveHbAgoS) => ({ myMachineId: "M1", resolveClaimRunDir: () => "/fake/run", readHeartbeatFile: () => iso(liveHbAgoS) });
    ok(buildClaimStaleAware("/root", base({ owner: owner("s1", 5000) }), now, {}, sbDeps(10)) === true,
      "buildClaimStaleAware: same-box claim with a FRESH live heartbeat file reads held (frozen snapshot ignored)");
    ok(buildClaimStaleAware("/root", base({ owner: owner("s1", 5) }), now, {}, sbDeps(5000)) === false,
      "buildClaimStaleAware: same-box crashed claim (live heartbeat file stale) reads stale immediately — no window wait");

    // Row 2 fall-through — machine_id matches but the run-dir does NOT resolve locally → frozen row.
    ok(buildClaimStaleAware("/root", base({ owner: owner("s1", 5000) }), now, {}, { myMachineId: "M1", resolveClaimRunDir: () => null }) === false,
      "buildClaimStaleAware: same-box machine-id match but no local run-dir falls back to the frozen snapshot");

    // Row 3 — cross box (machine_id mismatch) → frozen snapshot, waits heartbeatStaleSecs.
    ok(buildClaimStaleAware("/root", base({ owner: owner("s1", 10) }), now, {}, { myMachineId: "M2", resolveClaimRunDir: () => "/should/not/read" }) === true,
      "buildClaimStaleAware: cross-box claim with a fresh frozen heartbeat reads held");
    ok(buildClaimStaleAware("/root", base({ owner: owner("s1", 5000) }), now, {}, { myMachineId: "M2" }) === false,
      "buildClaimStaleAware: cross-box claim past heartbeatStaleSecs reads stale");

    // §5 oracle — the heartbeating flag SELECTS the branch: the SAME wall-clock age between the
    // window and the TTL yields OPPOSITE verdicts (false → held by TTL; true → stale by window).
    const ageBetween = 3600; // 1h: > 900s window, < 6h TTL
    const flagFalse = buildClaimStaleAware("/root", base({ heartbeating: false, claimed_at: iso(ageBetween) }), now, {}, { claimTtlHours: 6, myMachineId: "M2" });
    const flagTrue = buildClaimStaleAware("/root", base({ heartbeating: true, owner: owner("s1", ageBetween) }), now, {}, { claimTtlHours: 6, myMachineId: "M2" });
    ok(flagFalse === true && flagTrue === false && WINDOW < 6 * 3600,
      `buildClaimStaleAware: the heartbeating flag selects the staleness branch (window≠TTL ⇒ opposite verdicts; got false-flag=${flagFalse}, true-flag=${flagTrue})`);

    // No pid probe: a stale heartbeat is stale even with a live-looking recorded pid (FAFF-233).
    ok(buildClaimStaleAware("/root", base({ owner: { ...owner("s1", 5000), pid: process.pid } }), now, {}, { myMachineId: "M2" }) === false,
      "buildClaimStaleAware: a stale heartbeat is stale even with a live-looking recorded pid (no pid probe)");
  }

  // --- no claim path issues a bare `git push --force` — every ref move is a non-force create, a
  // --force-with-lease reclaim, or a --force-with-lease delete. ---
  {
    const selfSrc = fs.readFileSync(__filename, "utf8");
    ok(!/["']--force["']/.test(selfSrc), "bundle.js: no bare --force token in any claim path (every force is --force-with-lease)");
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${total} checks, ${fail} failed)`);
  return fail ? 1 : 0;
}

const BUILD_CLAIM_USAGE = "usage: faff build-claim <acquire|confirm|reclaim|release|release-if-stale|read> --issue <ID> [--sha <SHA>] [--session-id <S>] [--heartbeating|--no-heartbeating] [--remote <NAME>] [--root <DIR>] [--json]";
const BUILD_CLAIM_SPEC = {
  flags: {
    "--issue": { arity: 1 }, "--sha": { arity: 1 }, "--session-id": { arity: 1 },
    "--heartbeating": { arity: 0 }, "--no-heartbeating": { arity: 0 },
    "--remote": { arity: 1 }, "--root": { arity: 1 }, "--json": { arity: 0 },
  },
};

function resolveBuildClaimHeartbeating(values, env) {
  if (values["--heartbeating"]) return true;
  if (values["--no-heartbeating"]) return false;
  const rd = env.FAFF_RUN_DIR;
  if (!rd) return false; // a bare human graft — no heartbeating owner
  try {
    const led = JSON.parse(fs.readFileSync(path.join(rd, "run-ledger.json"), "utf8"));
    return !!(led && led.owner && led.owner.status === "running");
  } catch { return false; }
}

function buildClaimOwnerSnapshot(env, values) {
  const nowIso = new Date().toISOString();
  const sid = values["--session-id"] || env.FAFF_SESSION_ID || (env.FAFF_RUN_DIR ? path.basename(env.FAFF_RUN_DIR) : null);
  return { status: "running", epoch: Number(env.FAFF_OWNER_EPOCH) || 1, session_id: sid, pid: process.pid, started_at: nowIso, last_heartbeat: nowIso };
}

function cmdBuildClaim(args) {
  if (args.includes("--selftest")) return buildClaimSelftest();
  const sub = args[0];
  const { values, errors } = parseArgs(args.slice(1), BUILD_CLAIM_SPEC);
  if (errors.length) return usageError(errors, BUILD_CLAIM_USAGE);
  const json = !!values["--json"];
  const issue = values["--issue"];
  const { isValidIssueId } = require("./heartbeat");
  if (!["acquire", "confirm", "reclaim", "release", "release-if-stale", "read"].includes(sub)) {
    process.stderr.write(`build-claim: unknown subcommand ${JSON.stringify(sub)}\n${BUILD_CLAIM_USAGE}\n`);
    return 2;
  }
  if (!issue || !isValidIssueId(issue)) { process.stderr.write(`build-claim ${sub}: --issue <ID> is required and must be a valid issue id\n`); return 2; }

  const root = values["--root"] || findRoot();
  const remote = values["--remote"] || "origin";
  const store = buildClaimStore(root, remote);
  const identity = { issue };
  const out = (obj, code) => { if (json) console.log(JSON.stringify(obj)); else console.log(obj.summary || JSON.stringify(obj)); return code; };

  if (sub === "acquire") {
    const owner = buildClaimOwnerSnapshot(process.env, values);
    const arg = { ...owner, machine_id: require("./machine-id").thisMachineId(process.env), heartbeating: resolveBuildClaimHeartbeating(values, process.env) };
    let r = store.acquire(identity, arg);
    if (!r.acquired && r.reason === "exists") {
      const rc = store.reclaimIfStale(identity, arg, process.env);
      r = rc.reclaimed
        ? { acquired: true, sha: rc.sha, claim: rc.claim, reclaimed: true }
        : { acquired: false, reason: rc.reason, holder: rc.holder, sha: rc.sha, detail: rc.detail };
    }
    const obj = { action: "acquire", issue, acquired: !!r.acquired, reason: r.reason || null, sha: r.sha || null, reclaimed: !!r.reclaimed, epoch: r.claim ? r.claim.claim_epoch : null, holder: r.holder || null, detail: r.detail || null, summary: r.acquired ? `build-claim acquired ${issue} (sha ${String(r.sha).slice(0, 12)}, epoch ${r.claim ? r.claim.claim_epoch : "?"}${r.reclaimed ? ", reclaimed" : ""})` : `build-claim REFUSED ${issue}: ${r.reason}${r.detail ? " — " + r.detail : ""}` };
    return out(obj, r.acquired ? 0 : 1);
  }

  if (sub === "confirm") {
    const sha = values["--sha"];
    if (!sha) { process.stderr.write("build-claim confirm: --sha <SHA> is required\n"); return 2; }
    const r = store.confirmHead(identity, sha);
    return out({ action: "confirm", issue, confirmed: !!r.confirmed, reason: r.reason || null, sha: r.sha || null, summary: r.confirmed ? `build-claim head-confirmed ${issue}` : `build-claim head-confirm FAILED ${issue}: ${r.reason}` }, r.confirmed ? 0 : 1);
  }

  if (sub === "reclaim") {
    const owner = buildClaimOwnerSnapshot(process.env, values);
    const arg = { ...owner, machine_id: require("./machine-id").thisMachineId(process.env), heartbeating: resolveBuildClaimHeartbeating(values, process.env) };
    const r = store.reclaimIfStale(identity, arg, process.env);
    return out({ action: "reclaim", issue, reclaimed: !!r.reclaimed, reason: r.reason || null, sha: r.sha || null, holder: r.holder || null, detail: r.detail || null, summary: r.reclaimed ? `build-claim reclaimed ${issue} (sha ${String(r.sha).slice(0, 12)})` : `build-claim reclaim declined ${issue}: ${r.reason}` }, r.reclaimed ? 0 : 1);
  }

  if (sub === "release") {
    const sha = values["--sha"];
    if (!sha) { process.stderr.write("build-claim release: --sha <SHA> is required\n"); return 2; }
    const r = store.release(identity, sha);
    // Best-effort housekeeping: a superseded/missing no-op is benign, a store_unavailable is
    // transient — either way the next drain's reclaim backstops it, so NEVER halt the pipeline.
    return out({ action: "release", issue, released: !!r.released, reason: r.reason || null, summary: r.released ? `build-claim released ${issue}` : `build-claim release no-op ${issue}: ${r.reason}` }, 0);
  }

  if (sub === "release-if-stale") {
    // tidy's grooming path: release the ref ONLY if the holder is stale under the ref's OWN
    // machine-aware, heartbeat-only buildClaimStaleAware — NEVER on a tracker age alone, so a live
    // heartbeating build (whose tracker claim-age can look hours-stale) is not wrongly yanked.
    // Tidy grooms; it never acquires/takes over the claim to build. Best-effort: exit 0 always.
    const h = store.readHolder(identity);
    if (h.status === "missing") return out({ action: "release-if-stale", issue, released: false, reason: "missing", stale: null, summary: `build-claim release-if-stale ${issue}: no ref` }, 0);
    if (h.status !== "ok") return out({ action: "release-if-stale", issue, released: false, reason: h.status, stale: null, summary: `build-claim release-if-stale ${issue}: ${h.status}` }, 0);
    const held = buildClaimStaleAware(root, h.claim, Date.now(), process.env);
    if (held) return out({ action: "release-if-stale", issue, released: false, reason: "held", stale: false, sha: h.sha, summary: `build-claim release-if-stale ${issue}: holder still live (not released)` }, 0);
    const r = store.release(identity, h.sha);
    return out({ action: "release-if-stale", issue, released: !!r.released, reason: r.reason || null, stale: true, sha: h.sha, summary: r.released ? `build-claim release-if-stale ${issue}: stale claim released` : `build-claim release-if-stale ${issue}: stale, release no-op (${r.reason})` }, 0);
  }

  // read
  const r = store.readHolder(identity);
  return out({ action: "read", issue, status: r.status, sha: r.sha || null, claim: r.claim || null, summary: `build-claim ${issue}: ${r.status}${r.sha ? " (sha " + String(r.sha).slice(0, 12) + ")" : ""}` }, 0);
}

module.exports = {
  BUNDLE_MANIFEST_VERSION, BUNDLE_BOUNDARY_KINDS, BUNDLE_STORE_OCCUPANTS, REQUIRED_MEMBERS,
  REQUIRED_MEMBERS_B1, REQUIRED_MEMBERS_B2, requiredMembersFor,
  canonicalJSON, validateIdentityForHandle, buildBundle, classifyBundle, deriveSupersededBy,
  localBundleStore, gitRemoteBundleStore, bundleRefName, resolveBundleStoreName, resolveBundleStore,
  publishBundle, verifyBundleIdentity, bundleExitCode, cmdBundle, bundleSelftest,
  recoveryClaimRefName, recoveryClaimStore, pushClaimCommit, gitReadClaimManifest,
  claimStoreCore, buildClaimStore, buildClaimStaleAware, resolveClaimTtlHours, resolveClaimClockSkewToleranceSecs, defaultResolveClaimRunDir,
  cmdBuildClaim, buildClaimSelftest,
};
