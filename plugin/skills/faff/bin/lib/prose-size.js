"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ===========================================================================
// === region:factory — prose-size — FAFF-1442: skill prose measured in bytes, ratcheted down ===
//
// The covered set is every `<skills-dir>/<skill>/SKILL.md` and every `<skills-dir>/<skill>/references/*.md`
// (not recursive): the files an agent loads as skill prose. `prose-baseline.json` beside this CLI records the
// exact byte size of each. `faff validate-adapters` calls proseRatchet() after its line-cap loop, so a file
// that grows fails and a file that shrinks prints a RATCHET advisory; every line check stays as it was.
// `faff prose-size baseline --lower` locks reductions and never raises, adds or removes an entry.
// `faff prose-size tally` derives the prose-size history from git (`git ls-tree -l`), never the working tree.
// ===========================================================================
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { parseArgs, usageError } = require("./argv");
const BASELINE_FILE = "prose-baseline.json";
const HOT_FILES = ["faff-beep-boop/SKILL.md", "faff-graft/SKILL.md", "faff-prep/SKILL.md"];
const SKILLS_PREFIX = "plugin/skills/";
function get(v, k) {
    return Reflect.get(Object(v), k);
}
const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const sortedKeys = (o) => Object.keys(o).sort();
const sumSizes = (o) => Object.values(o).reduce((a, b) => a + b, 0);
// A skills-dir-relative path (`/` separators) is in the covered set.
function isCovered(rel) {
    return /^[^/]+\/SKILL\.md$/.test(rel) || /^[^/]+\/references\/[^/]+\.md$/.test(rel);
}
// The baseline path for a skills dir.
function baselinePath(skillsDir) {
    return path.join(skillsDir, "faff", BASELINE_FILE);
}
// The default skills dir: this module lives at <skills>/faff/bin/lib/.
function defaultSkillsDir() {
    return path.resolve(__dirname, "..", "..", "..");
}
// Every covered file under skillsDir, as sorted skills-dir-relative paths. Only regular files count.
function coveredFiles(skillsDir) {
    const out = [];
    const isFile = (p) => {
        try {
            return fs.statSync(p).isFile();
        }
        catch {
            return false;
        }
    };
    const isDir = (p) => {
        try {
            return fs.statSync(p).isDirectory();
        }
        catch {
            return false;
        }
    };
    const skills = fs.readdirSync(skillsDir).filter((d) => isDir(path.join(skillsDir, d)));
    for (const skill of skills) {
        if (isFile(path.join(skillsDir, skill, "SKILL.md")))
            out.push(`${skill}/SKILL.md`);
        const refDir = path.join(skillsDir, skill, "references");
        if (!isDir(refDir))
            continue;
        const refs = fs.readdirSync(refDir);
        for (const name of refs) {
            if (name.endsWith(".md") && isFile(path.join(refDir, name)))
                out.push(`${skill}/references/${name}`);
        }
    }
    return out.sort();
}
// The on-disk byte size of every covered file.
function measure(skillsDir) {
    const sizes = {};
    for (const rel of coveredFiles(skillsDir))
        sizes[rel] = fs.statSync(path.join(skillsDir, ...rel.split("/"))).size;
    return sizes;
}
// Validate a parsed baseline document. Pure.
function validateBaseline(doc) {
    if (!isPlainObject(doc))
        return { ok: false, reason: "not a JSON object", missing: false };
    if (get(doc, "schema") !== 1)
        return { ok: false, reason: "schema is not 1", missing: false };
    const files = get(doc, "files");
    if (!isPlainObject(files))
        return { ok: false, reason: "files is not an object", missing: false };
    const out = {};
    for (const key of Object.keys(Object(files))) {
        const v = get(files, key);
        if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
            return { ok: false, reason: `value for "${key}" is not a non-negative integer`, missing: false };
        }
        out[key] = v;
    }
    return { ok: true, files: out };
}
// Read and validate a baseline file. Never throws.
function readBaseline(file) {
    if (!fs.existsSync(file))
        return { ok: false, reason: "missing", missing: true };
    let text;
    try {
        text = fs.readFileSync(file, "utf8");
    }
    catch (e) {
        return { ok: false, reason: `unreadable: ${e instanceof Error ? e.message : String(e)}`, missing: false };
    }
    let doc;
    try {
        doc = JSON.parse(text);
    }
    catch {
        return { ok: false, reason: "not valid JSON", missing: false };
    }
    return validateBaseline(doc);
}
// Compare measured sizes with a baseline. Pure, no I/O; output sorted by path.
function compareProse(measured, base) {
    const fails = [];
    const ratchets = [];
    const all = [...new Set([...Object.keys(measured), ...Object.keys(base)])].sort();
    for (const rel of all) {
        const m = measured[rel];
        const b = base[rel];
        if (m === undefined && b !== undefined)
            fails.push({ path: rel, kind: "stale", baseline: b });
        else if (m !== undefined && b === undefined)
            fails.push({ path: rel, kind: "unlisted", bytes: m });
        else if (m !== undefined && b !== undefined) {
            if (m > b)
                fails.push({ path: rel, kind: "grew", bytes: m, baseline: b, delta: m - b });
            else if (m < b)
                ratchets.push({ path: rel, bytes: m, baseline: b, delta: b - m });
        }
    }
    return { fails, ratchets };
}
// The byte ratchet as validate-adapters prints it. `required` is true when the skills dir was not given
// explicitly (the bundled tree), so a missing baseline fails closed there and only skips for a fixture dir.
function proseRatchet(skillsDir, required) {
    const file = baselinePath(skillsDir);
    const read = readBaseline(file);
    if (!read.ok) {
        if (read.missing && !required)
            return { failed: false, lines: [`INFO  prose bytes: no baseline at faff/${BASELINE_FILE}; byte ratchet not applied`] };
        return { failed: true, lines: [`FAIL  ${BASELINE_FILE} (prose bytes)`, `        ✗ ${read.reason}: faff/${BASELINE_FILE}`] };
    }
    let measured;
    try {
        measured = measure(skillsDir);
    }
    catch (e) {
        return { failed: true, lines: [`FAIL  ${BASELINE_FILE} (prose bytes)`, `        ✗ could not measure the covered files: ${e instanceof Error ? e.message : String(e)}`] };
    }
    const { fails, ratchets } = compareProse(measured, read.files);
    const lines = [];
    for (const f of fails) {
        lines.push(`FAIL  ${f.path} (prose bytes)`);
        if (f.kind === "grew")
            lines.push(`        ✗ ${f.path} is ${f.bytes} bytes (baseline ${f.baseline}, +${f.delta})`);
        else if (f.kind === "unlisted")
            lines.push(`        ✗ not in ${BASELINE_FILE}; add "${f.path}": ${f.bytes}`);
        else
            lines.push(`        ✗ listed in ${BASELINE_FILE} but missing; remove the entry`);
    }
    for (const r of ratchets) {
        lines.push(`RATCHET  ${r.path} — now ${r.bytes} bytes, below baseline ${r.baseline} (-${r.delta}); run faff prose-size baseline --lower to lock the reduction`);
    }
    return { failed: fails.length > 0, lines };
}
// The baseline file's bytes: keys sorted, one entry per line, a blank line between entries, so two changes to
// neighbouring entries never touch adjacent lines.
function serialiseBaseline(files) {
    const entries = sortedKeys(files).map((k) => `    ${JSON.stringify(k)}: ${files[k]}`);
    return `{\n  "schema": 1,\n  "files": {\n${entries.join(",\n\n")}\n  }\n}\n`;
}
// Lower every entry whose file is now smaller. Pure: never raises, adds or removes an entry.
function lowerBaseline(measured, base) {
    const files = { ...base };
    const report = { lowered: [], grown: [], unlisted: [], missing: [] };
    for (const rel of sortedKeys(base)) {
        const b = base[rel];
        const m = measured[rel];
        if (b === undefined)
            continue;
        if (m === undefined)
            report.missing.push({ path: rel, baseline: b });
        else if (m < b) {
            files[rel] = m;
            report.lowered.push({ path: rel, from: b, to: m });
        }
        else if (m > b)
            report.grown.push({ path: rel, bytes: m, baseline: b });
    }
    for (const rel of sortedKeys(measured)) {
        const m = measured[rel];
        if (m !== undefined && base[rel] === undefined)
            report.unlisted.push({ path: rel, bytes: m });
    }
    return { files, report };
}
const defaultGit = (repo, args) => {
    const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    return { status: typeof r.status === "number" ? r.status : 1, stdout: typeof r.stdout === "string" ? r.stdout : "" };
};
// The last parenthesised `<KEY>-<n>` in a commit subject, else `untagged`.
function ticketOf(subject) {
    const all = [...subject.matchAll(/\(([A-Za-z][A-Za-z0-9]*-[0-9]+)\)/g)];
    const last = all[all.length - 1];
    return last === undefined || last[1] === undefined ? "untagged" : last[1];
}
// Parse `git ls-tree -r -l -z` output (NUL-separated, so paths are never C-quoted) into covered sizes for a
// scope. Newline-separated output is accepted too. Pure.
function parseLsTree(out, scope) {
    const sizes = {};
    for (const line of out.split(/\0|\n/)) {
        const tab = line.indexOf("\t");
        if (tab === -1)
            continue;
        const meta = line.slice(0, tab).trim().split(/\s+/);
        const full = line.slice(tab + 1);
        if (meta[1] !== "blob" || !full.startsWith(SKILLS_PREFIX))
            continue;
        const rel = full.slice(SKILLS_PREFIX.length);
        if (!isCovered(rel))
            continue;
        if (scope === "hot" && !HOT_FILES.includes(rel))
            continue;
        const size = Number(meta[3]);
        if (Number.isInteger(size))
            sizes[rel] = size;
    }
    return sizes;
}
function tally(opts, git = defaultGit) {
    const resolve = (ref) => {
        const r = git(opts.repo, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
        const sha = r.stdout.trim();
        return r.status === 0 && /^[0-9a-f]{40,64}$/.test(sha) ? sha : null;
    };
    const top = git(opts.repo, ["rev-parse", "--show-toplevel"]);
    if (top.status !== 0)
        return { ok: false, reason: `not a git repository: ${opts.repo}` };
    const root = top.stdout.trim();
    const from = resolve(opts.from);
    if (from === null)
        return { ok: false, reason: `cannot resolve --from ${opts.from}` };
    const to = resolve(opts.to);
    if (to === null)
        return { ok: false, reason: `cannot resolve --to ${opts.to}` };
    const sizesAt = (sha) => {
        const r = git(root, ["ls-tree", "-r", "-l", "-z", sha, "--", "plugin/skills"]);
        return r.status === 0 ? parseLsTree(r.stdout, opts.scope) : null;
    };
    const list = git(root, ["rev-list", "--first-parent", "--reverse", `${from}..${to}`]);
    if (list.status !== 0)
        return { ok: false, reason: `git rev-list failed for ${from}..${to}` };
    let prev = sizesAt(from);
    if (prev === null)
        return { ok: false, reason: `git ls-tree failed at ${from}` };
    const start = sumSizes(prev);
    const rows = [];
    for (const sha of list.stdout.split("\n").map((s) => s.trim()).filter(Boolean)) {
        const cur = sizesAt(sha);
        if (cur === null)
            return { ok: false, reason: `git ls-tree failed at ${sha}` };
        const files = {};
        let delta = 0;
        for (const rel of [...new Set([...Object.keys(prev), ...Object.keys(cur)])].sort()) {
            const d = (cur[rel] ?? 0) - (prev[rel] ?? 0);
            if (d !== 0) {
                files[rel] = d;
                delta += d;
            }
        }
        if (delta !== 0) {
            const subj = git(root, ["log", "-1", "--format=%s", sha]).stdout.trim();
            rows.push({ sha, ticket: ticketOf(subj), subject: subj, delta, total: sumSizes(cur), files });
        }
        prev = cur;
    }
    const end = sumSizes(prev);
    const grouped = new Set();
    const groups = opts.groups.map((g) => {
        for (const t of g.tickets)
            grouped.add(t);
        const net = rows.filter((r) => g.tickets.includes(r.ticket)).reduce((a, r) => a + r.delta, 0);
        return { label: g.label, tickets: g.tickets, net };
    });
    const other = rows.filter((r) => !grouped.has(r.ticket)).reduce((a, r) => a + r.delta, 0);
    return { ok: true, result: { from, to, scope: opts.scope, start_bytes: start, end_bytes: end, net: end - start, rows, groups, other_net: other } };
}
// `--group <label>=<T1>,<T2>,...` → { label, tickets }, or null when malformed.
function parseGroup(spec) {
    const eq = spec.indexOf("=");
    if (eq <= 0)
        return null;
    const tickets = spec.slice(eq + 1).split(",").map((t) => t.trim()).filter(Boolean);
    return tickets.length === 0 ? null : { label: spec.slice(0, eq), tickets };
}
const signed = (n) => (n > 0 ? `+${n}` : String(n));
function renderTally(r) {
    const out = [];
    for (const row of r.rows)
        out.push(`${row.sha.slice(0, 8)} ${row.ticket} ${signed(row.delta)} ${row.total}`);
    for (const g of r.groups)
        out.push(`group ${g.label} (${g.tickets.join(",")}) ${signed(g.net)}`);
    out.push(`other ${signed(r.other_net)}`);
    out.push(`start ${r.start_bytes}`, `end ${r.end_bytes}`, `net ${signed(r.net)}`);
    return `${out.join("\n")}\n`;
}
// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------
const BASELINE_SPEC = { flags: { "--lower": { arity: 0 }, "--skills-dir": { arity: 1 }, "--json": { arity: 0 } } };
const TALLY_SPEC = {
    flags: {
        "--from": { arity: 1 }, "--to": { arity: 1 }, "--scope": { arity: 1, enum: ["all", "hot"] },
        "--group": { arity: 1, repeatable: true }, "--repo": { arity: 1 }, "--json": { arity: 0 },
    },
};
const BASELINE_USAGE = "usage: faff prose-size baseline --lower [--skills-dir DIR] [--json]";
const TALLY_USAGE = "usage: faff prose-size tally --from REF --to REF [--scope all|hot] [--group LABEL=T1,T2,...]... [--repo DIR] [--json]";
const PROSE_USAGE = `${BASELINE_USAGE}\n       ${TALLY_USAGE}`;
function cmdBaseline(args) {
    const { values, errors } = parseArgs(args, BASELINE_SPEC);
    if (errors.length)
        return usageError(errors, BASELINE_USAGE);
    if (values["--lower"] !== true) {
        process.stderr.write(`faff prose-size baseline: --lower is required (the baseline is only ever lowered by this command)\n${BASELINE_USAGE}\n`);
        return 2;
    }
    const skillsDir = typeof values["--skills-dir"] === "string" ? values["--skills-dir"] : defaultSkillsDir();
    const file = baselinePath(skillsDir);
    const read = readBaseline(file);
    if (!read.ok) {
        process.stderr.write(`faff prose-size baseline: ${read.reason}: ${file}\n`);
        return 2;
    }
    let measured;
    try {
        measured = measure(skillsDir);
    }
    catch (e) {
        process.stderr.write(`faff prose-size baseline: could not measure the covered files: ${e instanceof Error ? e.message : String(e)}\n`);
        return 2;
    }
    const { files, report } = lowerBaseline(measured, read.files);
    try {
        fs.writeFileSync(file, serialiseBaseline(files));
    }
    catch (e) {
        process.stderr.write(`faff prose-size baseline: write failed: ${e instanceof Error ? e.message : String(e)}\n`);
        return 2;
    }
    const result = { baseline: file, ...report };
    if (values["--json"] === true) {
        process.stdout.write(`${JSON.stringify(result)}\n`);
        return 0;
    }
    const out = [];
    for (const l of report.lowered)
        out.push(`lowered  ${l.path} ${l.from} -> ${l.to}`);
    for (const g of report.grown)
        out.push(`grown    ${g.path} is ${g.bytes} bytes (baseline ${g.baseline}); not raised — raise it by hand if the growth is intended`);
    for (const u of report.unlisted)
        out.push(`unlisted ${u.path} (${u.bytes} bytes); not added — add it by hand`);
    for (const m of report.missing)
        out.push(`missing  ${m.path} (baseline ${m.baseline}); not removed — remove it by hand`);
    out.push(`${report.lowered.length} entr${report.lowered.length === 1 ? "y" : "ies"} lowered in ${file}`);
    process.stdout.write(`${out.join("\n")}\n`);
    return 0;
}
function cmdTally(args) {
    const { values, errors } = parseArgs(args, TALLY_SPEC);
    if (errors.length)
        return usageError(errors, TALLY_USAGE);
    const from = values["--from"];
    const to = values["--to"];
    if (typeof from !== "string" || typeof to !== "string") {
        process.stderr.write(`faff prose-size tally: --from and --to are required\n${TALLY_USAGE}\n`);
        return 2;
    }
    const groupSpecs = values["--group"];
    const groups = [];
    for (const spec of Array.isArray(groupSpecs) ? groupSpecs : []) {
        const g = typeof spec === "string" ? parseGroup(spec) : null;
        if (g === null) {
            process.stderr.write(`faff prose-size tally: malformed --group ${String(spec)} (want LABEL=T1,T2,...)\n${TALLY_USAGE}\n`);
            return 2;
        }
        groups.push(g);
    }
    const scope = values["--scope"] === "hot" ? "hot" : "all";
    const repo = typeof values["--repo"] === "string" ? values["--repo"] : process.cwd();
    const outcome = tally({ repo, from, to, scope, groups });
    if (!outcome.ok) {
        process.stderr.write(`faff prose-size tally: ${outcome.reason}\n`);
        return 2;
    }
    process.stdout.write(values["--json"] === true ? `${JSON.stringify(outcome.result)}\n` : renderTally(outcome.result));
    return 0;
}
function cmdProseSize(args) {
    const sub = args[0];
    if (sub === "baseline")
        return cmdBaseline(args.slice(1));
    if (sub === "tally")
        return cmdTally(args.slice(1));
    process.stderr.write(`faff prose-size: ${sub === undefined ? "missing subcommand" : `unknown subcommand '${sub}'`}\n${PROSE_USAGE}\n`);
    return 2;
}
module.exports = {
    BASELINE_FILE, HOT_FILES, isCovered, baselinePath, defaultSkillsDir, coveredFiles, measure, validateBaseline,
    readBaseline, compareProse, proseRatchet, serialiseBaseline, lowerBaseline, ticketOf, parseLsTree, tally,
    parseGroup, renderTally, cmdProseSize,
};
