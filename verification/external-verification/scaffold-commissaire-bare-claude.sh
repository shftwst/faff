#!/usr/bin/env bash
set -euo pipefail

# FAFF-360 — scaffold the config-free bare Claude Code Commissaire consumer SUT.
#
# Unlike the P1-P5 rungs, this SUT is CONFIG-FREE: it writes no .faffrc.yaml and calls no
# `faff hooks-ensure`. Its only integration with the governance layer is a hand-written Stop hook,
# one repository-owned verifier script, and a separately supplied immutable CLI checkout. The SUT is
# a fresh LOCAL no-remote git repository; the committed absolute FAFF_BIN constant in the hook is a
# local filesystem path, kept off any shareable artefact by the no-remote rule (preflight refuses a
# configured remote).
#
# Requires COMMISSAIRE_ROOT in the environment: a full SuperDomestique checkout at exactly the
# pinned revision below, from which the FAFF_BIN constant is filled at scaffold time.

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
SRC_DIR="$SCRIPT_DIR/commissaire-bare-claude"
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)

# The pinned driver revision. Kept identical to EXPECTED_COMMISSAIRE_REVISION in the verifier; the
# copy step below re-substitutes it into the scaffolded verifier so the two never drift.
EXPECTED_COMMISSAIRE_REVISION="fd1e9788a44860ee8804bdb775e33fb5dfd3f057"

if [ -z "${COMMISSAIRE_ROOT:-}" ]; then
  echo "scaffold-commissaire-bare-claude: COMMISSAIRE_ROOT is required (a checkout at $EXPECTED_COMMISSAIRE_REVISION)" >&2
  exit 2
fi
FAFF_BIN="$COMMISSAIRE_ROOT/plugin/skills/faff/bin/faff"

# SUT location: a sibling faff-suts/<slug> next to the faff repo by default; override with SUT_ROOT.
SUT_ROOT="${SUT_ROOT:-$(dirname "$REPO_ROOT")/faff-suts/commissaire-bare-claude}"

if [ -e "$SUT_ROOT" ] && [ -n "$(ls -A "$SUT_ROOT" 2>/dev/null || true)" ]; then
  echo "scaffold-commissaire-bare-claude: SUT_ROOT $SUT_ROOT already exists and is not empty" >&2
  exit 2
fi

mkdir -p "$SUT_ROOT/scripts" "$SUT_ROOT/.claude"
cd "$SUT_ROOT"

# --- copy the four self-contained scripts into the SUT (config-free, self-contained tree) ---------
# verify-commissaire.mjs: re-substitute the pinned revision (idempotent; keeps scaffolder + verifier
# in sync). commissaire-stop-hook.mjs: fill the absolute FAFF_BIN constant (machine-specific).
# replay.sh + README.md: copied verbatim; the verifier reads them from scripts/ and substitutes the
# README's @@PINNED_REVISION@@ / @@RUN_ID@@ placeholders when it writes each capture.
sed "s|const EXPECTED_COMMISSAIRE_REVISION = \"[0-9a-f]*\"|const EXPECTED_COMMISSAIRE_REVISION = \"$EXPECTED_COMMISSAIRE_REVISION\"|" \
  "$SRC_DIR/verify-commissaire.mjs" > scripts/verify-commissaire.mjs
sed "s|__FAFF_BIN__|$FAFF_BIN|" "$SRC_DIR/commissaire-stop-hook.mjs" > scripts/commissaire-stop-hook.mjs
cp "$SRC_DIR/replay.sh" scripts/replay.sh
cp "$SRC_DIR/README.md" scripts/README.md
chmod +x scripts/replay.sh

# --- the one Stop hook (hand-written; the SUT has no faff on PATH to run hooks-ensure) -------------
cat > .claude/settings.json <<'EOF'
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node scripts/commissaire-stop-hook.mjs"
          }
        ]
      }
    ]
  }
}
EOF

# --- .gitignore: EXACTLY the run dir / anchors / bundles / observation stores and the artefact -----
# It does NOT gitignore scripts/, so the SUT stays self-contained; the no-remote rule keeps the
# committed absolute FAFF_BIN unpushed.
cat > .gitignore <<'EOF'
.faff/
protected-output.txt
EOF

# --- RUNBOOK.md (here-doc; the scaffolder-drift lint requires this here-doc even config-free) ------
cat > RUNBOOK.md <<'EOF'
# Bare Claude Code Commissaire consumer — runbook

This repository has no SuperDomestique skills, config, or plugins. It integrates with the
governance layer only through a hand-written Stop hook and one verifier script under `scripts/`,
driving a separately supplied CLI checkout.

## Prerequisites

- Node 20 or newer, and git.
- COMMISSAIRE_ROOT: a full SuperDomestique checkout at the pinned revision.
- COMMISSAIRE_REVISION: that checkout's HEAD SHA.

## Human reproduction

    node scripts/verify-commissaire.mjs prepare
    node scripts/verify-commissaire.mjs complete
    node scripts/verify-commissaire.mjs verify --capture ../capture-out

Between `prepare` and `complete`, and again after `complete`, Claude Code's Stop hook fires
`node scripts/commissaire-stop-hook.mjs`, which records one observation per firing.

## One-shot CI reproduction

    node scripts/verify-commissaire.mjs ci

The `ci` phase runs the whole pipeline end to end against fixture-driven hook input in a temporary
directory and publishes nothing to `results/`.

## Curating a capture

    node scripts/verify-commissaire.mjs curate <capture-dir> --run-dir <live-run-dir>

Curation proves the capture carries no secret bytes, no forbidden file class, and no absolute path.
EOF

# --- initial commit, LOCAL, no remote --------------------------------------------------------------
git init -q
git config user.email "bare-claude@example.invalid"
git config user.name "bare-claude"
git config commit.gpgsign false
git add .gitignore .claude RUNBOOK.md scripts
git commit -q -m "Scaffold bare Claude Code Commissaire consumer (config-free, no remote)"

echo "$SUT_ROOT"
