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
function pushClaimCommit(root, remoteName, ref, claimObj, pushArgSpec) {
  const bytes = Buffer.from(JSON.stringify(claimObj, null, 2) + "\n", "utf8");
  const h = gitRunText(root, ["hash-object", "-w", "--stdin"], bytes);
  if (h.status !== 0) throw new Error(`git hash-object failed for claim.json: ${h.stderr}`);
  const blobSha = h.stdout.trim();
  const treeInput = `100644 blob ${blobSha}\tclaim.json\n`;
  const mktree = gitRunText(root, ["mktree"], treeInput);
  if (mktree.status !== 0) throw new Error(`git mktree failed: ${mktree.stderr}`);
  const treeSha = mktree.stdout.trim();
  const commitMsg = `recovery-claim ${claimObj.run_id}/seg-${claimObj.run_segment_id} epoch=${claimObj.claim_epoch}`;
  const commitTree = gitRunText(root, ["commit-tree", treeSha, "-m", commitMsg]);
  if (commitTree.status !== 0) throw new Error(`git commit-tree failed: ${commitTree.stderr}`);
  const commitSha = commitTree.stdout.trim();
  const push = gitRunText(root, ["push", remoteName, ...pushArgSpec(commitSha)]);
  return { commitSha, push };
}

// The cross-box mutex: acquire / readHolder / confirmHead / reclaimIfStale, all built from
// gitRunText / hash-object / mktree / commit-tree / ls-remote (never a second git-plumbing path).
// identity here is the narrower { run_id, run_segment_id } pair (no boundary_kind/boundary_key —
// the claim ref keys on run segment alone, not a bundle boundary).
function recoveryClaimStore(root, remoteName = "origin") {
  // Write-once acquire: a non-force `git push <sha>:<ref>`. Git's server-side ref-update
  // atomicity is the compare-and-swap — creating a ref that already exists is rejected as
  // non-fast-forward, so of two racing pushes to the SAME ref exactly one wins.
  function acquire(identity, ownerSnapshot) {
    const ref = recoveryClaimRefName(identity);
    const existing = gitReadClaimManifest(root, remoteName, ref);
    if (existing.status === "store-unreachable") return { acquired: false, reason: "store_unavailable", detail: "cannot reach the configured remote to check the claim ref" };
    if (existing.status === "ok") {
      // Self-recognition idempotent re-acquire: the SAME session (identical, non-empty
      // session_id — the same identity proof runIsOwned uses elsewhere) already holds this exact
      // claim, most likely because it acquired successfully on a prior attempt but the owner-state
      // write that followed then failed transiently (e.g. LEDGER_LOCKED) and the operator re-ran
      // --resume. Without this, a same-session retry would see its own fresh claim as "exists" and
      // refuse for up to heartbeatStaleSecs — a needless self-lockout, since there is no genuine
      // cross-box race here at all. Never fires for a DIFFERENT session (the ordinary contested
      // path below still applies), so it adds no new trust assumption beyond the one runIsOwned's
      // session_id match already relies on.
      const holderSid = existing.claim.owner && existing.claim.owner.session_id;
      if (holderSid && ownerSnapshot.session_id && holderSid === ownerSnapshot.session_id) {
        return { acquired: true, sha: existing.sha, claim: existing.claim, idempotent: true };
      }
      return { acquired: false, reason: "exists", holder: existing.claim, sha: existing.sha };
    }
    if (existing.status !== "claim-missing") return { acquired: false, reason: "store_unavailable", detail: `${ref} exists but its claim could not be read cleanly (${existing.status})` };

    const claimObj = { run_id: identity.run_id, run_segment_id: identity.run_segment_id, owner: ownerSnapshot, claim_epoch: 0, claimed_at: new Date().toISOString() };
    let built;
    try { built = pushClaimCommit(root, remoteName, ref, claimObj, (sha) => [`${sha}:${ref}`]); }
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
    const r = gitReadClaimManifest(root, remoteName, recoveryClaimRefName(identity));
    if (r.status === "store-unreachable") return { status: "store_unavailable" };
    if (r.status === "claim-missing") return { status: "missing" };
    if (r.status !== "ok") return { status: "unreadable" };
    return { status: "ok", sha: r.sha, claim: r.claim };
  }

  // Read-after-write head-confirm (spec: "the safety pin"). The ref head — not any staleness
  // timer — is the single source of truth for who continues. Called immediately before the
  // owner-state write; a mismatch means a reclaimer superseded the claim after acquisition.
  function confirmHead(identity, mySha) {
    const ref = recoveryClaimRefName(identity);
    const ls = gitRunText(root, ["ls-remote", remoteName, ref]);
    if (ls.status !== 0 || ls.error) return { confirmed: false, reason: "store_unavailable" };
    const line = ls.stdout.trim();
    if (!line) return { confirmed: false, reason: "missing" };
    const sha = line.split(/\s+/)[0];
    return sha === mySha ? { confirmed: true, sha } : { confirmed: false, reason: "superseded", sha };
  }

  // Staleness judged by the run-ledger's OWN predicate (runIsHeld / heartbeatStaleSecs from
  // runcheck.js — imported, not reimplemented) applied to the claim's frozen owner snapshot.
  // Reclaim lands only via a lease-matched `--force-with-lease` CAS against the exact stale sha
  // read here — a live claim is never overwritten (reclaim is only attempted after the staleness
  // verdict below), and two racing reclaimers of the SAME stale sha cannot both win: the first CAS
  // moves the head, the second's lease no longer matches.
  function reclaimIfStale(identity, ownerSnapshot, env) {
    const ref = recoveryClaimRefName(identity);
    const existing = gitReadClaimManifest(root, remoteName, ref);
    if (existing.status === "store-unreachable") return { reclaimed: false, reason: "store_unavailable" };
    if (existing.status === "claim-missing") {
      // The holder vanished between reads (or there never was one) — nothing stale to reclaim;
      // fall through to a fresh acquire so the caller still gets a claim once the coast is clear.
      const acq = acquire(identity, ownerSnapshot);
      return acq.acquired ? { reclaimed: true, sha: acq.sha, claim: acq.claim } : { reclaimed: false, reason: acq.reason, holder: acq.holder, detail: acq.detail };
    }
    if (existing.status !== "ok") return { reclaimed: false, reason: "store_unavailable", detail: `claim ref unreadable (${existing.status})` };

    const { runIsHeld } = require("./runcheck");
    const held = runIsHeld({ owner: existing.claim.owner }, Date.now(), env);
    if (held) return { reclaimed: false, reason: "held", holder: existing.claim, sha: existing.sha };

    const priorClaimEpoch = Number(existing.claim.claim_epoch) || 0;
    const newClaim = { run_id: identity.run_id, run_segment_id: identity.run_segment_id, owner: ownerSnapshot, claim_epoch: priorClaimEpoch + 1, claimed_at: new Date().toISOString() };
    let built;
    try { built = pushClaimCommit(root, remoteName, ref, newClaim, (sha) => [`--force-with-lease=${ref}:${existing.sha}`, `${sha}:${ref}`]); }
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

  return { name: "git-remote-recovery-claim", acquire, readHolder, confirmHead, reclaimIfStale };
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

module.exports = {
  BUNDLE_MANIFEST_VERSION, BUNDLE_BOUNDARY_KINDS, BUNDLE_STORE_OCCUPANTS, REQUIRED_MEMBERS,
  REQUIRED_MEMBERS_B1, REQUIRED_MEMBERS_B2, requiredMembersFor,
  canonicalJSON, validateIdentityForHandle, buildBundle, classifyBundle, deriveSupersededBy,
  localBundleStore, gitRemoteBundleStore, bundleRefName, resolveBundleStoreName, resolveBundleStore,
  publishBundle, verifyBundleIdentity, bundleExitCode, cmdBundle, bundleSelftest,
  recoveryClaimRefName, recoveryClaimStore, pushClaimCommit, gitReadClaimManifest,
};
