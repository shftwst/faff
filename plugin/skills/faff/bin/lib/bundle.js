// ===========================================================================
// === region:factory — bundle — FAFF-819: Phase 0 recovery bundle publish + fail-closed verify ===
// Publishes an immutable, independently-verifiable recovery bundle at each safe boundary
// (the per-issue merge-floor anchor, and — git-only mode only — the run-close anchor) and
// verifies one through a fail-closed verdict ladder (CLEAN/STALE/MISSING/MALFORMED/TAMPERED/
// VERIFICATION_UNAVAILABLE). Two pure cores (buildBundle / classifyBundle) sit behind a
// `bundle_store` slot resolved to one of two occupants satisfying the same fixed BundleStore
// contract (put/headDigest/member/listBoundaries): the default LOCAL occupant (nothing leaves
// the box) and the GIT-REMOTE occupant (each bundle a write-once orphan commit pushed to its
// own `refs/faff/bundles/<run_id>/seg-<segment>/<boundary_key>` ref — no PR, no CI). Tamper
// detection REUSES buildManifest/diffAgainstManifest (integrity-digest.js) and verifyChain/
// verifyEffectsChain (events.js) verbatim — never forked. Out of scope (FAFF-819 spec §2):
// recovery-semantics members (FAFF-845), bundle consumption/recover (FAFF-820), merge-evidence
// acceptance (FAFF-823), a third-party object-store occupant.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parseArgs, usageError } = require("./argv");
const { dig, findRoot } = require("./shared-infra");
const { loadConfig, DEFAULTS } = require("./config");
const { buildManifest, diffAgainstManifest, sha256 } = require("./integrity-digest");
const { verifyChain, verifyEffectsChain, appendEventRecord } = require("./events");
const { resolveKnownSecretValues } = require("./redact");
const { computeBundleVerdict } = require("./contract-defs");

