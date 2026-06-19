# FAFF-190 — `faff doctor` install-health check

> Spec: faffter-dark-nlspec · 2026-06-19 · interactive · confidence: high. Full spec on Linear FAFF-190.

Installed faff skills are real-dir copies, not symlinks, so shipped repo changes don't go live silently. Add `faff doctor` to detect it.

- **Chosen:** `faff doctor` CLI subcommand — for each faff-family skill dir under the install target, report symlink (live) vs real-dir (copy/stale-risk) + the bin link; exit non-zero on any stale copy. Reads the filesystem, so it works from a stale installed bin (not circular).
- **Chosen:** sharpen `link-skills.sh` so a copy-install reads as a named, actionable warning.
- **Assumes:** install target is `~/.claude/skills` (override via `CLAUDE_PLUGIN_ROOT`); `--replace` is the dev-link path.

confidence: high
