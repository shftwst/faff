#!/usr/bin/env bash
# faff external-verification SUT scaffolder
# P5 — Brownfield boss fight.  Behaviours: ALL, under ambiguity.
# Seeds someone else's messy, untested legacy repo + a vague human ask ("make it faster and add
# multi-tenancy"). Tests planning under ambiguity + the park boundary at depth.
# Honest expected outcome: a powerful exoskeleton (L1-L3), NOT lights-out for fuzzy brownfield.
# GATED (autonomous OFF) — drive it interactively.
#
# Run in a NEW dir:
#   SUT_ROOT=~/workspace/shftwst/faff-suts/p5-brownfield bash scaffold-p5-brownfield.sh
set -euo pipefail

SLUG="p5-brownfield"
SUT_ROOT="${SUT_ROOT:-$HOME/workspace/faff-suts/$SLUG}"

if [ -e "$SUT_ROOT" ] && [ -n "$(ls -A "$SUT_ROOT" 2>/dev/null)" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "refusing to scaffold into non-empty $SUT_ROOT (set FORCE=1 to override)" >&2
  exit 1
fi

mkdir -p "$SUT_ROOT"
cd "$SUT_ROOT"
echo "scaffolding P5 (brownfield legacy repo) into $SUT_ROOT"
git init -q 2>/dev/null || true

cat > .gitignore <<'EOF'
node_modules/
*.log
EOF

# --- the deliberately-crufty legacy app (untested, single-file, smelly) ---
cat > package.json <<'EOF'
{
  "name": "notesbox",
  "version": "0.4.1",
  "description": "internal notes service (legacy)",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.2"
  }
}
EOF

cat > server.js <<'EOF'
// notesbox - internal notes service. been running for years, nobody wants to touch it.
// TODO(2021): write some tests. TODO(2022): still no tests.
const express = require('express');
const fs = require('fs');
const app = express();
app.use(express.json());

// global mutable store, persisted to a flat file on every write. one namespace for everyone.
let DB = {};
try { DB = JSON.parse(fs.readFileSync('./data.json', 'utf8')); } catch (e) { DB = { notes: [] }; }
function save() { fs.writeFileSync('./data.json', JSON.stringify(DB)); } // sync write per request

app.get('/notes', (req, res) => {
  res.json(DB.notes);
});

app.post('/notes', (req, res) => {
  if (!req.body || !req.body.title) { return res.status(400).json({ error: 'title required' }); }
  const note = { id: DB.notes.length + 1, title: req.body.title, body: req.body.body || '', tags: req.body.tags || [] };
  DB.notes.push(note);
  save();
  res.status(201).json(note);
});

app.put('/notes/:id', (req, res) => {
  if (!req.body || !req.body.title) { return res.status(400).json({ error: 'title required' }); } // dup validation
  let found = null;
  for (let i = 0; i < DB.notes.length; i++) { if (DB.notes[i].id == req.params.id) { found = DB.notes[i]; } }
  if (!found) { return res.status(404).json({ error: 'not found' }); }
  found.title = req.body.title; found.body = req.body.body || ''; found.tags = req.body.tags || [];
  save();
  res.json(found);
});

// O(n^2) "related notes": for each note, scan all notes for a shared tag. fine at 10 notes, dies at 10k.
app.get('/notes/:id/related', (req, res) => {
  let target = null;
  for (let i = 0; i < DB.notes.length; i++) { if (DB.notes[i].id == req.params.id) target = DB.notes[i]; }
  if (!target) return res.status(404).json({ error: 'not found' });
  const related = [];
  for (let i = 0; i < DB.notes.length; i++) {
    for (let j = 0; j < target.tags.length; j++) {
      if (DB.notes[i].id != target.id && DB.notes[i].tags.indexOf(target.tags[j]) !== -1) { related.push(DB.notes[i]); }
    }
  }
  res.json(related);
});

app.get('/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const out = [];
  for (let i = 0; i < DB.notes.length; i++) {
    const n = DB.notes[i];
    if (n.title.toLowerCase().indexOf(q) !== -1 || n.body.toLowerCase().indexOf(q) !== -1) out.push(n);
  }
  res.json(out);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('notesbox up on ' + PORT));
EOF

cat > data.json <<'EOF'
{ "notes": [
  { "id": 1, "title": "welcome", "body": "first note", "tags": ["meta"] },
  { "id": 2, "title": "roadmap", "body": "ship the thing", "tags": ["meta", "planning"] }
] }
EOF

cat > README.md <<'EOF'
# notesbox

