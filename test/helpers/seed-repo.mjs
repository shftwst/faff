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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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
 * @returns {{ root: string, worktreePath: string|null, teardown: () => void }}
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

  return { root, worktreePath, teardown };

  function provision() {
    if (useGit) {
    git("init", "-b", spec.defaultBranch || "main");

    for (const c of commits) {
      for (const [rel, body] of Object.entries(c.files ?? {})) writeRel(rel, body);
      git("add", "-A");
      git("commit", "-m", c.message);
    }

    // A branch / worktree / committed spec needs HEAD to point at a commit.
    const needsBase = branches.length > 0 || spec.worktree != null || committedSpecs.length > 0;
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
  for (const run of runs) {
    const runRel = path.join(".faff", "runs", run.runId);
    writeRel(path.join(runRel, "run-ledger.json"), JSON.stringify(run.ledger));
    if (run.summary != null) writeRel(path.join(runRel, "summary.md"), run.summary);
    for (const [issue, body] of Object.entries(run.parks ?? {})) {
      writeRel(path.join(runRel, issue, "park.md"), body);
    }
  }

    // Arbitrary extra working-tree files (e.g. a .faffrc.yaml the test wants read).
    for (const [rel, body] of Object.entries(spec.files ?? {})) writeRel(rel, body);
  }
}
