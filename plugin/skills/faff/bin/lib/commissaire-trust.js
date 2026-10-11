"use strict";
// === region:governance — commissaire-trust — FAFF-1210: trust file TOML-subset parser + base-branch reader ===
//
// `.commissaire/trust.toml` holds Commissaire's pinned governor keys, the strict-mode switch, and the
// pin-change approvers. It is committed, holds no secrets, and its only trustworthy copy is the one on
// the base branch a runner cannot push to directly. This module turns committed bytes into a validated
// schema-1 config, and FAILS CLOSED (never "no pins") the moment the bytes are anything but a valid file.
//
// Three pure-ish exports (ADR 0135 decision 11): a strict, line-numbered TOML-subset parser; a schema-1
// validator; and a base-branch reader that takes the file only from committed history (`git show` local,
// `gh api contents` remote) and reports the source label. No local override of any kind — never the
// working tree, never a `trust.local.toml`, never an env var or flag. Dependency-free in the shipped
// closure: requires only `node:*` and the governance-region `./result`, following the `parseYamlSubset`
// precedent (but strict where that one is forgiving). Never imports config/merge-gate/bundle or any
// orchestration module — it carries its own minimal git/gh wrappers, modelled on merge-gate's shape
// but copied, not imported (the import-independence guard proves this).
Object.defineProperty(exports, "__esModule", { value: true });
const result = require("./result");
const childProcess = require("node:child_process");
const TRUST_FILE_PATH = ".commissaire/trust.toml";
const FINGERPRINT_RE = /^[0-9a-f]{64}$/;
const BARE_KEY_RE = /^[A-Za-z0-9_-]+$/;
const DECIMAL_INT_RE = /^(0|[1-9][0-9]*)$/;
function makeError(stage, line, reason) {
    const message = line === null
        ? `trust-file-invalid: ${reason}`
        : `trust-file-invalid: line ${line}: ${reason}`;
    return { code: "trust-file-invalid", stage, line, reason, message };
}
function parseError(line, reason) {
    return result.err(makeError("Parse", line, reason));
}
function trimLeadingSpace(s) {
    return s.replace(/^[ \t]+/, "");
}
function isTrailingCommentOrEnd(remainder) {
    const t = remainder.replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");
    return t.length === 0 || t.startsWith("#");
}
// Parse a basic double-quoted string starting at s[0] === '"'. Only \" and \\ escapes; a raw control
// character or invalid UTF-8 is refused; no multi-line strings. Returns the decoded value and the
// remainder of the line after the closing quote.
function parseBasicString(s, line) {
    // s[0] is '"'. Scan from index 1.
    let out = "";
    let i = 1;
    while (i < s.length) {
        const ch = s.charAt(i);
        const code = s.charCodeAt(i);
        if (ch === "\\") {
            const next = s.charAt(i + 1);
            if (next === '"' || next === "\\") {
                out += next;
                i += 2;
                continue;
            }
            return { error: makeError("Parse", line, "unsupported escape") };
        }
        if (code === 0xfffd) {
            return { error: makeError("Parse", line, "invalid utf-8 in string") };
        }
        if (code < 0x20) {
            return { error: makeError("Parse", line, "control character in string") };
        }
        if (ch === '"') {
            return { value: out, remainder: s.slice(i + 1) };
        }
        out += ch;
        i += 1;
    }
    return { error: makeError("Parse", line, "unterminated string") };
}
function parseInteger(token, line) {
    if (/^[+-]/.test(token))
        return { error: makeError("Parse", line, "signed integers are not allowed") };
    if (token.includes("_"))
        return { error: makeError("Parse", line, "underscores are not allowed") };
    if (/^0(x|o|b)/i.test(token))
        return { error: makeError("Parse", line, "only decimal integers are allowed") };
    if (/\./.test(token) || /e/i.test(token) || /[:tz]/i.test(token) || /[0-9]-/.test(token)) {
        return { error: makeError("Parse", line, "floats, dates and times are not allowed") };
    }
    if (!DECIMAL_INT_RE.test(token))
        return { error: makeError("Parse", line, "invalid integer") };
    const n = Number(token);
    if (n > Number.MAX_SAFE_INTEGER)
        return { error: makeError("Parse", line, "integer out of range") };
    return { value: n };
}
// The leading non-whitespace, non-comment token of a scalar value.
function scalarToken(s) {
    const m = s.match(/^[^\s#]+/);
    return m ? m[0] : "";
}
// Parse a string array that may span lines. `lines` is the full CR-stripped line list (1-based access
// via lines[idx-1]); `startLine` is the 1-based line the '[' sits on; `s` is the value portion of that
// line (left-trimmed) starting with '['. Returns the list and how many lines it spanned (>= 1).
function parseStringArray(lines, startLine, s) {
    const list = [];
    let currentLine = startLine;
    let buf = s.slice(1); // drop the '['
    let needSeparator = false; // after an element, the next significant char must be ',' or ']'
    for (;;) {
        // Skip whitespace and comment-to-end-of-line, advancing across physical lines as needed.
        for (;;) {
            buf = trimLeadingSpace(buf);
            if (buf.length === 0 || buf.startsWith("#")) {
                currentLine += 1;
                const nextLine = lines[currentLine - 1];
                if (nextLine === undefined) {
                    return { error: makeError("Parse", startLine, "unterminated array") };
                }
                buf = nextLine;
                continue;
            }
            break;
        }
        const c = buf.charAt(0);
        if (c === "]") {
            const remainder = buf.slice(1);
            if (!isTrailingCommentOrEnd(remainder)) {
                return { error: makeError("Parse", currentLine, "trailing characters after value") };
            }
            const value = { kind: "StringArray", line: startLine, stringArray: list };
            return { value, consumed: currentLine - startLine + 1 };
        }
        if (c === "[") {
            return { error: makeError("Parse", currentLine, "nested arrays are not allowed") };
        }
        if (c === ",") {
            if (!needSeparator) {
                return { error: makeError("Parse", currentLine, "unexpected comma") };
            }
            needSeparator = false;
            buf = buf.slice(1);
            continue;
        }
        if (c === '"') {
            if (needSeparator) {
                return { error: makeError("Parse", currentLine, "expected comma or closing bracket") };
            }
            const parsed = parseBasicString(buf, currentLine);
            if ("error" in parsed)
                return { error: parsed.error };
            list.push(parsed.value);
            needSeparator = true;
            buf = parsed.remainder;
            continue;
        }
        // A digit, t/f, or any other non-string element — refuses mixed-type arrays.
        return { error: makeError("Parse", currentLine, "array elements must be strings") };
    }
}
// Parse the value to the right of '='. `raw` keeps any trailing comment. Returns the typed value and
// the number of lines it spanned (a multi-line array spans more than one).
function parseValue(lines, line, raw) {
    const s = trimLeadingSpace(raw);
    if (s.length === 0) {
        return { error: makeError("Parse", line, "missing value") };
    }
    const first = s.charAt(0);
    if (first === '"') {
        const parsed = parseBasicString(s, line);
        if ("error" in parsed)
            return { error: parsed.error };
        if (!isTrailingCommentOrEnd(parsed.remainder)) {
            return { error: makeError("Parse", line, "trailing characters after value") };
        }
        const value = { kind: "String", line, string: parsed.value };
        return { value, consumed: 1 };
    }
    if (first === "[") {
        return parseStringArray(lines, line, s);
    }
    if (first === "t" || first === "f") {
        const token = scalarToken(s);
        const remainder = s.slice(token.length);
        if (token !== "true" && token !== "false") {
            return { error: makeError("Parse", line, "invalid boolean") };
        }
        if (!isTrailingCommentOrEnd(remainder)) {
            return { error: makeError("Parse", line, "trailing characters after value") };
        }
        const value = { kind: "Boolean", line, boolean: token === "true" };
        return { value, consumed: 1 };
    }
    if (first >= "0" && first <= "9") {
        const token = scalarToken(s);
        const remainder = s.slice(token.length);
        const parsed = parseInteger(token, line);
        if ("error" in parsed)
            return { error: parsed.error };
        if (!isTrailingCommentOrEnd(remainder)) {
            return { error: makeError("Parse", line, "trailing characters after value") };
        }
        const value = { kind: "Integer", line, integer: parsed.value };
        return { value, consumed: 1 };
    }
    return { error: makeError("Parse", line, "unrecognised value") };
}
function parseTrustToml(text) {
    if (text.charCodeAt(0) === 0xfeff) {
        return parseError(1, "byte-order mark not allowed");
    }
    // Accept LF and CRLF: split on LF, strip a single trailing CR. A lone CR inside a line survives and
    // is refused as a control character by the string scanner / bare-key regex downstream.
    const lines = text.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
    const entries = new Map();
    let i = 1; // 1-based cursor
    while (i <= lines.length) {
        const rawLine = lines[i - 1];
        if (rawLine === undefined)
            break;
        const t = rawLine.replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");
        if (t.length === 0 || t.startsWith("#")) {
            i += 1;
            continue;
        }
        if (t.startsWith("[")) {
            return parseError(i, "table headers are not allowed");
        }
        const eq = rawLine.indexOf("=");
        if (eq === -1) {
            return parseError(i, "expected key = value");
        }
        const key = rawLine.slice(0, eq).replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");
        const raw = rawLine.slice(eq + 1);
        if (key.length === 0) {
            return parseError(i, "missing key");
        }
        if (!BARE_KEY_RE.test(key)) {
            return parseError(i, "key must be a bare key");
        }
        if (entries.has(key)) {
            return parseError(i, "duplicate key");
        }
        const parsed = parseValue(lines, i, raw);
        if ("error" in parsed)
            return result.err(parsed.error);
        entries.set(key, parsed.value);
        i += parsed.consumed;
    }
    return result.ok({ entries });
}
// --- Schema-1 validation ------------------------------------------------------------------------
const KNOWN_KEYS = new Set([
    "schema",
    "governor_key_fingerprints",
    "require_pinned_governor",
    "pin_change_approvers",
]);
function validateSchema1(doc) {
    for (const [key, value] of doc.entries) {
        if (!KNOWN_KEYS.has(key)) {
            return result.err(makeError("Schema", value.line, `unknown key: ${key}`));
        }
    }
    const schemaEntry = doc.entries.get("schema");
    if (schemaEntry === undefined) {
        return result.err(makeError("Schema", null, "missing required key schema"));
    }
    if (schemaEntry.kind !== "Integer" || schemaEntry.integer !== 1) {
        return result.err(makeError("Schema", schemaEntry.line, "schema must be 1"));
    }
    const fingerprintsEntry = doc.entries.get("governor_key_fingerprints");
    let governorKeyFingerprints = [];
    if (fingerprintsEntry !== undefined) {
        if (fingerprintsEntry.kind !== "StringArray" || fingerprintsEntry.stringArray === undefined) {
            return result.err(makeError("Schema", fingerprintsEntry.line, "governor_key_fingerprints must be an array of strings"));
        }
        const seen = new Set();
        for (const fp of fingerprintsEntry.stringArray) {
            if (!FINGERPRINT_RE.test(fp)) {
                return result.err(makeError("Schema", fingerprintsEntry.line, "fingerprint must be 64 lowercase hex characters"));
            }
            if (seen.has(fp)) {
                return result.err(makeError("Schema", fingerprintsEntry.line, "duplicate fingerprint"));
            }
            seen.add(fp);
        }
        governorKeyFingerprints = fingerprintsEntry.stringArray;
    }
    const strictEntry = doc.entries.get("require_pinned_governor");
    let requirePinnedGovernor = false;
    if (strictEntry !== undefined) {
        if (strictEntry.kind !== "Boolean" || strictEntry.boolean === undefined) {
            return result.err(makeError("Schema", strictEntry.line, "require_pinned_governor must be a boolean"));
        }
        requirePinnedGovernor = strictEntry.boolean;
    }
    const approversEntry = doc.entries.get("pin_change_approvers");
    let pinChangeApprovers = [];
    if (approversEntry !== undefined) {
        if (approversEntry.kind !== "StringArray" || approversEntry.stringArray === undefined) {
            return result.err(makeError("Schema", approversEntry.line, "pin_change_approvers must be an array of strings"));
        }
        pinChangeApprovers = approversEntry.stringArray;
    }
    if (requirePinnedGovernor && governorKeyFingerprints.length === 0) {
        const line = strictEntry === undefined ? null : strictEntry.line;
        return result.err(makeError("Schema", line, "strict mode requires at least one fingerprint"));
    }
    return result.ok({
        schema: 1,
        governorKeyFingerprints,
        requirePinnedGovernor,
        pinChangeApprovers,
    });
}
// `git show <ref>:<path>` reads the committed blob from the content-addressed local object store. A
// non-zero exit whose stderr is NOT a recognised "path does not exist" phrasing is OtherFailure (fail
// closed): a bad ref, a shallow clone lacking the object, or any other git error never reads as absent.
function gitShow(repoDir, ref, filePath) {
    const r = childProcess.spawnSync("git", ["-C", repoDir, "show", `${ref}:${filePath}`], { encoding: "buffer" });
    if (r.status === 0) {
        const stdout = r.stdout instanceof Buffer ? r.stdout : Buffer.from(r.stdout ?? "");
        return { status: "Ok", bytes: stdout };
    }
    const stderr = r.stderr === undefined || r.stderr === null ? "" : r.stderr.toString("utf8");
    if (/does not exist|exists on disk, but not in|path .* does not exist/.test(stderr)) {
        return { status: "FileAbsent" };
    }
    const detail = stderr.replace(/[\r\n]+/g, " ").trim() || `git show exited ${r.status}`;
    return { status: "OtherFailure", detail };
}
// Read the REAL HTTP status of a `gh api` call via a headers-only `-i` probe — never match `gh`'s
// stderr text (merge-gate abandoned that in FAFF-747). `gh` exits non-zero on any HTTP error but still
// writes the response status line to stdout under `-i` (`--include`); capture stdout regardless of exit
// code and read the FIRST `HTTP/<ver> <code> <reason>` line. Returns the numeric status, or null (no
// status line: network failure, `gh` missing, odd output) — the caller fails closed on null.
function ghHttpStatus(args) {
    const r = childProcess.spawnSync("gh", args, { encoding: "utf8", timeout: 60000 });
    const out = r && typeof r.stdout === "string" ? r.stdout : "";
    const m = out.match(/^HTTP\/[\d.]+\s+(\d{3})\b/m);
    return m && m[1] !== undefined ? Number(m[1]) : null;
}
// Read the file via the forge Contents API. GitHub returns an indistinguishable 404 for path-absent,
// repo-not-found, no-access, and a missing ref, so a 404 maps to FileAbsent ONLY when a repo-root-tree
// probe at the same ref returns 200 (repo reachable, token authorized, ref present). Every other
// outcome is OtherFailure → trust-file-invalid (fail closed; an undisambiguated 404 would be a fail-open
// that silently disables strict mode on an unreachable or forbidden repo).
function ghApiContents(repoSlug, ref, filePath) {
    const fileArg = `repos/${repoSlug}/contents/${filePath}?ref=${ref}`;
    const r = childProcess.spawnSync("gh", ["api", fileArg], { encoding: "utf8", timeout: 60000 });
    if (r.status === 0) {
        let obj;
        try {
            obj = JSON.parse(typeof r.stdout === "string" ? r.stdout : "");
        }
        catch {
            return { status: "OtherFailure", detail: "unparseable contents response" };
        }
        let b64 = null;
        if (obj !== null && typeof obj === "object" && "content" in obj && typeof obj.content === "string") {
            b64 = obj.content;
        }
        if (b64 === null) {
            return { status: "OtherFailure", detail: "contents response carried no base64 content" };
        }
        // Strip the Contents API's embedded newlines before decode (mirrors merge-gate.js's Contents read).
        return { status: "Ok", bytes: Buffer.from(b64.replace(/\n/g, ""), "base64") };
    }
    const fileStatus = ghHttpStatus(["api", "-i", fileArg]);
    if (fileStatus !== 404) {
        return { status: "OtherFailure", detail: `contents read failed (http ${fileStatus ?? "none"})` };
    }
    const rootStatus = ghHttpStatus(["api", "-i", `repos/${repoSlug}/contents?ref=${ref}`]);
    if (rootStatus === 200) {
        return { status: "FileAbsent" };
    }
    return { status: "OtherFailure", detail: `404 not provably file-absent: repo-root probe http ${rootStatus ?? "none"}` };
}
function readTrustFile(args) {
    let read;
    let source;
    if (args.transport === "local") {
        read = gitShow(args.repoDir, args.ref, TRUST_FILE_PATH);
        source = "local-ref";
    }
    else {
        if (args.repoSlug === undefined || args.repoSlug.length === 0) {
            return result.err(makeError("Read", null, "remote transport requires a repoSlug"));
        }
        read = ghApiContents(args.repoSlug, args.ref, TRUST_FILE_PATH);
        source = "remote-base";
    }
    if (read.status === "FileAbsent") {
        return result.ok({ present: false, config: null, source });
    }
    if (read.status === "OtherFailure") {
        return result.err(makeError("Read", null, `could not read trust file from ${source}: ${read.detail}`));
    }
    const text = read.bytes.toString("utf8");
    const parsed = parseTrustToml(text);
    if (!parsed.ok)
        return parsed;
    const config = validateSchema1(parsed.value);
    if (!config.ok)
        return config;
    return result.ok({ present: true, config: config.value, source });
}
const api = { parseTrustToml, validateSchema1, readTrustFile };
module.exports = api;