const REDACTED_PLACEHOLDER = "[REDACTED]";
const BUNDLE_MANIFEST_VERSION = "b1";
const REQUIRED_MEMBERS = ["ledger_snapshot", "admitted_outcomes", "anchors", "artifact_manifest", "last_safe_boundary", "redaction"];
const BUNDLE_BOUNDARY_KINDS = ["issue-merge-floor", "run-close"];
// Identity-component charset (spec §4 "Identity-component validation") — applied by the
// store-agnostic layer BEFORE any component is interpolated into a ref name / filesystem path /
// object-store key, so every occupant inherits the guard. run_id and boundary_key: no ".." segment.
const IDENTITY_TOKEN_RE = /^[A-Za-z0-9._-]+$/;

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
function readAnchorDir(root, run_id, boundary_key) {
  const dir = path.join(root, ".faff", "anchors", run_id, boundary_key);
  const files = {};
  const walk = (d, rel) => {
    let names;
    try { names = fs.readdirSync(d).sort(); } catch { return; }
    for (const name of names) {
      const abs = path.join(d, name);
      const relPath = rel ? path.join(rel, name) : name;
      let st;
      try { st = fs.statSync(abs); } catch { continue; }
      if (st.isDirectory()) walk(abs, relPath);
      else files[relPath.split(path.sep).join("/")] = fs.readFileSync(abs).toString("base64");
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

  // anchors — verbatim bytes from .faff/anchors/<run_id>/<boundary_key>/ (mintIssueAnchor's own
  // output: events.jsonl, run-ledger.json, chain-head.json, +declared-effects.jsonl/witness and
  // the copied merge-floor files when present) — a directory snapshot, one blob member.
  const anchor = readAnchorDir(root, identity.run_id, identity.boundary_key);
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

  const memberBytes = {
    ledger_snapshot: ledgerBytes,
    admitted_outcomes: admittedOutcomesBytes,
    anchors: anchorsBytes,
    artifact_manifest: artifactManifestBytes,
    last_safe_boundary: lastSafeBoundaryBytes,
    redaction: redactionBytes,
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

function classifyBundle(read) {
  const identity = read && read.identity;
  if (!read || read.headStatus === "bundle-unreadable" || read.headStatus === "store-unreachable") {
    return bundleVerdict("VERIFICATION_UNAVAILABLE", identity || null, (read && read.headStatus) || "store-unreachable");
  }
  if (read.headStatus === "bundle-missing") return bundleVerdict("MISSING", identity, "bundle-missing");
  if (read.headStatus === "bundle-malformed") return bundleVerdict("MALFORMED", identity, "manifest-malformed");

  const members = read.members || {};
  for (const name of REQUIRED_MEMBERS) {
    if (!members[name] || members[name].status === "missing") return bundleVerdict("MISSING", identity, name);
  }
  for (const name of REQUIRED_MEMBERS) {
    if (members[name].status !== "ok") return bundleVerdict("MALFORMED", identity, name);
  }
  const parsed = {};
  for (const name of REQUIRED_MEMBERS) {
    try { parsed[name] = JSON.parse(members[name].bytes.toString("utf8")); }
    catch { return bundleVerdict("MALFORMED", identity, name); }
  }
  if (!parsed.anchors || typeof parsed.anchors !== "object" || typeof parsed.anchors.files !== "object") {
    return bundleVerdict("MALFORMED", identity, "anchors");
  }

  // Recompute per-member digests + the top manifest digest — never trust the store's own claim.
  const recomputedRefs = {};
  for (const name of REQUIRED_MEMBERS) recomputedRefs[name] = { sha256: sha256(members[name].bytes), bytes_len: members[name].bytes.length };
  const recomputedDigest = sha256(Buffer.from(canonicalJSON(recomputedRefs), "utf8"));
  if (recomputedDigest !== read.headDigest) return bundleVerdict("TAMPERED", identity, "manifest-digest");
  if (read.manifestMemberRefs) {
    for (const name of REQUIRED_MEMBERS) {
      const claimed = read.manifestMemberRefs[name];
      if (claimed && claimed.sha256 !== recomputedRefs[name].sha256) return bundleVerdict("TAMPERED", identity, name);
    }
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
    const anchorEventsPath = path.join(anchorTmp, "events.jsonl");
    if (fs.existsSync(anchorEventsPath)) fs.copyFileSync(anchorEventsPath, path.join(tmp, "events.jsonl"));
    const diffs = diffAgainstManifest(tmp, overlapManifest(parsed.artifact_manifest));
    if (diffs.length > 0) return { tampered: true, cause: diffs[0] };

    const chain = verifyChain(anchorTmp);
    if (!["verified", "legacy-unverifiable", "mixed"].includes(chain.status)) return { tampered: true, cause: "events-chain" };
    const effects = verifyEffectsChain(anchorTmp);
    if (!["verified", "legacy-unverifiable", "mixed"].includes(effects.status)) return { tampered: true, cause: "effects-chain" };
    return { tampered: false };
  });
  if (tamperResult.tampered) return bundleVerdict("TAMPERED", identity, tamperResult.cause);

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

function localBundleStore(root) {
  return {
    name: "local",
    put(identity, memberBytesMap, manifest) {
      const dir = localBundleDir(root, identity);
      if (fs.existsSync(dir)) {
        let existing;
        try { existing = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")); }
        catch (e) { return { ok: false, reason: "identity-conflict", detail: `existing bundle at ${dir} is unreadable: ${e.message}` }; }
        if (existing && existing.bundle_manifest_digest === manifest.bundle_manifest_digest) return { ok: true, idempotent: true };
        return { ok: false, reason: "identity-conflict", detail: `a different bundle already exists at ${dir} (write-once — never overwritten)` };
      }
      const tmp = `${dir}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      fs.mkdirSync(tmp, { recursive: true });
      for (const [name, bytes] of Object.entries(memberBytesMap)) fs.writeFileSync(path.join(tmp, `${name}.bin`), bytes);
      fs.writeFileSync(path.join(tmp, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      fs.renameSync(tmp, dir); // atomic on the same filesystem — the whole bundle appears at once
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
      return { status: "ok", digest: parsed.bundle_manifest_digest, memberRefs: parsed.members, identity: parsed.identity };
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
  return { status: "ok", digest: parsed.bundle_manifest_digest, memberRefs: parsed.members, identity: parsed.identity, commitSha: sha };
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
// Slot resolution — `slots.bundle_store` via the standard config path (spec §4). The default
// occupant is "local" (nothing off-box); "git-remote" is the built-here distributing swap-in.
// ---------------------------------------------------------------------------
const BUNDLE_STORE_OCCUPANTS = ["local", "git-remote"];

function resolveBundleStoreName(root) {
  const [cfg] = loadConfig(root);
  const raw = dig(cfg, "slots.bundle_store");
  const value = (raw === null || raw === undefined || raw === "") ? (DEFAULTS["slots.bundle_store"] || "local") : String(raw).trim();
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
  const boundary_seq = Number.isInteger(opts.boundarySeq) ? opts.boundarySeq : nextBoundarySeq(store, run_id, opts.runSegmentIdHint);

  const idErrsPre = validateIdentityForHandle({ run_id, run_segment_id: 0, boundary_kind: boundaryKind, boundary_key: boundaryKey });
  // run_segment_id is resolved inside buildBundle (from the ledger) — validate only the
  // components known before that read; the full identity is re-validated below.
  const idErrsPreFiltered = idErrsPre.filter((v) => !v.startsWith("run_segment_id"));
  if (idErrsPreFiltered.length) throw new Error(`publishBundle: invalid identity component(s): ${idErrsPreFiltered.join("; ")}`);

  const { manifest, memberBytes } = buildBundle(runDir, { run_id, boundary_kind: boundaryKind, boundary_key: boundaryKey, boundary_seq }, root);
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

// A monotonic boundary_seq scoped to (run_id, run_segment_id) — resolved from the CURRENT max
// among the store's own listing (best-effort: the occupant's own listBoundaries; a store that
// cannot list yet — e.g. a fresh segment — starts at 0). `runSegmentIdHint` is optional (the
// common case resolves it AFTER buildBundle reads the ledger, so this pre-pass conservatively
// scopes by run_id alone when no hint is given — acceptable because seq collisions across
// segments never matter: staleness comparisons are always scoped to one segment).
function nextBoundarySeq(store, run_id, runSegmentIdHint) {
  if (!Number.isInteger(runSegmentIdHint)) return 0;
  const existing = store.listBoundaries(run_id, runSegmentIdHint) || [];
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
  const read = { identity: resolvedIdentity, headStatus: head.status, headDigest: head.digest || null, manifestMemberRefs: head.memberRefs || null, members: {} };
  if (head.status === "ok") {
    for (const name of REQUIRED_MEMBERS) read.members[name] = store.member(queryIdentity, name);
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
    const pub = publishBundle(runDir, "issue-merge-floor", "FAFF-1", { root: tmp, store, runSegmentIdHint: 0, boundarySeq: 0 });
    ok(pub.ok === true && !pub.idempotent, "publishBundle: first publish succeeds, not idempotent");
    const verdict1 = verifyBundleIdentity(pub.identity, { root: tmp, store });
    ok(verdict1.verdict === "CLEAN", `publish -> verify round trip is CLEAN (got ${verdict1.verdict}/${verdict1.cause})`);

    // Idempotent re-publish: same digest -> no-op, never a rewrite.
    const pub2 = publishBundle(runDir, "issue-merge-floor", "FAFF-1", { root: tmp, store, runSegmentIdHint: 0, boundarySeq: 0 });
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
    const pub3 = publishBundle(runDir, "issue-merge-floor", "FAFF-2", { root: tmp, store, runSegmentIdHint: 0, boundarySeq: 1 });
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
      const gpub = publishBundle(runDir2, "issue-merge-floor", "FAFF-9", { root: workRoot, store: gstore, runSegmentIdHint: 0, boundarySeq: 0 });
      ok(gpub.ok === true, `git-remote publish succeeds against a scratch bare repo (got ${JSON.stringify(gpub)})`);
      const gverdict = verifyBundleIdentity(gpub.identity, { root: workRoot, store: gstore });
      ok(gverdict.verdict === "CLEAN", `git-remote publish -> verify round trip is CLEAN (got ${gverdict.verdict}/${gverdict.cause})`);
      const gpub2 = publishBundle(runDir2, "issue-merge-floor", "FAFF-9", { root: workRoot, store: gstore, runSegmentIdHint: 0, boundarySeq: 0 });
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
      const badPub = publishBundle(runDirBad, "issue-merge-floor", "FAFF-1", { root: badWorkRoot, store: badStore, runSegmentIdHint: 0, boundarySeq: 0 });
      ok(badPub.ok === false && badPub.reason === "store_unavailable", `an unreachable remote reports store_unavailable, never throws (got ${JSON.stringify(badPub)})`);
      const badEvents = fs.readFileSync(path.join(runDirBad, "events.jsonl"), "utf8");
      ok(badEvents.includes('"bundle-store-unavailable"') && badEvents.includes("FAFF-1"), "store_unavailable records a run event noting it (spec: never fails the run)");
    } else {
      console.log("skip  git-remote occupant checks (git init unavailable in this environment)");
    }
  } finally {
    fs.rmSync(gitTmp, { recursive: true, force: true });
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
  canonicalJSON, validateIdentityForHandle, buildBundle, classifyBundle, deriveSupersededBy,
  localBundleStore, gitRemoteBundleStore, bundleRefName, resolveBundleStoreName, resolveBundleStore,
  publishBundle, verifyBundleIdentity, bundleExitCode, cmdBundle, bundleSelftest,
};
