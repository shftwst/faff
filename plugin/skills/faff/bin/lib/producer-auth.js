// ===========================================================================
// === region:governance — producer-auth — FAFF-828: split-key per-record authentication for the schema:3 governance envelope ===
//
// The split-key trust root the external Commissaire facade (lib/commissaire.js,
// region factory) is built on. A PRODUCER only ever CLAIMS: it holds a symmetric
// K_producer (HKDF-derived from a governor-held master_secret) and HMACs its own
// records, so a forged or out-of-scope producer record is mechanically detectable
// (J-C: record-granularity forgery detection, explicitly NOT non-repudiation — any
// holder of K_producer could have written any of its claims). Only COMMISSAIRE
// DECIDES: a protected-effect verdict is signed with an Ed25519 SK_commissaire the
// producer never holds, so a producer that HMACs a fake verdict produces a record
// that fails Ed25519 verification (the round-1 infosec blocker's ratified fix). A
// chokepoint on an effect path holds only the public PK_commissaire and verifies a
// decision before permitting the effect.
//
// PURE, node:crypto only (generateKeyPairSync/sign/verify/hkdfSync/createHmac/
// timingSafeEqual) — no tracker, no network, no filesystem. Region governance so the
// governance integrity leg (governance-check.js, factory) and any auditor can call it
// without a governance file ever requiring a factory file. Both auth arms cover the
// SAME byte image via one shared canonicalBytes serialiser (a producer HMAC and a
// Commissaire signature cover identical bytes, minus the auth fields).
// ===========================================================================

const crypto = require("node:crypto");

// The two per-record authentication fields, EXCLUDED from canonicalBytes so the
// value being signed never contains the signature. `prev` (the chain link) is NOT
// excluded — it is part of what a record's author vouches for.
const AUTH_FIELDS = ["producer_hmac", "commissaire_sig"];

// Deterministic serialisation of a record with STABLE (recursively sorted) key order,
// excluding both auth fields. This is the byte image a producer HMAC and a Commissaire
// signature both cover, so the signature is reproducible by anyone re-canonicalising the
// record. The on-disk physical line is a plain JSON.stringify (insertion order, WITH the
// auth field) and drives the hash chain's `prev`; canonicalBytes is a SEPARATE, order-
// independent image for the auth field only — the two never need to agree byte-for-byte.
function canonicalStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  const parts = [];
  for (const k of keys) {
    if (value[k] === undefined) continue; // JSON.stringify drops undefined; mirror it
    parts.push(`${JSON.stringify(k)}:${canonicalStringify(value[k])}`);
  }
  return `{${parts.join(",")}}`;
}

function canonicalBytes(record) {
  const stripped = {};
  for (const k of Object.keys(record)) {
    if (AUTH_FIELDS.includes(k)) continue;
    if (record[k] === undefined) continue;
    stripped[k] = record[k];
  }
  return Buffer.from(canonicalStringify(stripped), "utf8");
}

// --- ProducerAuth (symmetric): a producer authenticates its own CLAIMS -----------------

// K_producer = HKDF(master_secret, producer_id, contract_revision). The governor holds
// master_secret and can re-derive any producer's key to verify its claims; the producer
// holds only its own derived key and cannot derive another producer's. 32-byte SHA-256 HKDF.
function deriveKey(masterSecret, producerId, contractRevision) {
  const ikm = Buffer.isBuffer(masterSecret) ? masterSecret : Buffer.from(String(masterSecret), "utf8");
  const salt = Buffer.from(String(producerId), "utf8");
  const info = Buffer.from(String(contractRevision), "utf8");
  return Buffer.from(crypto.hkdfSync("sha256", ikm, salt, info, 32));
}

// HMAC-SHA256 over canonicalBytes(record) under K_producer. `record` is the record WITHOUT
// its auth field; the returned hex is what gets attached as producer_hmac.
function signRecord(record, key) {
  return crypto.createHmac("sha256", key).update(canonicalBytes(record)).digest("hex");
}

// Recompute the HMAC over canonicalBytes(record) and constant-time-compare it to the record's
// producer_hmac. Any absence / wrong length / mismatch is false (never throws). A record with
// no producer_hmac, or a non-hex one, fails cleanly.
function verifyRecord(record, key) {
  const claimed = record && record.producer_hmac;
  if (typeof claimed !== "string" || !/^[0-9a-f]{64}$/.test(claimed)) return false;
  const expected = crypto.createHmac("sha256", key).update(canonicalBytes(record)).digest();
  let claimedBuf;
  try { claimedBuf = Buffer.from(claimed, "hex"); } catch { return false; }
  if (claimedBuf.length !== expected.length) return false;
  return crypto.timingSafeEqual(claimedBuf, expected);
}

// --- CommissaireAuth (asymmetric): only Commissaire mints DECISIONS ---------------------

// Mint the governor keypair. Returns PEM strings (portable — the facade persists them and
// hands node:crypto's sign/verify either a PEM or a KeyObject) plus the SHA-256 fingerprint
// of the SPKI-DER public key, which a chokepoint pins so a swapped public key is detected.
function mintGovernorKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const sk = privateKey.export({ type: "pkcs8", format: "pem" });
  const pk = publicKey.export({ type: "spki", format: "pem" });
  const pkDer = publicKey.export({ type: "spki", format: "der" });
  return { sk, pk, pk_fingerprint: crypto.createHash("sha256").update(pkDer).digest("hex") };
}