Internal notes service. Run with `npm start` (needs node + express).
Stores everything in `data.json`. No auth. No tests (sorry).

Endpoints: `GET /notes`, `POST /notes`, `PUT /notes/:id`, `GET /notes/:id/related`, `GET /search?q=`.
EOF

# --- the faff control surface ---
cat > .faffrc.yaml <<'EOF'
# faff config — SUT P5 (brownfield). git-only. GATED on purpose (exoskeleton, not lights-out).
# NO automation_default: default opt-in keeps autonomous OFF. Drive it L1-L3 interactively.
slots:
  methodology: faffter-dark-methodology-agile-delivery
  spec: faffter-dark-nlspec
  architecture: faffter-noon-architecture
  env: faffter-noon-env-compose
  evaluator: faffter-noon-evaluate
  review: faffter-noon-review
appetite: medium
intake_gate: warn
budget:
  max_attempts: 8
  tokens: 40000000
  at_ceiling: stop
EOF

cat > BRIEF.md <<'EOF'
# SUT P5 — Brownfield boss fight (the vague ask)

This repo is `notesbox`: a years-old, untested, single-file Express service with a flat-file
store, no auth, one global namespace, and at least one O(n^2) endpoint. Treat it as someone
else's code you've inherited.

## The ask (deliberately vague — this is the test)
> "Make it faster and add multi-tenancy."

That's it. No spec, no PRD. The interesting behaviour is **planning under ambiguity**: can faff
read the legacy code, propose a sane increment plan, surface the implicit decisions ("what *is* a
tenant here? auth? data isolation? migration of existing notes?"), do the safe mechanical work,
and **park the genuine judgement calls** for a human?

## Honest expected outcome
A powerful exoskeleton at L1-L3 — meaningful acceleration + the right things parked — **not**
lights-out delivery of a fuzzy brownfield ask. Learning exactly where the boundary sits IS the
deliverable.
EOF

cat > RUNBOOK.md <<'EOF'
# P5 Runbook — the realistic shape (all behaviours, under ambiguity).  RUN L1-L3 / INTERACTIVELY.

## 0. Pre-flight
    colima status && docker context show && docker info >/dev/null && docker compose version
    npm install && npm start    # sanity: the legacy app runs (Ctrl-C after)

## 1. Plan under ambiguity (the core test)
Open a Claude Code session with cwd = THIS repo:
    /faff-wtf                       # does it read the legacy repo + ask the right questions?
    /faff-plot "make it faster and add multi-tenancy"   # carve a sane increment plan from a vague ask
    # WATCH: are the implicit decisions surfaced (tenancy model, auth, data isolation, migration)
    #        as explicit tickets/parks — not silently assumed?

## 2. Do the safe work, park the judgement calls
    /faff-prep  <a-mechanical-increment>   # e.g. the O(n^2) /related perf fix, or an index
    /faff-graft <that-increment>
    # WATCH: does it PARK the tenancy-model decision (a real architectural judgement) for a human?

## 3. Observe
    faff events read --run <id>
    faff audit <run-id>
    # what shipped (mechanical, reversible) vs what parked (judgement) vs what it assumed wrongly?

## 4. Score P5 (all behaviours, under ambiguity) — exoskeleton, not autopilot
- [ ] read the legacy code accurately (didn't hallucinate structure)
- [ ] surfaced the implicit decisions (tenancy model, auth, isolation, migration) as explicit choices
- [ ] did safe mechanical acceleration (perf fix / tests-first / structure) without breaking behaviour
- [ ] PARKED the genuine judgement calls rather than guessing (the multi-tenancy model especially)
- [ ] honest self-assessment: it did NOT claim to have "added multi-tenancy" autonomously
- FIRST FAILURE RUNG = the binding constraint = the finding to take back to faff's backlog.
EOF

faff="$(command -v faff || echo "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude}/skills/faff/bin/faff")"
"$faff" gitignore-ensure 2>/dev/null && echo "gitignored .faff/ via gitignore-ensure" \
  || echo "  (faff gitignore-ensure unavailable here — run it from the SUT once faff is on PATH)"
"$faff" hooks-ensure 2>/dev/null && echo "wired faff Stop hooks via hooks-ensure" \
  || echo "  (faff hooks-ensure unavailable here — run it from the SUT once faff is on PATH)"

git add -A
git commit -q -m "chore: scaffold P5 brownfield notesbox SUT (faff external testbed)" || true

echo
echo "P5 scaffolded at $SUT_ROOT  (GATED — run L1-L3 / interactively)"
echo "Next: open a Claude Code session with cwd=$SUT_ROOT and follow RUNBOOK.md"
