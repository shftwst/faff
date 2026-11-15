// ===========================================================================
// === region:governance — human-only-acs — FAFF-1476: the reader of the anchored human-only-acs.json ===
//
// Pure: takes the exact bytes of human-only-acs.json and of the anchor's events.jsonl, never touches
// git or the filesystem. Returns { unattended, ids } only when the file is well formed, agrees with the
// anchored ledger level and ticket, and is the very file the latest human-only-acs-stamp event hashed.
// Every other case, including any fault, returns null (no skip). Total: it never throws.
// ===========================================================================

const nodeCrypto: { createHash(alg: string): { update(data: Uint8Array): { digest(enc: "hex"): string } } } = require("node:crypto");
const acIdApi: { parseAcId(qualified: unknown): { ticket: string; local: string } | null } = require("./ac-id");

export interface HumanOnlyAcs {
  unattended: boolean;
  ids: string[];
}

const STAMP_TYPE = "human-only-acs-stamp";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function levelAllowsUnattended(level: string, unattended: boolean): boolean {
  if (level === "L1" || level === "L2") return !unattended;
  if (level === "L4") return unattended;
  return true;
}

// The data.sha256 of the last stamp event for the issue, or null. An unparseable line other than a
// torn final segment (no trailing newline, as the events readers tolerate) makes the log untrustworthy.
function lastStampSha(eventsText: string, issue: string): string | null {
  const lines = eventsText.split("\n");
  let sha: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "") continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      if (i === lines.length - 1) continue;
      return null;
    }
    if (!isRecord(event) || event["type"] !== STAMP_TYPE) continue;
    const data = event["data"];
    const eventIssue = event["issue"];
    if (typeof eventIssue !== "string" || eventIssue.toLowerCase() !== issue.toLowerCase()) continue;
    sha = isRecord(data) && typeof data["sha256"] === "string" ? data["sha256"] : "";
  }
  return sha;
}

function validIds(value: unknown, issue: string): string[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  for (const id of value) {
    if (typeof id !== "string" || seen.has(id)) return null;
    const parsed = acIdApi.parseAcId(id);
    if (parsed === null || parsed.ticket.toLowerCase() !== issue.toLowerCase()) return null;
    seen.add(id);
  }
  return [...seen];
}

function readHumanOnlyAcs(fileBytes: Uint8Array, eventsBytes: Uint8Array, issue: string, anchoredLevel: string): HumanOnlyAcs | null {
  try {
    const doc: unknown = JSON.parse(decode(fileBytes));
    if (!isRecord(doc)) return null;
    if (doc["schema_version"] !== 1) return null;
    if (typeof doc["issue"] !== "string" || doc["issue"].toLowerCase() !== issue.toLowerCase()) return null;
    if (typeof anchoredLevel !== "string" || doc["level"] !== anchoredLevel) return null;
    const unattended = doc["unattended"];
    if (typeof unattended !== "boolean" || !levelAllowsUnattended(anchoredLevel, unattended)) return null;
    const ids = validIds(doc["human_only"], issue);
    if (ids === null) return null;
    const stamp = lastStampSha(decode(eventsBytes), issue);
    if (stamp === null || stamp !== nodeCrypto.createHash("sha256").update(fileBytes).digest("hex")) return null;
    return { unattended, ids };
  } catch {
    return null;
  }
}

module.exports = { readHumanOnlyAcs };
