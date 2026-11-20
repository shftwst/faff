# Capture the build checkpoint from Git

After the gates and acceptance criteria pass, Graft saves the worktree's head and retains ownership of the optional push and its effect record. The checkpoint command verifies that head against the checked-out branch and its durable counterpart. It hashes the byte stream of the three-dot diff between pinned commits and rechecks the refs before passing the record to the existing writer. The synchronous command hashes bounded reads from a private temporary file and removes it on exit. The resulting checkpoint retains its role as a resume hint.

With an origin, the same bounded Git fetch refreshes both the advertised default and the feature. With no origin, the command uses the local default and feature refs. Missing or moved refs leave any previous record intact. The existing writer checks the schema and atomically replaces the file on success.

## Rule inventory

| Prose rule | Disposition |
|---|---|
| `` After gates + AC pass, make the build durable on `origin` **before review** so a review-provider outage or `` | changed: Step 8b preserves gate ordering and push opt-out and verifies the saved head |
| `` 1. `git push origin <branch>` `` | changed: Step 8b retains the push and failure handling, and records the head before the push |
| `` 2. Compute `diff_hash` with the **Remote-backed build-progress diff** block below `` | changed: worktree checkpoint resolves the default and feature and computes the same three-dot diff hash |
| `` 3. `faff build-progress write "$run_dir" <ISSUE> --build-complete --diff-hash <diff_hash> --branch <branch>` `` | changed: worktree checkpoint reuses the existing writer after validating the refs |
| `` **Remote-backed build-progress diff.** With `$branch` the feature branch, hash the durable remote three-dot diff `` | changed: worktree checkpoint uses the shared base resolver and checks the durable feature head before writing |
| `` base=$(bash "$graft_skill_dir/remote-diff-base.sh") `` | changed: worktree checkpoint invokes this resolver and hashes Git output bytes |
| `` Opens no PR and never merges `` | changed: Step 8b retains this boundary, and worktree checkpoint checks local refs in git-only mode |
