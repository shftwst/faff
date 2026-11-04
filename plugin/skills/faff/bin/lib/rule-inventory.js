"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ===========================================================================
// === region:factory — rule-inventory — FAFF-1428: deleted skill prose must map to a rule-inventory row ===
//
// `faff rule-inventory check [--base REF]` compares HEAD's tree with the base's. Every block of skill
// prose (prose-size's `isCovered` set) the diff deletes must either reappear verbatim inside one block of
// skill prose at HEAD (moved), or be quoted by a row of a `## Rule inventory` table in a spec the diff adds
// under the spec docs path. Exit 0 pass or skipped, 1 fail, 2 usage / git / read error (never a pass).
// The check proves coverage, never correctness: whether a row's claim is true is review's job.
// Format: docs/reference/skill-authoring.md#rule-inventory.
// ===========================================================================
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { parseArgs } = require("./argv");
const { isCovered } = require("./prose-size");
const { loadConfig, resolveSpecDocsPath } = require("./config-core");
class CheckError extends Error {
}
const SKILLS_PREFIX = "plugin/skills/";
const ANCHORS_PREFIX = ".faff/anchors/";
const FORMAT_DOC = "docs/reference/skill-authoring.md#rule-inventory";
const MIN_ANCHOR = 20;
const MAX_SPEC_BYTES = 1024 * 1024;
const MAX_VALUE = 200;
const EXCERPT = 120;
const PLAIN_REF = /^[A-Za-z0-9._/-]+$/;
const TEST_PATH = /^test\/[A-Za-z0-9._/-]+\.test\.mjs$/;
const SKIP_NOTICE = "::notice::rule-inventory: skipped, no spec committed";
// ---------------------------------------------------------------------------
// Text helpers.
// ---------------------------------------------------------------------------
// Delete every `*` and backtick, collapse whitespace runs to one space, trim.
function normalise(s) {
    return s.replace(/[*`]/g, "").replace(/\s+/g, " ").trim();
}
const codePoints = (s) => Array.from(s).length;
// Strip control characters (ESC and newlines included) and cap at `cap` characters.
function clean(s, cap = MAX_VALUE) {
    // eslint-disable-next-line no-control-regex
    const stripped = s.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
    const cps = Array.from(stripped);
    return cps.length > cap ? cps.slice(0, cap).join("") : stripped;
}
// Escape a spec-derived value for a markdown table cell on the rendered check page.
function mdEscape(s) {
    return clean(s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/[\\`*_[\]()!|#]/g, (c) => `\\${c}`);
}
const isWatched = (p) => p.startsWith(SKILLS_PREFIX) && isCovered(p.slice(SKILLS_PREFIX.length));
// ---------------------------------------------------------------------------
// Block parsing (the authoring standard's markdown, not full CommonMark).
// ---------------------------------------------------------------------------
const FENCE_OPEN = /^(`{3,}|~{3,})/;
const HEADING = /^(#{1,6})(\s|$)/;
const LIST_ITEM = /^([-*+]|\d+\.)\s/;
const SEPARATOR = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;
function parseBlocks(file, text) {
    const blocks = [];
    const lines = text.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "")
        lines.pop();
    let cur = null;
    let fence = null;
    const open = (n, kind, level, line) => {
        const b = { file, start: n, end: n, kind, level, lines: [line] };
        blocks.push(b);
        return b;
    };
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        const n = i + 1;
        const t = line.trim();
        if (fence !== null && cur !== null) {
            cur.lines.push(line);
            cur.end = n;
            const m = FENCE_OPEN.exec(t);
            if (m && m[1] !== undefined && m[1][0] === fence.ch && m[1].length >= fence.len && t.slice(m[1].length).trim() === "") {
                fence = null;
                cur = null;
            }
            continue;
        }
        if (t === "") {
            cur = null;
            continue;
        }
        const f = FENCE_OPEN.exec(t);
        if (f && f[1] !== undefined) {
            cur = open(n, "fence", 0, line);
            fence = { ch: f[1][0] ?? "`", len: f[1].length };
            continue;
        }
        const h = HEADING.exec(t);
        if (h && h[1] !== undefined) {
            open(n, "heading", h[1].length, line);
            cur = null;
            continue;
        }
        if (t.startsWith("|")) {
            open(n, "table", 0, line);
            cur = null;
            continue;
        }
        if (LIST_ITEM.test(t)) {
            cur = open(n, "list", 0, line);
            continue;
        }
        if (cur === null) {
            cur = open(n, "para", 0, line);
            continue;
        }
        cur.lines.push(line);
        cur.end = n;
    }
    return blocks;
}
const blockText = (b) => normalise(b.lines.join(" "));
// Deleted base line numbers from `git diff -U0` hunk headers.
function deletedLines(diff) {
    const out = new Set();
    for (const m of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/gm)) {
        const start = Number(m[1]);
        const count = m[2] === undefined ? 1 : Number(m[2]);
        for (let k = 0; k < count; k++)
            out.add(start + k);
    }
    return out;
}
const hasLetter = (s) => /\p{L}/u.test(s);
// The non-exempt deleted blocks of one watched file.
function deletedBlocks(file, baseText, deleted) {
    const blocks = parseBlocks(file, baseText);
    const touched = (b) => {
        for (let n = b.start; n <= b.end; n++)
            if (deleted.has(n))
                return true;
        return false;
    };
    const delText = (b) => {
        const parts = [];
        for (let n = b.start; n <= b.end; n++)
            if (deleted.has(n))
                parts.push(b.lines[n - b.start] ?? "");
        return parts.join(" ");
    };
    const out = [];
    for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (b === undefined || !touched(b))
            continue;
        const text = delText(b);
        if (!hasLetter(text))
            continue; // letterless
        if (b.kind === "table") {
            const t = (b.lines[0] ?? "").trim();
            if (SEPARATOR.test(t))
                continue; // separator row
            // A header row: the row directly above a separator. Exempt only when every row of its table is deleted.
            const next = blocks[i + 1];
            if (next !== undefined && next.kind === "table" && next.start === b.end + 1 && SEPARATOR.test((next.lines[0] ?? "").trim())) {
                let j = i;
                let all = true;
                while (j < blocks.length) {
                    const r = blocks[j];
                    if (r === undefined || r.kind !== "table" || (j > i && r.start !== (blocks[j - 1]?.end ?? -2) + 1))
                        break;
                    if (!touched(r)) {
                        all = false;
                        break;
                    }
                    j++;
                }
                if (all)
                    continue;
            }
        }
        if (b.kind === "heading") {
            // Exempt only when its section (to the next heading of the same or higher level) is non-empty and wholly deleted.
            let j = i + 1;
            let any = false;
            let all = true;
            while (j < blocks.length) {
                const r = blocks[j];
                if (r === undefined || (r.kind === "heading" && r.level <= b.level))
                    break;
                any = true;
                if (!touched(r)) {
                    all = false;
                    break;
                }
                j++;
            }
            if (any && all)
                continue;
        }
        let first = b.start;
        while (first <= b.end && !deleted.has(first))
            first++;
        out.push({ file, base_line: first, text, norm: normalise(text) });
    }
    return out;
}
// ---------------------------------------------------------------------------
// Inventory parsing.
// ---------------------------------------------------------------------------
// Split a table row on unescaped pipes, unescaping `\|` in each cell.
function splitRow(line) {
    let t = line.trim();
    if (t.startsWith("|"))
        t = t.slice(1);
    if (t.endsWith("|") && !t.endsWith("\\|"))
        t = t.slice(0, -1);
    const cells = [];
    let cur = "";
    for (let i = 0; i < t.length; i++) {
        const c = t[i];
        if (c === "\\" && t[i + 1] === "|") {
            cur += "|";
            i++;
            continue;
        }
        if (c === "|") {
            cells.push(cur.trim());
            cur = "";
            continue;
        }
        cur += c;
    }
    cells.push(cur.trim());
    return cells;
}
// The first code span's content (CommonMark backtick runs), or null.
function firstCodeSpan(s) {
    let i = 0;
    while (i < s.length) {
        if (s[i] !== "`") {
            i++;
            continue;
        }
        let j = i;
        while (j < s.length && s[j] === "`")
            j++;
        const run = j - i;
        let k = j;
        while (k < s.length) {
            if (s[k] !== "`") {
                k++;
                continue;
            }
            let e = k;
            while (e < s.length && s[e] === "`")
                e++;
            if (e - k === run) {
                let content = s.slice(j, k);
                if (content.length >= 2 && content.startsWith(" ") && content.endsWith(" ") && content.trim() !== "")
                    content = content.slice(1, -1);
                return content;
            }
            k = e;
        }
        i = j;
    }
    return null;
}
// `test/<path>.test.mjs` entries, each optionally followed by `: "<name>"`, separated by `;` or `,`.
function parseTests(cell) {
    const tests = [];
    const errors = [];
    const s = cell.replace(/`/g, "").trim();
    if (s === "" || s === "—" || s === "-")
        return { tests, errors };
    let i = 0;
    while (i < s.length) {
        while (i < s.length && /[\s;,]/.test(s[i] ?? ""))
            i++;
        if (i >= s.length)
            break;
        let p = "";
        while (i < s.length && !/[\s:;,]/.test(s[i] ?? ""))
            p += s[i++];
        let name = null;
        let k = i;
        while (k < s.length && /\s/.test(s[k] ?? ""))
            k++;
        if (s[k] === ":") {
            k++;
            while (k < s.length && /\s/.test(s[k] ?? ""))
                k++;
            if (s[k] === "\"") {
                const close = s.indexOf("\"", k + 1);
                if (close === -1) {
                    errors.push(`covering test ${p}: unterminated test name`);
                    return { tests, errors };
                }
                name = s.slice(k + 1, close);
                i = close + 1;
            }
            else {
                errors.push(`covering test ${p}: a name after ":" must be in double quotes`);
                return { tests, errors };
            }
        }
        if (p === "") {
            errors.push("covering test cell has an entry with no path");
            break;
        }
        tests.push({ file: p, name });
    }
    return { tests, errors };
}
function parseDisposition(cell) {
    const s = normalise(cell);
    if (s === "kept")
        return { disposition: "kept", reason: null, error: null };
    const m = /^(changed|dropped):(.*)$/s.exec(s);
    if (m && (m[1] === "changed" || m[1] === "dropped")) {
        const reason = (m[2] ?? "").trim();
        if (reason === "")
            return { disposition: m[1], reason: null, error: `${m[1]} row gives no reason` };
        return { disposition: m[1], reason, error: null };
    }
    return { disposition: "invalid", reason: null, error: "disposition is not kept, changed: <reason> or dropped: <reason>" };
}
// Every inventory table in every `## Rule inventory` section of one spec.
function parseInventory(spec, text) {
    const lines = text.split("\n");
    const rows = [];
    const errors = [];
    let hasSection = false;
    let inSection = false;
    let fence = null;
    let i = 0;
    while (i < lines.length) {
        const line = lines[i] ?? "";
        const t = line.trim();
        if (fence !== null) {
            const m = FENCE_OPEN.exec(t);
            if (m && m[1] !== undefined && m[1][0] === fence.ch && m[1].length >= fence.len && t.slice(m[1].length).trim() === "")
                fence = null;
            i++;
            continue;
        }
        const f = FENCE_OPEN.exec(t);
        if (f && f[1] !== undefined) {
            fence = { ch: f[1][0] ?? "`", len: f[1].length };
            i++;
            continue;
        }
        if (line.startsWith("## ")) {
            inSection = line.startsWith("## Rule inventory");
            if (inSection)
                hasSection = true;
            i++;
            continue;
        }
        if (!inSection || !t.startsWith("|")) {
            i++;
            continue;
        }
        // A table: consecutive lines starting `|`.
        const start = i;
        const table = [];
        while (i < lines.length && (lines[i] ?? "").trim().startsWith("|"))
            table.push(lines[i++] ?? "");
        const header = splitRow(table[0] ?? "").map((c) => normalise(c).toLowerCase());
        // Columns are found by header name, case-insensitively; a qualifier after the name ("Prose rule (§0a)") is allowed.
        const col = (name) => header.findIndex((h) => h === name || h.startsWith(`${name} `) || h.startsWith(`${name}(`) || h === `${name}s`);
        const ruleCol = col("prose rule");
        const dispCol = col("disposition");
        const testCol = col("covering test");
        if (ruleCol === -1 && dispCol === -1)
            continue; // a free table
        if (ruleCol === -1 || dispCol === -1) {
            errors.push({ spec, line: start + 1, reason: `inventory table header needs both a Prose rule and a Disposition column` });
            continue;
        }
        let hasKept = false;
        for (let r = 1; r < table.length; r++) {
            const raw = table[r] ?? "";
            if (SEPARATOR.test(raw.trim()))
                continue;
            const cells = splitRow(raw);
            const lineNo = start + r + 1;
            const span = firstCodeSpan(cells[ruleCol] ?? "");
            const anchor = span === null ? null : normalise(span);
            const disp = parseDisposition(cells[dispCol] ?? "");
            const parsedTests = testCol === -1 ? { tests: [], errors: [] } : parseTests(cells[testCol] ?? "");
            const row = { spec, line: lineNo, anchor: anchor === "" ? null : anchor, tests: parsedTests.tests, disposition: disp.disposition, reason: disp.reason };
            rows.push(row);
            if (disp.disposition === "kept")
                hasKept = true;
            if (disp.error !== null)
                errors.push({ spec, line: lineNo, reason: disp.error });
            for (const e of parsedTests.errors)
                errors.push({ spec, line: lineNo, reason: e });
        }
        if (hasKept && testCol === -1)
            errors.push({ spec, line: start + 1, reason: "a table with a kept row needs a Covering test column" });
    }
    return { hasSection, rows, errors };
}
// A valid anchor covers a deleted block when it is ≥ 20 characters and inside the block's deleted text,
// or when it equals that whole text. A short anchor never covers a longer block that contains it.
function covers(anchor, b) {
    return (codePoints(anchor) >= MIN_ANCHOR && b.norm.includes(anchor)) || anchor === b.norm;
}
// ---------------------------------------------------------------------------
// Git.
// ---------------------------------------------------------------------------
function defaultGit(repo) {
    return (args, input) => {
        const r = spawnSync("git", ["-c", "core.quotePath=false", ...args], {
            cwd: repo, input, maxBuffer: 256 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        });
        return {
            status: r.status === null ? 128 : r.status,
            stdout: Buffer.isBuffer(r.stdout) ? r.stdout : Buffer.alloc(0),
            stderr: Buffer.isBuffer(r.stderr) ? r.stderr.toString("utf8") : String(r.stderr ?? ""),
        };
    };
}
function must(git, args, what, input) {
    const r = git(args, input);
    if (r.status !== 0)
        throw new CheckError(`git failed (${what}): ${clean(r.stderr.trim().split("\n")[0] ?? "", MAX_VALUE)}`);
    return r.stdout;
}
const UTF8 = new TextDecoder("utf-8", { fatal: true });
// `git diff -z --name-status` output. A path that is not valid UTF-8 is decoded only to test its prefix.
function parseNameStatus(buf) {
    const parts = [];
    let s = 0;
    for (let i = 0; i < buf.length; i++)
        if (buf[i] === 0) {
            parts.push(buf.subarray(s, i));
            s = i + 1;
        }
    if (s < buf.length)
        parts.push(buf.subarray(s));
    const out = [];
    for (let i = 0; i + 1 < parts.length; i += 2) {
        const status = (parts[i] ?? Buffer.alloc(0)).toString("latin1");
        const raw = parts[i + 1] ?? Buffer.alloc(0);
        let p;
        try {
            p = UTF8.decode(raw);
        }
        catch {
            const latin = raw.toString("latin1");
            if (latin.startsWith(SKILLS_PREFIX))
                throw new CheckError("a changed path under plugin/skills/ is not valid UTF-8");
            p = latin;
            if (latin.startsWith(ANCHORS_PREFIX)) {
                out.push({ status, path: latin });
                continue;
            }
            out.push({ status: "X", path: latin });
            continue;
        }
        out.push({ status, path: p });
    }
    return out;
}
// Read many blobs in one `git cat-file --batch`. A missing object throws.
function readBlobs(git, revs) {
    if (revs.length === 0)
        return [];
    for (const r of revs)
        if (r.includes("\n"))
            throw new CheckError("a path contains a newline");
    const out = must(git, ["cat-file", "--batch"], "cat-file --batch", Buffer.from(revs.map((r) => `${r}\n`).join(""), "utf8"));
    const texts = [];
    let pos = 0;
    for (const rev of revs) {
        const nl = out.indexOf(0x0a, pos);
        if (nl === -1)
            throw new CheckError("git cat-file --batch output truncated");
        const header = out.subarray(pos, nl).toString("utf8");
        const m = /^[0-9a-f]+ (\S+) (\d+)$/.exec(header);
        if (!m || m[1] !== "blob")
            throw new CheckError(`cannot read ${clean(rev)}`);
        const size = Number(m[2]);
        texts.push(out.subarray(nl + 1, nl + 1 + size).toString("utf8"));
        pos = nl + 1 + size + 1;
    }
    return texts;
}
function emptyResult() {
    return {
        result: "pass", skipped_reason: null, footprint_without_spec: false, base: "", specs: [],
        blocks_deleted: 0, covered_moved: 0, covered_by_row: 0, row_covered: [], uncovered: [], row_errors: [], warnings: [],
    };
}
// Run the check. Throws CheckError for every exit-2 condition.
function check(opts) {
    const git = opts.git ?? defaultGit(opts.repo);
    const res = emptyResult();
    // 1. Resolve the base.
    let base;
    if (opts.base !== null) {
        if (!PLAIN_REF.test(opts.base) || opts.base.startsWith("-"))
            throw new CheckError(`--base ${clean(opts.base)} is not a plain ref`);
        const r = git(["rev-parse", "--verify", "--quiet", `${opts.base}^{commit}`]);
        if (r.status !== 0)
            throw new CheckError(`--base ${clean(opts.base)} names no commit`);
        base = r.stdout.toString("utf8").trim();
    }
    else {
        const o = git(["rev-parse", "--verify", "--quiet", "origin/HEAD^{commit}"]);
        if (o.status !== 0) {
            res.result = "skipped";
            res.skipped_reason = "no-base";
            return { result: res, notice: false };
        }
        base = must(git, ["merge-base", "origin/HEAD", "HEAD"], "merge-base origin/HEAD HEAD").toString("utf8").trim();
    }
    if (!/^[0-9a-f]{40,64}$/.test(base))
        throw new CheckError("the base did not resolve to a commit");
    res.base = base;
    must(git, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], "rev-parse HEAD");
    // 2. Changed paths.
    const changed = parseNameStatus(must(git, ["diff", "-z", "--no-renames", "--no-ext-diff", "--name-status", base, "HEAD"], "diff --name-status"));
    let specDir;
    try {
        specDir = String(resolveSpecDocsPath(opts.repo, loadConfig(opts.repo)[0], false)).replace(/\/+$/, "");
    }
    catch (e) {
        throw new CheckError(`config unreadable: ${clean(e instanceof Error ? e.message : String(e))}`);
    }
    const watched = changed.filter((c) => isWatched(c.path));
    const specs = changed.filter((c) => c.status === "A" && c.path.startsWith(`${specDir}/`) && c.path.endsWith("-design.md")).map((c) => c.path).sort();
    const footprint = changed.some((c) => (c.status === "A" || c.status === "M" || c.status === "T") && c.path.startsWith(ANCHORS_PREFIX));
    res.specs = specs;
    // 3. Deleted blocks.
    const deleted = [];
    const withBase = watched.filter((c) => c.status !== "A");
    const baseTexts = readBlobs(git, withBase.map((c) => `${base}:${c.path}`));
    withBase.forEach((c, k) => {
        const diff = must(git, ["diff", "-U0", "--no-renames", "--no-ext-diff", "--no-color", "--no-textconv", base, "HEAD", "--", c.path], `diff ${c.path}`).toString("utf8");
        deleted.push(...deletedBlocks(c.path, baseTexts[k] ?? "", deletedLines(diff)));
    });
    res.blocks_deleted = deleted.length;
    // 4–5. Scope.
    if (deleted.length === 0) {
        res.result = "skipped";
        res.skipped_reason = "no-prose-deleted";
        return { result: res, notice: false };
    }
    if (specs.length === 0 && footprint) {
        res.result = "fail";
        res.footprint_without_spec = true;
        return { result: res, notice: false };
    }
    if (specs.length === 0) {
        res.result = "skipped";
        res.skipped_reason = "no-spec-committed";
        return { result: res, notice: true };
    }
    // 6. Head blocks of every watched file at HEAD.
    const tree = must(git, ["ls-tree", "-r", "-z", "--name-only", "HEAD", "--", SKILLS_PREFIX], "ls-tree HEAD");
    const headPaths = tree.toString("utf8").split("\0").filter((p) => p !== "" && isWatched(p));
    const headTexts = readBlobs(git, headPaths.map((p) => `HEAD:${p}`));
    const headBlocks = [];
    headPaths.forEach((p, k) => { for (const b of parseBlocks(p, headTexts[k] ?? ""))
        headBlocks.push(blockText(b)); });
    // 7. Rows.
    const rows = [];
    let anySection = false;
    for (const spec of specs) {
        const size = Number(must(git, ["cat-file", "-s", `HEAD:${spec}`], `cat-file -s ${spec}`).toString("utf8").trim());
        if (!Number.isFinite(size) || size > MAX_SPEC_BYTES)
            throw new CheckError(`committed spec ${clean(spec)} is larger than 1 MiB`);
        const text = readBlobs(git, [`HEAD:${spec}`])[0] ?? "";
        const parsed = parseInventory(spec, text);
        if (parsed.hasSection)
            anySection = true;
        rows.push(...parsed.rows);
        res.row_errors.push(...parsed.errors);
    }
    // 8. Validate rows.
    const valid = [];
    const rowErrorsAt = new Set(res.row_errors.map((e) => `${e.spec}\0${e.line}`));
    for (const row of rows) {
        const errs = [];
        if (row.anchor === null)
            errs.push("Prose rule cell has no code-span anchor");
        else if (codePoints(row.anchor) < MIN_ANCHOR && !deleted.some((b) => b.norm === row.anchor))
            errs.push("anchor shorter than 20 characters");
        if (row.disposition === "kept" && row.tests.length === 0)
            errs.push("kept row names no covering test");
        for (const t of row.tests) {
            if (!TEST_PATH.test(t.file) || t.file.split("/").includes("..")) {
                errs.push(`covering test ${t.file} is not a test/<path>.test.mjs path`);
                continue;
            }
            if (git(["cat-file", "-e", `HEAD:${t.file}`]).status !== 0) {
                errs.push(`covering test ${t.file} does not exist`);
                continue;
            }
            if (t.name !== null) {
                const body = readBlobs(git, [`HEAD:${t.file}`])[0] ?? "";
                if (!body.includes(t.name))
                    errs.push(`covering test ${t.file} has no test named "${t.name}"`);
            }
        }
        for (const e of errs)
            res.row_errors.push({ spec: row.spec, line: row.line, reason: e });
        if (errs.length === 0 && !rowErrorsAt.has(`${row.spec}\0${row.line}`))
            valid.push(row);
    }
    // 9. Classify each deleted block.
    for (const b of deleted) {
        if (headBlocks.some((h) => h.includes(b.norm))) {
            res.covered_moved++;
            continue;
        }
        const row = valid.find((r) => r.anchor !== null && covers(r.anchor, b));
        if (row !== undefined) {
            res.covered_by_row++;
            res.row_covered.push({ file: b.file, base_line: b.base_line, disposition: row.disposition, reason: row.reason, spec: row.spec, spec_line: row.line });
            continue;
        }
        res.uncovered.push({ file: b.file, base_line: b.base_line, excerpt: clean(b.text.trim(), EXCERPT) });
    }
    // 10. Rows that match nothing.
    for (const row of valid) {
        if (row.anchor !== null && !deleted.some((b) => covers(row.anchor ?? "", b))) {
            res.warnings.push(`${row.spec}:${row.line}: anchor matches no deleted prose`);
        }
    }
    // 11. No inventory at all while something is uncovered.
    if (res.uncovered.length > 0 && !anySection) {
        for (const spec of specs)
            res.row_errors.push({ spec, line: 1, reason: "no ## Rule inventory section" });
    }
    res.result = res.uncovered.length > 0 || res.row_errors.length > 0 ? "fail" : "pass";
    return { result: res, notice: false };
}
// Every spec-derived string in the result, stripped of control characters and capped.
function cleanResult(r) {
    return {
        ...r,
        specs: r.specs.map((s) => clean(s)),
        row_covered: r.row_covered.map((c) => ({ ...c, file: clean(c.file), disposition: clean(c.disposition), reason: c.reason === null ? null : clean(c.reason), spec: clean(c.spec) })),
        uncovered: r.uncovered.map((u) => ({ ...u, file: clean(u.file), excerpt: clean(u.excerpt, EXCERPT) })),
        row_errors: r.row_errors.map((e) => ({ ...e, spec: clean(e.spec), reason: clean(e.reason) })),
        warnings: r.warnings.map((w) => clean(w)),
    };
}
const DISPOSITION_ORDER = { dropped: 0, changed: 1, kept: 2 };
function renderSummary(r) {
    const out = ["", "### rule-inventory", ""];
    if (r.result === "skipped") {
        out.push(`rule-inventory: skipped (${r.skipped_reason ?? ""})`, "");
        return out.join("\n");
    }
    out.push(`rule-inventory: ${r.result} — ${r.blocks_deleted} deleted block(s), ${r.covered_moved} moved, ${r.covered_by_row} covered by a row, ${r.uncovered.length} uncovered`, "");
    const rows = [...r.row_covered].sort((a, b) => (DISPOSITION_ORDER[a.disposition] ?? 3) - (DISPOSITION_ORDER[b.disposition] ?? 3));
    if (rows.length > 0) {
        out.push("| Disposition | Reason | Deleted block | Inventory row |", "|---|---|---|---|");
        for (const c of rows) {
            out.push(`| ${mdEscape(c.disposition)} | ${c.reason === null ? "" : mdEscape(c.reason)} | ${mdEscape(c.file)}:${c.base_line} | ${mdEscape(c.spec)}:${c.spec_line} |`);
        }
        out.push("");
    }
    return out.join("\n");
}
function renderText(r) {
    const out = [];
    for (const u of r.uncovered)
        out.push(`rule-inventory: uncovered ${u.file}:${u.base_line}: ${u.excerpt} (format: ${FORMAT_DOC})`);
    for (const e of r.row_errors)
        out.push(`rule-inventory: row-error ${e.spec}:${e.line}: ${e.reason}`);
    for (const w of r.warnings)
        out.push(`rule-inventory: warning ${w}`);
    if (r.footprint_without_spec)
        out.push(`rule-inventory: agent footprint (.faff/anchors/) with no committed spec; deleted skill prose needs a spec with a Rule inventory (format: ${FORMAT_DOC})`);
    const counts = r.result === "skipped"
        ? `${r.skipped_reason ?? ""}`
        : `${r.blocks_deleted} deleted, ${r.covered_moved} moved, ${r.covered_by_row} by row, ${r.uncovered.length} uncovered, ${r.row_errors.length} row error(s)`;
    out.push(`rule-inventory: ${r.result} (${counts})`);
    return `${out.join("\n")}\n`;
}
// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------
const CHECK_SPEC = { flags: { "--base": { arity: 1 }, "--json": { arity: 0 }, "--summary": { arity: 1 } } };
const USAGE = "rule-inventory: usage: faff rule-inventory check [--base REF] [--json] [--summary FILE]\n" +
    "rule-inventory: --base REF compares REF's tree with HEAD's; pass a merge-base (without it, the merge-base with origin/HEAD).";
function fail2(msg) {
    process.stderr.write(`rule-inventory: ${msg}\n${USAGE}\n`);
    return 2;
}
function cmdCheck(args) {
    const { values, positionals, errors } = parseArgs(args, CHECK_SPEC);
    if (errors.length)
        return fail2(clean(String(errors[0]?.detail ?? "bad arguments")));
    if (positionals.length)
        return fail2(`unexpected argument ${clean(String(positionals[0]))}`);
    const base = typeof values["--base"] === "string" ? values["--base"] : null;
    const summary = typeof values["--summary"] === "string" ? values["--summary"] : null;
    let repo;
    try {
        const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
        if (r.status !== 0)
            return fail2("not inside a git repository");
        repo = String(r.stdout).trim();
    }
    catch {
        return fail2("git is not runnable");
    }
    let outcome;
    try {
        outcome = check({ repo, base });
    }
    catch (e) {
        if (e instanceof CheckError)
            return fail2(e.message);
        return fail2(`unexpected error: ${clean(e instanceof Error ? e.message : String(e))}`);
    }
    const result = cleanResult(outcome.result);
    if (summary !== null) {
        try {
            fs.appendFileSync(path.resolve(summary), renderSummary(result));
        }
        catch (e) {
            return fail2(`cannot write --summary file: ${clean(e instanceof Error ? e.message : String(e))}`);
        }
    }
    if (values["--json"] === true)
        process.stdout.write(`${JSON.stringify(result)}\n`);
    else {
        if (outcome.notice)
            process.stdout.write(`${SKIP_NOTICE}\n`);
        process.stdout.write(renderText(result));
    }
    return result.result === "fail" ? 1 : 0;
}
function cmdRuleInventory(args) {
    const sub = args[0];
    if (sub === "check")
        return cmdCheck(args.slice(1));
    return fail2(sub === undefined ? "missing subcommand" : `unknown subcommand ${clean(sub)}`);
}
module.exports = {
    normalise, clean, mdEscape, isWatched, parseBlocks, deletedLines, deletedBlocks, splitRow, firstCodeSpan,
    parseTests, parseDisposition, parseInventory, covers, parseNameStatus, check, renderText, renderSummary,
    cmdRuleInventory, CheckError, MIN_ANCHOR, SKIP_NOTICE,
};
