// === region:factory — review-comment - pure tracker-comment planning ===
import { createHash } from 'node:crypto';
import { readSync } from 'node:fs';

type Comment = { id: string; body: string; time: number };
type Marker = { kind: 'open' | 'close'; start: number; end: number };
export type ReviewCommentPlan = {
  schema: 1;
  action: 'create' | 'update';
  reason: 'created' | 'updated' | 'reconciled';
  comment_id: string | null;
  body: string;
  expectedDigest: string | null;
};

const MAX_INPUT_BYTES = 1024 * 1024;
const USAGE = 'faff review-comment plan --input -';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(message: string): never {
  throw new Error(message);
}

function validUnicode(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function validateJsonValues(value: unknown): void {
  const pending: unknown[] = [value];
  const seen = new Set<object>();
  while (pending.length) {
    const item = pending.pop();
    if (typeof item === 'string') {
      if (!validUnicode(item)) invalid('unpaired Unicode surrogate');
    } else if (typeof item === 'number') {
      if (!Number.isFinite(item)) invalid('non-finite number');
    } else if (typeof item === 'object' && item !== null) {
      if (seen.has(item)) invalid('input must be a JSON tree');
      seen.add(item);
      for (const [key, child] of Object.entries(item)) {
        if (!validUnicode(key)) invalid('unpaired Unicode surrogate in key');
        pending.push(child);
      }
    } else if (item !== null && typeof item !== 'boolean') invalid('input must contain JSON values');
  }
}

function timestamp(value: unknown): number {
  if (value === undefined || value === null) return Infinity;
  if (typeof value !== 'string') return invalid('created_at must be an RFC 3339 timestamp or null');
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return invalid('created_at must be RFC 3339 with at most three fractional digits');
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (!days || day < 1 || day > days || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59 || Number(match[9] ?? 0) > 23 || Number(match[10] ?? 0) > 59) {
    return invalid('created_at has an invalid calendar date, time or offset');
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return invalid('created_at cannot be represented');
  return time;
}

function markers(body: string, open: string, close: string): { markers: Marker[]; unclosedFence: boolean } {
  const found: Marker[] = [];
  let fence: { character: string; length: number } | null = null;
  let start = 0;
  while (start <= body.length) {
    const newline = body.indexOf('\n', start);
    const end = newline === -1 ? body.length : newline;
    const line = body.slice(start, end);
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.replace(/\r$/, ''));
    if (fence) {
      if (fenceMatch && fenceMatch[1]?.[0] === fence.character && fenceMatch[1].length >= fence.length && /^[ \t]*$/.test(fenceMatch[2] ?? '')) fence = null;
    } else if (fenceMatch && !(fenceMatch[1]?.[0] === '`' && (fenceMatch[2] ?? '').includes('`'))) {
      const run = fenceMatch[1]!;
      fence = { character: run[0]!, length: run.length };
    } else {
      const trimmed = line.trimEnd();
      if (trimmed === open || trimmed === close) found.push({ kind: trimmed === open ? 'open' : 'close', start, end });
    }
    if (newline === -1) break;
    start = newline + 1;
  }
  return { markers: found, unclosedFence: fence !== null };
}

export function planReviewComment(value: unknown): ReviewCommentPlan {
  validateJsonValues(value);
  if (!record(value) || Object.keys(value).sort().join(',') !== 'comments,faff_body,issue_id,schema' || value.schema !== 1) invalid('expected schema 1 with issue_id, faff_body and comments only');
  const { issue_id, faff_body } = value;
  if (typeof issue_id !== 'string' || !issue_id || /[\s\x00-\x1f\x7f-\x9f<>]/u.test(issue_id)) invalid('issue_id must be non-empty and contain no whitespace, controls or angle brackets');
  if (typeof faff_body !== 'string') invalid('faff_body must be a string');
  if (!Array.isArray(value.comments)) invalid('comments must be an array');
  const ids = new Set<string>();
  const comments: Comment[] = value.comments.map((comment: unknown) => {
    if (!record(comment) || typeof comment.id !== 'string' || !comment.id.trim() || typeof comment.body !== 'string') invalid('each comment needs a non-empty string id and string body');
    if (ids.has(comment.id)) invalid('duplicate comment id');
    ids.add(comment.id);
    return { id: comment.id, body: comment.body, time: timestamp(comment.created_at) };
  });
  const open = `<!-- faff-review-findings:${issue_id} -->`;
  const close = `<!-- /faff-review-findings:${issue_id} -->`;
  const replacement = markers(faff_body, open, close);
  if (replacement.markers.length) invalid('faff_body contains an active marker for this issue');
  if (replacement.unclosedFence) invalid('faff_body contains an unclosed code fence');
  const region = `${open}\n${faff_body}\n${close}`;
  const matches = comments.flatMap((comment, index) => {
    const found = markers(comment.body, open, close).markers;
    const first = found[0];
    if (!first || first.kind !== 'open') return [];
    return [{ comment, index, start: first.start, close: found.find(marker => marker.kind === 'close') }];
  });
  if (!matches.length) return { schema: 1, action: 'create', reason: 'created', comment_id: null, body: region, expectedDigest: null };
  const complete = matches.filter(match => match.close);
  const pool = complete.length ? complete : matches;
  pool.sort((a, b) => a.comment.time === b.comment.time ? a.index - b.index : a.comment.time < b.comment.time ? -1 : 1);
  const chosen = pool[0]!;
  return {
    schema: 1, action: 'update', reason: matches.length === 1 ? 'updated' : 'reconciled',
    comment_id: chosen.comment.id,
    body: chosen.comment.body.slice(0, chosen.start) + region + chosen.comment.body.slice(chosen.close?.end ?? chosen.comment.body.length),
    expectedDigest: createHash('sha256').update(chosen.comment.body, 'utf8').digest('hex'),
  };
}

function parseInput(text: string): unknown {
  const parsed: unknown = JSON.parse(text);
  // JSON.parse validates syntax; this second pass rejects keys it would silently overwrite.
  const tokens = text.match(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\]:,]/g) ?? [];
  const objects: (Set<string> | null)[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token === '{') objects.push(new Set());
    else if (token === '[') objects.push(null);
    else if (token === '}' || token === ']') objects.pop();
    else if (token.startsWith('"') && tokens[i + 1] === ':') {
      const keys = objects[objects.length - 1]!;
      const key: string = JSON.parse(token);
      if (keys.has(key)) invalid('duplicate JSON object key');
      keys.add(key);
    }
  }
  return parsed;
}

function readInput(): string {
  const chunks: Buffer[] = [];
  const buffer = Buffer.alloc(65536);
  let total = 0;
  for (;;) {
    const length = readSync(0, buffer, 0, buffer.length, null);
    if (!length) break;
    total += length;
    if (total > MAX_INPUT_BYTES) invalid('input exceeds one MiB');
    chunks.push(Buffer.from(buffer.subarray(0, length)));
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}

export function cmdReviewComment(args: string[]): number {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(`${USAGE}\nRead schema-1 JSON from stdin; print one plan. No tracker writes. Invalid input exits 2.\n`);
    return 0;
  }
  try {
    if (args.length !== 3 || args[0] !== 'plan' || args[1] !== '--input' || args[2] !== '-') invalid(`usage: ${USAGE}`);
    const plan = planReviewComment(parseInput(readInput()));
    process.stdout.write(`${JSON.stringify(plan)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`faff review-comment: ${error instanceof Error ? error.message : 'invalid input'}\n`);
    return 2;
  }
}
