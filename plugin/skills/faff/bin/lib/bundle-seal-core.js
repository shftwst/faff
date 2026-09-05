// ===========================================================================
// === region:factory — bundle-seal-core: FAFF-1000 the denylist-clean sealing core extracted from bundle.js (buildBundle / readAnchorDir / identity validation / the local BundleStore occupant / the b1-b2 required-member gate), shared verbatim by bundle.js and the standalone commissaire facade ===
//
// Why this module exists: two of commissaire.js's facade verbs (audit seal / export) need
// bundle.js's sealing logic in-process, but requiring bundle.js reintroduces the exact
// orchestration require graph FAFF-999's independence guard proved absent (bundle.js requires
// config.js -> backends.js -> harness.js, and contract-defs.js -> run-done.js / run-start.js, all
// denylisted). This module is the narrow slice of that logic with NO denylisted dependency: its
// entire transitive require graph (node:fs, node:path, ./shared-infra, ./integrity-digest, ./redact
// and their own clean deps) reaches no DENYLIST name. bundle.js requires these functions from here
// rather than keeping its own copies — one implementation, matching bundle.js's own "never forked"
// convention. The one substantive divergence from the old bundle.js body is contract_schema_versions
// (see buildBundle): a contracts/*.schema.json directory read replaces Object.keys(CONTRACTS), so
// this module never requires contract-defs.js. The two enumerations are verified identical (26/26).
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const { findRoot, HERE, isSafeAnchorRelPath } = require("./shared-infra");
const { buildManifest, sha256 } = require("./integrity-digest");
const { resolveKnownSecretValues } = require("./redact");

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
  // contract_schema_versions — one sha256 per contracts/*.schema.json basename, sorted (FAFF-1000:
  // read the schema directory directly rather than Object.keys(CONTRACTS), so this module never
  // requires contract-defs.js — a module whose own require graph reaches the standalone-commissaire
  // DENYLIST). The basename set is verified identical to Object.keys(CONTRACTS) (26/26), and
  // canonicalJSON re-sorts the map keys anyway, so the fingerprint stays byte-identical to the old
  // bundle.js computation. Resolved off the SAME path.resolve(HERE, "..", "contracts") form
  // contract-defs.js uses, so the two can never drift. A missing/unreadable schema file stores
  // null, never throws.
  const contractsDir = path.resolve(HERE, "..", "contracts");
  let schemaFiles;
  try { schemaFiles = fs.readdirSync(contractsDir).filter((f) => f.endsWith(".schema.json")).sort(); }
  catch { schemaFiles = []; }
  const schemaMap = {};
  for (const file of schemaFiles) {
    const name = file.slice(0, -".schema.json".length);
    try { schemaMap[name] = sha256(fs.readFileSync(path.join(contractsDir, file))); }
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
// BundleStore — local occupant (default): nothing leaves the box. put/headDigest/member/
// listBoundaries, the one fixed contract every occupant satisfies (spec §3). The git-remote
// occupant stays in bundle.js: it needs node:child_process (git plumbing), which this
// denylist-clean module deliberately never requires.
// ---------------------------------------------------------------------------
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

module.exports = {
  REDACTED_PLACEHOLDER, BUNDLE_MANIFEST_VERSION, BUNDLE_BOUNDARY_KINDS, IDENTITY_TOKEN_RE,
  REQUIRED_MEMBERS, REQUIRED_MEMBERS_B1, REQUIRED_MEMBERS_B2, requiredMembersFor,
  canonicalJSON, validIdentityToken, validateIdentityForHandle,
  readAnchorDir, buildBundle,
  localBundleSegDir, localBundleDir, localExistingBundleResult, localBundleStore,
};
