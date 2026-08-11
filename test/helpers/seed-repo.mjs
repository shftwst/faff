// FAFF-90 — Seeded-repo substrate: a fixed git/repo state a skill run reads.
//
// Provisions a deterministic, REAL git repo + REAL `.faff/` tree in a temp dir, so the
// git-grounding half of faff's skills (wtf/map/tidy/graft, via `faff state`) can be
// exercised reproducibly. The CLI is the system under test and it shells out to real
// `git` and reads real files (resolveGit/resolveSpec/resolveParked/resolveLedgerOutcome),
// so the fixture must be a real tree — not a stub. This is the on-disk counterpart of
// FAFF-89's in-memory mock-tracker; the two land oppositely on purpose (see the spec's
// load-bearing asymmetry) and compose at the FAFF-93 harness.
//
// Determinism is PROVISIONED, not assumed: a real git repo is otherwise non-deterministic
// (ambient config, author/committer dates, default-branch name). Every such source is
// neutralised at seed time, and `faff state` reads only hash-free values (branch names,
// worktree paths, file bodies, ledger contents) — so output is byte-identical run-to-run.
//
// Zero-dependency (node:* only). Invoking real `git` via node:child_process is not a new
// dependency — `git` is the CLI's own runtime dependency. Per ADR 0002.

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir, devNull } from "node:os";
import path from "node:path";

// Applied to every `git` invocation the helper makes — the full neutralising set.
const DETERMINISM_ENV = {
  GIT_CONFIG_GLOBAL: devNull, // neutralise ambient ~/.gitconfig
  GIT_CONFIG_SYSTEM: devNull, // neutralise /etc + machine config
  GIT_AUTHOR_NAME: "faff test",
  GIT_AUTHOR_EMAIL: "test@faff.invalid",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00 +0000",
  GIT_COMMITTER_NAME: "faff test",
  GIT_COMMITTER_EMAIL: "test@faff.invalid",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00 +0000",
};

// Make a branch name safe to use as a single path segment (for the worktree dir).
function safeSegment(name) {
  return name.replace(/[^A-Za-z0-9._-]+/g, "-");
}

/**
 * Seed a deterministic real git repo + `.faff/` tree in a fresh temp directory.
 * @param {object} spec the SeedSpec (see the FAFF-90 design doc §3).
 *   FAFF-762: spec.danglingWorktree?: { name: string } — `git worktree add`s a real linked
 *   worktree, then removes its checkout dir (leaving `.git/worktrees/<id>/` dangling) so a
 *   caller can exercise `worktree-prune` against a genuinely dangling admin dir.
 * @returns {{ root: string, worktreePath: string|null, danglingAdminPath: string|null,
 *   danglingWorktreePath: string|null, teardown: () => void }}
 */
