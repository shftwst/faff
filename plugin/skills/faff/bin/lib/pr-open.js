"use strict";
// ===========================================================================
// === region:factory — pr-open — FAFF-1416: graft Step 9b's PR opening as one command ===
//
// `faff pr open` runs the ordered PR-opening sequence graft's Step 9b used to describe in prose and
// returns one typed token for the skill to route. The order is the safety property: the review
// verdict is `pass`, the body is sanitized and checked, the anchor is minted, committed and pushed,
// and only then does `faff pr-create` open the PR. Every refusal that can be decided before the push
// is decided before the push.
//
// It composes the existing commands and changes none of them: `faff pr-create` stays the sole
// `gh pr create` path and keeps verifying a grant it did not mint; `faff events anchor`, `faff bundle
// publish`, `faff evidence write`, `faff effects declare|observe` and `faff commissaire effect
// declare|authorize|observe` are spawned as they are; the pr-body sanitizer and checker run
// in-process. Commissaire is reached only through its existing verbs. The command never writes the
// tracker: on `opened` / `already-open` it returns the In Review transition as a descriptor.
//
// Exit codes: 0 opened / already-open / no-op; 1 refused; 2 errored; 3 needs-human.
// ===========================================================================
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const argvApi = require("./argv");
const ghApi = require("./merge-gate-gh");
const floorApi = require("./merge-gate-floor");
const sharedInfraApi = require("./shared-infra");
const prBodyApi = require("./pr-body");
const eventsApi = require("./events");
const effectsApi = require("./merge-gate-effects");
const mergeAuthorizeApi = require("./merge-authorize");
const FAFF_BIN = path.resolve(__dirname, "..", "faff");
const STATUS_TIMEOUT_MS = 30 * 1000;
const DEFAULT_TIMEOUT_MS = 120 * 1000;
// The same issue-id shape `faff pr-create` accepts.
const ISSUE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PR_OPEN_SPEC = {
    flags: {
        "--run-dir": { arity: 1 }, "--issue": { arity: 1 }, "--base": { arity: 1 }, "--title": { arity: 1 },
        "--body-file": { arity: 1 }, "--spec-review-evidence": { arity: 1 }, "--json": { arity: 0 },
    },
};
const HUMAN_ONLY_ACS = "human-only-acs.json";
const LEVELS = ["L1", "L2", "L3", "L4"];
const PR_OPEN_USAGE = "usage: faff pr open --run-dir DIR --issue ID --base BRANCH --title T --body-file FILE [--spec-review-evidence FILE] [--json]";
// --- Helpers ---------------------------------------------------------------------------------------
function isRecord(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v) { return typeof v === "string" && v !== "" ? v : null; }
function firstLine(s) { return (s.trim().split("\n")[0] ?? "").trim(); }
function lastJson(stdout) {
    const lines = stdout.trim().split("\n");
    try {
        return JSON.parse(lines[lines.length - 1] ?? "");
    }
    catch {
        return null;
    }
}
function prNumberFromUrl(url) {
    const m = /\/pull\/(\d+)\b/.exec(url);
    return m && m[1] !== undefined ? Number(m[1]) : null;
}
function transition(issue, governed) {
    return { to: "In Review", governed, effect: { kind: "tracker-write", target: `${issue}:In Progress->In Review`, reversible: true } };
}
// The governed-run check graft defines: exactly one JSON object with a boolean `governed`, within
// 30 seconds, else a fault. The cause names the exit code, `timeout` or `unparseable output`, never
// the call's stderr text.
function governedCheck(r) {
    if (r.timedOut)
        return { fault: "timeout" };
    if (r.status !== 0)
        return { fault: `exit ${r.status === null ? "null" : String(r.status)}` };
    let parsed;
    try {
        parsed = JSON.parse(r.stdout.trim());
    }
    catch {
        return { fault: "unparseable output" };
    }
    if (!isRecord(parsed) || typeof parsed["governed"] !== "boolean")
        return { fault: "unparseable output" };
    return { governed: parsed["governed"] };
}
function parseOpenPrs(stdout) {
    let parsed;
    try {
        parsed = JSON.parse(stdout.trim() === "" ? "null" : stdout);
    }
    catch {
        return null;
    }
    if (!Array.isArray(parsed))
        return null;
    const out = [];
    for (const e of parsed) {
        if (!isRecord(e))
            return null;
        const n = e["number"];
        out.push({ number: typeof n === "number" ? n : null, url: str(e["url"]), baseRefName: str(e["baseRefName"]), headRefOid: str(e["headRefOid"]) });
    }
    return out;
}
// `faff events anchor` exit 3 is a refusal; classify it by the fixed stderr prefix and the exported
// read-only genesis validator, never by free text. A refusal it cannot classify fails closed to
// genesis-invalid.
const SCHEMA_REFUSAL_RE = /^faff events anchor: (schema-unavailable|schema-check-error|unschemaed-file|schema-mismatch|anchor-shrink)\b/;
function anchorRefusalCode(stderr, runDir, deps) {
    const lines = stderr.split("\n");
    if (lines.some((l) => l.startsWith("faff events anchor: floor-incomplete")))
        return "floor-incomplete";
    if (lines.some((l) => SCHEMA_REFUSAL_RE.test(l)))
        return "schema-refused";
    let code;
    try {
        code = deps.validateAnchorGenesis(runDir).code;
    }
    catch {
        code = undefined;
    }
    return code === "no-events" || code === "genesis-invalid" ? code : "genesis-invalid";
}
function anchorCauseText(code, runDir) {
    if (code === "floor-incomplete")
        return `anchor-floor-incomplete: ${runDir} lacks a required merge-floor file (ac-checklist.json or review-verdict.json); a build-evidence defect, not a provisioning fault`;
    if (code === "schema-refused")
        return `anchor-schema-refused: ${runDir} staged an anchor that fails its evidence schema; a build-evidence defect, re-run the writer for the named file then \`faff events anchor --check\``;
    if (code === "no-events")
        return `anchor-no-events: ${runDir} has no events.jsonl; a provisioning fault, re-mint the run dir`;
    return `anchor-genesis-invalid: ${runDir} has no valid genesis chain; a provisioning fault, re-mint the run dir`;
}
// Clears both copies first so a fault leaves neither in place, then derives the human-only set from the
// main-checkout captured spec (never the worktree copy) and has the evidence writer freeze it. Returns a
// warning for a fault and null on success; a fault never refuses the PR.
function mintHumanOnlyAcs(runDir, issue, dest, deps, removeStale, mainCheckout) {
    const destFile = `${dest}${HUMAN_ONLY_ACS}`;
    const runFile = path.join(runDir, issue, HUMAN_ONLY_ACS);
    const unminted = (why) => `${HUMAN_ONLY_ACS} not minted: ${why}`;
    const removed = deps.git(["rm", "-f", "--ignore-unmatch", "--quiet", "--", destFile]);
    removeStale(destFile);
    removeStale(runFile);
    if (removed.status !== 0)
        return unminted(`git rm exited ${String(removed.status)}: ${firstLine(removed.stderr)}`);
    const mainRoot = mainCheckout();
    if (mainRoot === null)
        return unminted("main checkout not resolved");
    const captured = path.join(mainRoot, ".faff", "graft", issue, "captured-spec.md");
    if (deps.readFile(captured) === null)
        return unminted("captured spec unreadable");
    const classified = deps.faff(["dod", "classify", "--spec", captured, "--issue", issue, "--json"], null, DEFAULT_TIMEOUT_MS);
    if (classified.status !== 0)
        return unminted(`faff dod classify exited ${String(classified.status)}: ${firstLine(classified.stderr)}`);
    const ids = humanOnlyIds(classified.stdout);
    if ("fault" in ids)
        return unminted(ids.fault);
    const level = ledgerLevel(deps.readFile(path.join(runDir, "run-ledger.json")));
    if (level === null)
        return unminted("run-ledger level unreadable or not L1 to L4");
    const unattended = (deps.unattendedFor ?? defaultUnattendedFor)(level, mainRoot);
    const written = deps.faff(["evidence", "write", "human-only-acs", "--run-dir", runDir, "--issue", issue], JSON.stringify({ issue, level, unattended, human_only: ids.ids }), DEFAULT_TIMEOUT_MS);
    if (written.status !== 0) {
        removeStale(runFile);
        return unminted(`faff evidence write human-only-acs exited ${String(written.status)}: ${firstLine(written.stderr)}`);
    }
    return null;
}
function humanOnlyIds(stdout) {
    let parsed;
    try {
        parsed = JSON.parse(stdout);
    }
    catch {
        return { fault: "faff dod classify printed unparseable output" };
    }
    const rows = isRecord(parsed) ? parsed["criteria"] : null;
    if (!Array.isArray(rows))
        return { fault: "faff dod classify printed no criteria" };
    const ids = [];
    for (const row of rows) {
        if (!isRecord(row) || row["source"] !== "done" || row["human_only"] !== true)
            continue;
        const id = str(row["ac_id"]);
        if (id === null)
            return { fault: "a human-only criterion has no ac_id" };
        ids.push(id);
    }
    return { ids };
}
function ledgerLevel(raw) {
    if (raw === null)
        return null;
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return null;
    }
    const level = isRecord(parsed) ? parsed["level"] : null;
    return typeof level === "string" && LEVELS.includes(level) ? level : null;
}
function defaultUnattendedFor(level, mainRoot) {
    const configApi = require("./config"); // lazy: the config module is large and only this step needs it
    return floorApi.resolveUnattended(level, configApi.loadConfig(mainRoot)[0]);
}
// --- The sequence ------------------------------------------------------------------------------------
function runPrOpen(opts, deps) {
    const { runDir, issue, base, title } = opts;
    const warnings = [];
    const done = (r) => ({ ...r, warnings });
    const errored = (cause) => done({ token: "errored", exit: 2, cause });
    // 1. Parse and validate.
    if (runDir === "" || issue === "" || base === "" || title === "" || opts.bodyFile === "")
        return errored("usage: --run-dir, --issue, --base, --title and --body-file are required");
    if (!ISSUE_RE.test(issue) || issue.includes(".."))
        return errored(`usage: --issue ${JSON.stringify(issue)} is not a valid issue id`);
    const draft = deps.readFile(opts.bodyFile);
    if (draft === null)
        return errored(`unreadable input: cannot read --body-file ${opts.bodyFile}`);
    // 2. Git-only: no pushable remote, no PR to open.
    const remotes = deps.git(["remote"]);
    if (remotes.status === 0 && remotes.stdout.trim() === "")
        return done({ token: "no-op", exit: 0, cause: "git-only (no remote): no PR to open" });
    // 3. Branch check.
    const branchR = deps.git(["rev-parse", "--abbrev-ref", "HEAD"]);
    const branch = branchR.status === 0 ? branchR.stdout.trim() : "";
    if (branch === "" || branch === "HEAD" || branch === base || branch.startsWith("-")) {
        return errored(`wrong-branch: HEAD is ${JSON.stringify(branch || "unresolved")}; run from the feature branch, never ${base}`);
    }
    // 4. Review precondition.
    const review = deps.readReviewVerdict(runDir, issue);
    if (review !== "pass")
        return done({ token: "refused", exit: 1, cause: "review-not-pass", blockers: [`review verdict is ${review}, not pass`] });
    // 5. Governed-run check.
    const status = governedCheck(deps.faff(["commissaire", "contract", "status", "--run-dir", runDir], null, STATUS_TIMEOUT_MS));
    if ("fault" in status)
        return done({ token: "needs-human", exit: 3, cause: `commissaire-status-failed: ${status.fault}` });
    const governed = status.governed;
    const runId = path.basename(runDir.replace(/[\\/]+$/, ""));
    const dest = `.faff/anchors/${runId}/${issue}/`;
    // 6. The spec-review evidence floor file (best-effort).
    if (opts.specReviewEvidence !== null) {
        const evidence = deps.readFile(opts.specReviewEvidence);
        if (evidence === null)
            warnings.push(`spec-review evidence ${opts.specReviewEvidence} is unreadable; no spec-review-verdict.json written`);
        else {
            const w = deps.faff(["evidence", "write", "spec-review-verdict", "--run-dir", runDir, "--issue", issue], evidence, DEFAULT_TIMEOUT_MS);
            if (w.status !== 0)
                warnings.push(`faff evidence write spec-review-verdict exited ${String(w.status)}: ${firstLine(w.stderr)}`);
        }
    }
    // 7-18 own the safe-body temp file; the finally deletes it on every path that created it.
    let safeFile = null;
    try {
        // 7. Sanitize, then check the exact bytes that will ship.
        let safeBytes = null;
        try {
            safeFile = deps.writeTemp(deps.sanitize(draft, issue));
            safeBytes = deps.readFile(safeFile);
        }
        catch (e) {
            return done({ token: "refused", exit: 1, cause: "body-unsafe", blockers: [`pr-body sanitize failed: ${e instanceof Error ? e.message : String(e)}`] });
        }
        if (safeBytes === null)
            return done({ token: "refused", exit: 1, cause: "body-unsafe", blockers: ["the sanitized body could not be read back"] });
        let checked;
        try {
            checked = deps.check(safeBytes, issue);
        }
        catch (e) {
            return done({ token: "refused", exit: 1, cause: "body-unsafe", blockers: [`pr-body check failed: ${e instanceof Error ? e.message : String(e)}`] });
        }
        if (!checked.ok)
            return done({ token: "refused", exit: 1, cause: "body-unsafe", blockers: [`pr-body check: ${JSON.stringify(checked.violations)}`] });
        // 8. The existing PR, before anything outward.
        const list = deps.gh(["pr", "list", "--head", branch, "--state", "open", "--json", "number,url,baseRefName,headRefOid"]);
        const prs = list.status === 0 ? parseOpenPrs(list.stdout) : null;
        if (prs === null)
            return errored(`gh-unavailable: gh pr list ${list.status === 0 ? "printed unparseable output" : `exited ${String(list.status)}`}`);
        const otherBase = prs.filter((p) => p.baseRefName !== base);
        if (otherBase.length) {
            return done({ token: "refused", exit: 1, cause: "open-pr-other-base", blockers: otherBase.map((p) => `open PR ${p.url ?? `#${String(p.number)}`} targets ${p.baseRefName ?? "an unknown base"}, not ${base}`), governed });
        }
        const existing = prs[0] ?? null;
        if (existing !== null && governed && deps.prCreateGrantState(runDir, issue, base) !== "valid-grant") {
            return done({ token: "needs-human", exit: 3, cause: `already-open-ungranted: open PR ${existing.url ?? `#${String(existing.number)}`} has no valid pr-create grant on this governed run`, governed });
        }
        const existingFields = () => {
            const out = {};
            if (existing !== null && existing.url !== null)
                out.pr_url = existing.url;
            const n = existing === null ? null : existing.number ?? (existing.url !== null ? prNumberFromUrl(existing.url) : null);
            if (n !== null)
                out.pr_number = n;
            return out;
        };
        // 9. Already anchored: nothing changed since the head was anchored and pushed.
        const headBefore = deps.git(["rev-parse", "HEAD"]);
        const localHead = headBefore.status === 0 ? headBefore.stdout.trim() : "";
        if (existing !== null && localHead !== "" && existing.headRefOid === localHead) {
            const tree = deps.git(["ls-tree", "HEAD", "--", dest]);
            if (tree.status === 0 && tree.stdout.trim() !== "") {
                return done({ token: "already-open", exit: 0, ...existingFields(), head_sha: localHead, anchor_dest: dest, governed, tracker_transition: transition(issue, governed) });
            }
        }
        // 9b. Mint human-only-acs.json, after the already-open return so an unchanged head mints nothing.
        if (deps.removeStale !== undefined && deps.mainCheckout !== undefined) {
            let fault;
            try {
                fault = mintHumanOnlyAcs(runDir, issue, dest, deps, deps.removeStale, deps.mainCheckout);
            }
            catch (e) {
                fault = `${HUMAN_ONLY_ACS} not minted: ${e instanceof Error ? e.message : String(e)}`;
                try {
                    deps.removeStale(path.join(runDir, issue, HUMAN_ONLY_ACS));
                    deps.removeStale(`${dest}${HUMAN_ONLY_ACS}`);
                }
                catch { /* best-effort */ }
            }
            if (fault !== null)
                warnings.push(fault);
        }
        // 10. Anchor.
        const anchor = deps.faff(["events", "anchor", "--run-dir", runDir, "--issue", issue, "--dest", dest], null, DEFAULT_TIMEOUT_MS);
        if (anchor.status === 3) {
            const code = anchorRefusalCode(anchor.stderr, runDir, deps);
            return done({ token: "needs-human", exit: 3, cause: anchorCauseText(code, runDir), governed });
        }
        if (anchor.status !== 0)
            return errored(`anchor CLI error: faff events anchor exited ${String(anchor.status)}: ${firstLine(anchor.stderr)}`);
        for (const l of anchor.stderr.split("\n"))
            if (l.includes("evidence-schema warn-only"))
                warnings.push(l.trim());
        // 11. Anchor commit. Only an empty stage skips the commit; every other failure stops here.
        const add = deps.git(["add", "--", dest]);
        if (add.status !== 0)
            return errored(`commit failure: git add exited ${String(add.status)}: ${firstLine(add.stderr)}`);
        const staged = deps.git(["diff", "--cached", "--quiet", "--", dest]);
        if (staged.status === 1) {
            const commit = deps.git(["commit", "-m", `chore(${issue}): anchor run evidence`, "--", dest]);
            if (commit.status !== 0)
                return errored(`commit failure: git commit exited ${String(commit.status)}: ${firstLine(commit.stderr || commit.stdout)}`);
        }
        else if (staged.status !== 0) {
            return errored(`commit failure: git diff --cached exited ${String(staged.status)}: ${firstLine(staged.stderr)}`);
        }
        // 12. Push, bracketed on a governed run.
        const pushEffect = JSON.stringify([{ kind: "push", target: branch, reversible: true }]);
        if (governed) {
            const d = deps.faff(["effects", "declare", "--run", runId, "--issue", issue, "--step", "push"], pushEffect, DEFAULT_TIMEOUT_MS);
            if (d.status !== 0)
                warnings.push(`faff effects declare (push) exited ${String(d.status)}: ${firstLine(d.stderr)}`);
        }
        const push = deps.git(["push", "origin", `refs/heads/${branch}:refs/heads/${branch}`]);
        if (push.status !== 0)
            return errored(`push failure: git push exited ${String(push.status)}: ${firstLine(push.stderr)}`);
        if (governed) {
            const o = deps.faff(["effects", "observe", "--run", runId, "--issue", issue, "--step", "push"], pushEffect, DEFAULT_TIMEOUT_MS);
            if (o.status !== 0)
                warnings.push(`faff effects observe (push) exited ${String(o.status)}: ${firstLine(o.stderr)}`);
        }
        const headAfter = deps.git(["rev-parse", "HEAD"]);
        const head = headAfter.status === 0 ? headAfter.stdout.trim() : localHead;
        // 13. Bundle (best-effort).
        const bundle = deps.faff(["bundle", "publish", "--run-dir", runDir, "--boundary-kind", "issue-merge-floor", "--boundary-key", issue], null, DEFAULT_TIMEOUT_MS);
        if (bundle.status !== 0 || /store_unavailable/.test(bundle.stdout + bundle.stderr)) {
            warnings.push(`faff bundle publish did not publish (exit ${String(bundle.status)}): ${firstLine(bundle.stderr || bundle.stdout)}`);
        }
        // 14. The push updated an existing PR.
        if (existing !== null) {
            return done({ token: "already-open", exit: 0, ...existingFields(), head_sha: head, anchor_dest: dest, governed, tracker_transition: transition(issue, governed) });
        }
        // 15. The governed pr-create producer half.
        const createEffect = { kind: "pr-create", target: base };
        const facadeArgs = (verb) => ["commissaire", "effect", verb, "--run-dir", runDir, "--producer", runId, "--unit-id", issue, "--step", "pr-create"];
        if (governed) {
            let inputs;
            try {
                inputs = deps.deriveInputs(runDir, issue, head);
            }
            catch (e) {
                return done({ token: "needs-human", exit: 3, cause: `pr-create-denied: grant inputs could not be established: ${e instanceof Error ? e.message : String(e)}`, head_sha: head, anchor_dest: dest, governed });
            }
            const d = deps.faff(facadeArgs("declare"), JSON.stringify([{ ...createEffect, reversible: true }]), DEFAULT_TIMEOUT_MS);
            if (d.status !== 0)
                return done({ token: "needs-human", exit: 3, cause: `pr-create-denied: commissaire effect declare exited ${String(d.status)}`, head_sha: head, anchor_dest: dest, governed });
            const a = deps.faff([...facadeArgs("authorize"), "--level", inputs.level], JSON.stringify({ effect: createEffect, level: inputs.level, attended: inputs.attended, holdout: inputs.holdout }), DEFAULT_TIMEOUT_MS);
            const verdict = a.status === 0 ? lastJson(a.stdout) : null;
            if (!isRecord(verdict) || verdict["verdict"] !== "grant") {
                const why = a.status !== 0 ? `authorize exited ${String(a.status)}` : !isRecord(verdict) ? "authorize printed no verdict" : `verdict ${String(verdict["verdict"])}${str(verdict["reason"]) ? ` (${String(verdict["reason"])})` : ""}`;
                return done({ token: "needs-human", exit: 3, cause: `pr-create-denied: ${why}`, head_sha: head, anchor_dest: dest, governed });
            }
        }
        // 16. Open.
        const create = deps.faff(["pr-create", "--run-dir", runDir, "--issue", issue, "--base", base, "--body-file", safeFile, "--title", title, "--json"], null, DEFAULT_TIMEOUT_MS);
        const created = lastJson(create.stdout);
        const createdVerdict = isRecord(created) ? created["verdict"] : null;
        if (create.status === 0 && createdVerdict === "no-op")
            return done({ token: "no-op", exit: 0, cause: "faff pr-create: git-only (no remote)", governed });
        if (create.status !== 0 || createdVerdict !== "opened" || !isRecord(created)) {
            const blockers = isRecord(created) && Array.isArray(created["blockers"]) ? created["blockers"].map((b) => String(b)) : [firstLine(create.stderr) || `faff pr-create exited ${String(create.status)}`];
            return done({ token: "refused", exit: 1, cause: "pr-create-refused", blockers, head_sha: head, anchor_dest: dest, governed });
        }
        const url = str(created["pr_url"]);
        // 17. Observe (governed).
        if (governed) {
            const o = deps.faff(facadeArgs("observe"), JSON.stringify([{ ...createEffect, reversible: true }]), DEFAULT_TIMEOUT_MS);
            if (o.status !== 0)
                warnings.push(`faff commissaire effect observe (pr-create) exited ${String(o.status)}: ${firstLine(o.stderr)}`);
        }
        // 18. Emit.
        const result = { token: "opened", exit: 0, head_sha: head, anchor_dest: dest, governed, tracker_transition: transition(issue, governed) };
        if (url !== null) {
            result.pr_url = url;
            const n = prNumberFromUrl(url);
            if (n !== null)
                result.pr_number = n;
        }
        return done(result);
    }
    finally {
        if (safeFile !== null)
            deps.removeFile(safeFile);
    }
}
// --- Real dependencies -------------------------------------------------------------------------------
function spawned(r) {
    const timedOut = r.error !== undefined && /ETIMEDOUT/.test(String(r.error.message));
    return { status: r.error !== undefined ? null : r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? (r.error ? r.error.message : ""), timedOut };
}
function defaultDeps(cwd) {
    let tmpDir = null;
    return {
        git: (args) => spawned(childProcess.spawnSync("git", args, { cwd, encoding: "utf8", timeout: DEFAULT_TIMEOUT_MS })),
        gh: (args) => spawned(ghApi.runGh(args, { timeout: 60000 })),
        faff: (args, input, timeoutMs) => spawned(childProcess.spawnSync(process.execPath, [FAFF_BIN, ...args], input === null ? { cwd, encoding: "utf8", timeout: timeoutMs } : { cwd, encoding: "utf8", timeout: timeoutMs, input })),
        readReviewVerdict: (runDir, issue) => floorApi.readReviewVerdict(runDir, issue),
        sanitize: (draft, issue) => prBodyApi.sanitizePrBody(draft, issue),
        check: (body, issue) => prBodyApi.checkPrBody(body, issue),
        validateAnchorGenesis: (runDir) => eventsApi.validateAnchorGenesis(runDir),
        prCreateGrantState: (runDir, issue, base) => {
            const ctx = effectsApi.makeTrustContext({ transport: "remote", repo_dir: cwd, base_ref: base, resolve_slug: true });
            return effectsApi.resolvePrCreateGrantDetail(runDir, issue, base, ctx).state;
        },
        deriveInputs: (runDir, issue, headSha) => mergeAuthorizeApi.deriveGrantInputs(runDir, issue, { cwd, repo: null, headSha }),
        readFile: (file) => { try {
            return fs.readFileSync(file, "utf8");
        }
        catch {
            return null;
        } },
        writeTemp: (content) => {
            if (tmpDir === null)
                tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "faff-pr-open-"));
            const file = path.join(tmpDir, "safe-body.md");
            fs.writeFileSync(file, content);
            return file;
        },
        removeStale: (file) => { try {
            fs.unlinkSync(path.resolve(cwd, file));
        }
        catch { /* absent or unremovable: the writer or git reports a real fault */ } },
        mainCheckout: () => sharedInfraApi.mainWorktreeRoot(cwd),
        removeFile: () => {
            if (tmpDir !== null) {
                try {
                    fs.rmSync(tmpDir, { recursive: true, force: true });
                }
                catch { /* best-effort */ }
                tmpDir = null;
            }
        },
    };
}
// --- CLI ---------------------------------------------------------------------------------------------
function emit(json, r) {
    if (json) {
        process.stdout.write(JSON.stringify(r) + "\n");
        return r.exit;
    }
    const where = r.pr_url ? ` ${r.pr_url}` : "";
    process.stdout.write(`${r.token}${where}${r.cause ? ` (${r.cause})` : ""}\n`);
    for (const b of r.blockers ?? [])
        process.stdout.write(`  ✗ ${b}\n`);
    for (const w of r.warnings)
        process.stdout.write(`  [warn] ${w}\n`);
    return r.exit;
}
function cmdPrOpen(args) {
    const parsed = argvApi.parseArgs(args, PR_OPEN_SPEC);
    if (parsed.errors.length)
        return argvApi.usageError(parsed.errors, PR_OPEN_USAGE);
    const json = parsed.values["--json"] === true;
    const get = (f) => str(parsed.values[f]) ?? "";
    const missing = ["--run-dir", "--issue", "--base", "--title", "--body-file"].filter((f) => get(f) === "");
    if (missing.length) {
        process.stderr.write(`faff pr open: missing ${missing.join(", ")}\n${PR_OPEN_USAGE}\n`);
        return emit(json, { token: "errored", exit: 2, cause: `usage: missing ${missing.join(", ")}`, warnings: [] });
    }
    const opts = {
        runDir: path.resolve(get("--run-dir")),
        issue: get("--issue"),
        base: get("--base"),
        title: get("--title"),
        bodyFile: get("--body-file"),
        specReviewEvidence: str(parsed.values["--spec-review-evidence"]),
    };
    return emit(json, runPrOpen(opts, defaultDeps(process.cwd())));
}
const PLAN_REVIEW_USAGE = "usage: faff pr plan-in-review --issue ID [--run-dir DIR] < facts.json";
const PLAN_REVIEW_SPEC = {
    flags: { "--issue": { arity: 1 }, "--run-dir": { arity: 1 } },
    positionals: { min: 0, max: 0 },
};
function planInReview(facts, issue, runDir) {
    if (!isRecord(facts))
        throw new Error("expected tracker facts");
    const state = str(facts["review_state"]);
    if (facts["live_status"] !== "In Progress" || state === null || !state.trim())
        return { action: "noop" };
    const receipt = facts["tracker_transition"];
    if (!isRecord(receipt) || typeof receipt["governed"] !== "boolean" || receipt["to"] !== "In Review") {
        throw new Error("expected the PR-open tracker_transition");
    }
    const expected = transition(issue, receipt["governed"]);
    const effect = receipt["effect"];
    if (!isRecord(effect) || effect["target"] !== expected.effect.target ||
        effect["kind"] !== expected.effect.kind || effect["reversible"] !== expected.effect.reversible) {
        throw new Error("PR-open effect does not match the requested issue and transition");
    }
    const bracket = expected.governed && runDir !== null ? {
        args: ["--run-dir", path.resolve(runDir), "--issue", issue, "--step", expected.effect.kind],
        payload: [expected.effect],
    } : null;
    return { action: "write", state, bracket };
}
function cmdPlanInReview(args) {
    const parsed = argvApi.parseArgs(args, PLAN_REVIEW_SPEC);
    if (parsed.errors.length)
        return argvApi.usageError(parsed.errors, PLAN_REVIEW_USAGE);
    const issue = str(parsed.values["--issue"]);
    if (issue === null)
        return argvApi.usageError([{ code: "missing-flag", detail: "--issue is required" }], PLAN_REVIEW_USAGE);
    try {
        const facts = JSON.parse(fs.readFileSync(0, "utf8"));
        console.log(JSON.stringify(planInReview(facts, issue, str(parsed.values["--run-dir"]))));
        return 0;
    }
    catch (error) {
        process.stderr.write("faff pr plan-in-review: " + (error instanceof Error ? error.message : String(error)) + "\n");
        return 2;
    }
}
function cmdPr(args) {
    if (args[0] === "preflight")
        return require("./pr-preflight").cmdPrPreflight(args.slice(1));
    if (args[0] === "open")
        return cmdPrOpen(args.slice(1));
    if (args[0] === "plan-in-review")
        return cmdPlanInReview(args.slice(1));
    return argvApi.usageError([{ code: "bad-value", detail: "expected a verb: open, preflight or plan-in-review" }], PR_OPEN_USAGE + "\n" + PLAN_REVIEW_USAGE);
}
module.exports = { cmdPr, runPrOpen, defaultDeps };