// SHA-256 of the SPKI-DER of a PEM public key — the value a chokepoint pins and re-checks.
function pkFingerprint(pkPem) {
  const der = crypto.createPublicKey(pkPem).export({ type: "spki", format: "der" });
  return crypto.createHash("sha256").update(der).digest("hex");
}

// Ed25519 sign over canonicalBytes(record) under SK_commissaire; base64. `record` is WITHOUT
// its commissaire_sig. Only the governor holds SK, so only the governor can produce this.
function signDecision(record, sk) {
  return crypto.sign(null, canonicalBytes(record), sk).toString("base64");
}

// Verify a decision's Ed25519 signature under PK_commissaire. A producer HMAC (hex) presented
// as commissaire_sig fails here — that is the forged-grant defence. Any malformed input / bad
// signature / wrong key is false, never a throw.
function verifyDecision(record, pk) {
  const sig = record && record.commissaire_sig;
  if (typeof sig !== "string" || sig === "") return false;
  let sigBytes;
  try { sigBytes = Buffer.from(sig, "base64"); } catch { return false; }
  // A stray hex HMAC base64-decodes to junk of the wrong length; ed25519 sigs are 64 bytes.
  if (sigBytes.length !== 64) return false;
  try { return crypto.verify(null, canonicalBytes(record), pk, sigBytes); }
  catch { return false; }
}

const ProducerAuth = { deriveKey, signRecord, verifyRecord, canonicalBytes };
const CommissaireAuth = { mintGovernorKeypair, pkFingerprint, signDecision, verifyDecision, canonicalBytes };

// In-memory selftest of the pure split-key cores (mirrors the effects/events selftest style).
// Not a REGION_MAP command (this module is a pure lib, not a subcommand), so it is exercised
// both here and by test/commissaire-auth.test.mjs; commissaire.js's --selftest also calls it.
function producerAuthSelftest() {
  let failed = 0;
  const fail = (m) => { process.stderr.write(`producer-auth selftest FAIL: ${m}\n`); failed++; };

  // canonicalBytes: excludes auth fields, stable across key order
  const a = { schema: 3, seq: 1, author: "producer", producer_hmac: "deadbeef", payload: { b: 2, a: 1 } };
  const b = { payload: { a: 1, b: 2 }, author: "producer", seq: 1, schema: 3, producer_hmac: "different" };
  if (!canonicalBytes(a).equals(canonicalBytes(b))) fail("canonicalBytes is key-order-independent and auth-field-excluding");

  // HMAC round trip + derive determinism
  const k1 = deriveKey("master-xyz", "P1", "r1");
  const k1b = deriveKey("master-xyz", "P1", "r1");
  if (!k1.equals(k1b)) fail("deriveKey is deterministic");
  const k2 = deriveKey("master-xyz", "P2", "r1");
  if (k1.equals(k2)) fail("deriveKey differs by producer_id");
  const rec = { schema: 3, author: "producer", producer_id: "P1", seq: 0, kind_of_entry: "declare" };
  const hmac = signRecord(rec, k1);
  if (!verifyRecord({ ...rec, producer_hmac: hmac }, k1)) fail("verifyRecord accepts a genuine HMAC");
  if (verifyRecord({ ...rec, producer_hmac: hmac }, k2)) fail("verifyRecord rejects an HMAC under the wrong key");
  // tamper a covered field → verify fails
  if (verifyRecord({ ...rec, seq: 1, producer_hmac: hmac }, k1)) fail("verifyRecord rejects a tampered record");
  if (verifyRecord(rec, k1)) fail("verifyRecord rejects a record with no producer_hmac");

  // Ed25519 decision round trip; a producer cannot forge a decision
  const gov = mintGovernorKeypair();
  if (!/^[0-9a-f]{64}$/.test(gov.pk_fingerprint)) fail("pk_fingerprint is 64 hex");
  if (pkFingerprint(gov.pk) !== gov.pk_fingerprint) fail("pkFingerprint recomputes the minted fingerprint");
  const verdict = { schema: 3, author: "commissaire", kind_of_entry: "effect-decision-verdict", seq: 2, payload: { verdict: "grant" } };
  const sig = signDecision(verdict, gov.sk);
  if (!verifyDecision({ ...verdict, commissaire_sig: sig }, gov.pk)) fail("verifyDecision accepts a genuine grant");
  // a producer HMACs the SAME verdict → must NOT verify as a decision (the headline defence)
  const forged = signRecord(verdict, k1);
  if (verifyDecision({ ...verdict, commissaire_sig: forged }, gov.pk)) fail("verifyDecision rejects a producer-HMAC'd fake verdict");
  // tamper the verdict body → verify fails
  if (verifyDecision({ ...verdict, payload: { verdict: "deny" }, commissaire_sig: sig }, gov.pk)) fail("verifyDecision rejects a tampered verdict");
  // a swapped keypair → verify fails
  const gov2 = mintGovernorKeypair();
  if (verifyDecision({ ...verdict, commissaire_sig: sig }, gov2.pk)) fail("verifyDecision rejects a signature under a swapped PK");

  if (failed) return 1;
  console.log("producer-auth selftest: ok");
  return 0;
}

module.exports = {
  AUTH_FIELDS, ProducerAuth, CommissaireAuth,
  canonicalBytes, canonicalStringify,
  deriveKey, signRecord, verifyRecord,
  mintGovernorKeypair, pkFingerprint, signDecision, verifyDecision,
  producerAuthSelftest,
};