export function seedRepo(spec = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "faff-seed-"));
  const env = { ...process.env, ...DETERMINISM_ENV };

  // Write a file relative to root, creating parent dirs.
  const writeRel = (rel, body) => {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };

  // Run git in `root` with the determinism env; throw loud on failure (broken fixture).
  const git = (...args) => {
    const r = spawnSync("git", ["-C", root, ...args], { env, encoding: "utf8" });
    if (r.status !== 0) {
      throw new Error(`seed-repo git ${args.join(" ")} failed: ${r.stderr || r.status}`);
    }
    return r;
  };

  const useGit = spec.git !== false; // default true
  const commits = spec.commits ?? [];
  const branches = spec.branches ?? [];
  const specs = spec.specs ?? [];
  const runs = spec.runs ?? [];
  const committedSpecs = specs.filter((s) => s.location === "committed");
  let worktreePath = null;
  let danglingAdminPath = null;
  let danglingWorktreePath = null;

  try {
    provision();
  } catch (e) {
    // A provisioning failure throws (loud — a broken fixture must not pass silently),
    // but the caller never received a teardown handle, so clean up the half-built temp
    // dir here rather than leaking it.
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    throw e;
  }

  const teardown = () => {
    if (worktreePath) {
      try {
        rmSync(worktreePath, { recursive: true, force: true, maxRetries: 3 });
      } catch {
        /* idempotent: already gone */
      }
    }
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  };

  return { root, worktreePath, danglingAdminPath, danglingWorktreePath, teardown };

  function provision() {
    if (useGit) {
    git("init", "-b", spec.defaultBranch || "main");
    // Repo-local identity (not just the DETERMINISM_ENV vars above): a nested `faff`
    // CLI child's own `git commit` doesn't inherit this process's env, so it falls
    // through to repo-local .git/config, then global ~/.gitconfig. Without a repo-local
    // identity, an identity-less environment (CI: no global gitconfig) leaves that child
    // commit with no identity and it silently no-ops — false-red only in CI. Same
    // literal values as DETERMINISM_ENV's GIT_AUTHOR_*/GIT_COMMITTER_* so a commit made
    // via either path is attributed identically. See FAFF-476.
    git("config", "user.email", DETERMINISM_ENV.GIT_AUTHOR_EMAIL);
    git("config", "user.name", DETERMINISM_ENV.GIT_AUTHOR_NAME);

    for (const c of commits) {
      for (const [rel, body] of Object.entries(c.files ?? {})) writeRel(rel, body);
      git("add", "-A");
      git("commit", "-m", c.message);
    }

    // A branch / worktree / committed spec needs HEAD to point at a commit.
    const needsBase =
      branches.length > 0 || spec.worktree != null || committedSpecs.length > 0 || spec.danglingWorktree != null;
    if (commits.length === 0 && needsBase) {
      writeRel(".seed-placeholder", "seed\n");
      git("add", "-A");
      git("commit", "-m", "seed");
    }

    for (const name of branches) git("branch", name);

    // Committed specs: default spec-docs path is docs/specs (matches resolveSpecDocsPath
    // when no .faffrc.yaml is seeded). Filename carries -<issue>- so resolveSpec's
    // /-<issue>-.*\.md$/i matches.
    for (const s of committedSpecs) {
      writeRel(path.join("docs", "specs", `2026-01-01-${s.issue}-seed.md`), s.body);
    }
    if (committedSpecs.length > 0) {
      git("add", "-A");
      git("commit", "-m", "add committed specs");
    }

    if (spec.worktree) {
      worktreePath = path.join(root, ".worktrees", safeSegment(spec.worktree.branch));
      git("worktree", "add", worktreePath, spec.worktree.branch);
    }

    // FAFF-762: a genuinely DANGLING admin dir — `git worktree add` a real linked worktree
    // on its own branch, resolve its authoritative admin-dir id from the gitdir map (never
    // the path basename — see worktree-prune.js's own comment on id de-duplication), then
    // remove the checkout dir. Git's `.git/worktrees/<id>/` entry survives with no backing
    // checkout: exactly the state `worktree-prune` targets.
    if (spec.danglingWorktree) {
      const name = spec.danglingWorktree.name;
      const dwPath = path.join(root, ".worktrees-dangling", safeSegment(name));
      git("worktree", "add", "-b", name, dwPath);
      const adminBase = path.join(root, ".git", "worktrees");
      let adminId = null;
      for (const id of readdirSync(adminBase)) {
        let gd;
        try { gd = readFileSync(path.join(adminBase, id, "gitdir"), "utf8").trim(); } catch { continue; }
        const wt = gd.replace(/\/\.git\/?$/, "").replace(/\/+$/, "");
        if (wt === dwPath.replace(/\/+$/, "")) { adminId = id; break; }
      }
      rmSync(dwPath, { recursive: true, force: true, maxRetries: 3 });
      danglingWorktreePath = dwPath;
      danglingAdminPath = adminId ? path.join(adminBase, adminId) : null;
    }
  } else {
    // .faff-only tree: findRoot anchors on `.faff` (no `.git`); faff state's git half
    // resolves branch/worktree to null.
    mkdirSync(path.join(root, ".faff"), { recursive: true });
  }

  // Git-only specs: .faff/specs/<issue-lowercased>.md, NOT committed. Works in both modes.
  for (const s of specs.filter((x) => x.location === "git-only")) {
    writeRel(path.join(".faff", "specs", `${s.issue.toLowerCase()}.md`), s.body);
  }

  // Run records under .faff/runs/<runId>/.
  // FAFF-152: `runs[].parks_meta` (an array of {issue_id, root_cause_class, timestamp})
  // is serialised into that run's summary.md as the fenced ```faff-parks JSON block the
  // `faff park-history` seam parses. It coexists with `runs[].summary` (the block is
  // appended to it) so a test can carry both human digest prose AND machine-readable
  // park metadata in one summary — exactly the production shape the seam reads.
  for (const run of runs) {
    const runRel = path.join(".faff", "runs", run.runId);
    if (run.ledger != null) writeRel(path.join(runRel, "run-ledger.json"), JSON.stringify(run.ledger));
    let summary = run.summary != null ? String(run.summary) : null;
    if (run.parks_meta != null) {
      const block = "```faff-parks\n" + JSON.stringify(run.parks_meta, null, 2) + "\n```\n";
      summary = summary != null ? `${summary}\n\n${block}` : block;
    }
    if (summary != null) writeRel(path.join(runRel, "summary.md"), summary);
    for (const [issue, body] of Object.entries(run.parks ?? {})) {
      writeRel(path.join(runRel, issue, "park.md"), body);
    }
  }

    // Arbitrary extra working-tree files (e.g. a .faffrc.yaml the test wants read).
    for (const [rel, body] of Object.entries(spec.files ?? {})) writeRel(rel, body);
  }
}
