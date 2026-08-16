# FAFF-838 — cage-acceptance point-2: fix the broken reachability URL and reconcile runbook ↔ plan schema

> Spec: faffter-dark-nlspec · 2026-08-16 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-838.
> build-tier: mechanical

## Why

Point 2 of `docs/reference/cage-engine-acceptance.md` ("the published port is reachable from inside the cage") reads a health path out of the ProvisionPlan and curls it:

```bash
hpath=$(node -e '... (p.health_checks.find(h=>h.name==="app")||{path:"/health"}).path')
curl -fsS "$endpoint$hpath"
```

That snippet assumes `health_checks[].path` is always a URL path. It is not. In the plan that `faff env compose-gen` emits (`plugin/skills/faff/bin/lib/env.js`), the field is **overloaded** by service kind:

- an **app** service (`env.js:419`, `:431`) carries a real URL path — `{ name: "app", path: "/health", expected_status: 200 }`;
- a **datastore** service (`env.js:409`) carries a full probe *command* — for minio (`env.js:54`), `{ name: "minio", path: "curl -f http://localhost:9000/minio/health/ready", expected_status: 0 }`.

The `expected_status` field is the tell: `200` means "HTTP status of an app URL", `0` means "exit code of a probe command".

For the profile point 2 is actually exercised against — a synthetic minio datastore (FAFF-381 audit finding 1, tracked as FAFF-837) — the snippet fails two ways:

1. `.find(h => h.name === "app")` matches nothing (the entry is named `minio`), so it falls back to `{path:"/health"}` and curls `localhost:9000/health` — the wrong route; minio answers on `/minio/health/ready`.
2. Had it read the minio entry, `"$endpoint$path"` concatenates a base URL onto a command string (`http://localhost:9000curl -f http://…`) — a malformed URL.

The FAFF-381 in-cage run proved the port itself is reachable (HTTP 200 from a cage-local process against the minio route); only the runbook snippet is wrong. This ticket makes the runbook correct and makes the runbook and the documented plan schema agree on what `path` means.

## What

Two coordinated documentation changes, no code change to the emitted plan schema:

1. **Fix point 2's snippet** in `docs/reference/cage-engine-acceptance.md` so it builds a correct URL for both service kinds and succeeds against the minio point-2 subject.
2. **State the field's real meaning** in one place in the runbook, and add the same one-line clarification to the plan-schema description in `docs/guide/cli.md` (the `env` row, which today lists `health_checks[]` without saying what `path` holds), so runbook and schema doc are consistent.

### The load-bearing decision — is `path` a URL path or a command?

**Chosen:** Treat `health_checks[].path` as a **probe descriptor, not a universal URL path**, and fix the *documentation* on both sides to say so — do not change what `compose-gen` writes into the field.

Rationale: the field cannot be made a universal URL path, because non-HTTP datastores (postgres, redis, mysql) have no URL at all — their probe is `pg_isready` / a redis `PING` / etc., which is intrinsically a command. So the ticket's "change compose-gen to always write a path" option is not achievable in general; the honest, consistent story is that `path` is a probe whose interpretation depends on the service (disambiguated by `expected_status`). The docs are the thing that was wrong, not the emitted schema.

**Chosen:** For the reachable base, use the plan's existing resolved primitives (`endpoint`, and `endpoints{}` / `surfaces[]` added by FAFF-791/FAFF-836) rather than reconstructing a URL by string-concatenation. The base is already correctly resolved per service; the snippet only needs to append the app URL path, or extract the embedded URL from a datastore probe command.

**Punt:** Renaming/splitting the field (e.g. `path` → `probe_cmd` + optional `http_path`) so the name stops lying — needs human (decides: architecture). It is out of scope here: it ripples into the gated `env-handle` contract (`faff contract env-handle`), the `faffter-noon-env-compose` producer, and every plan/handle consumer, and still can't yield a URL for non-HTTP stores. If judged worth doing, it is its own cross-contract ticket; this docs fix stands alone and does not depend on it.

### The corrected snippet (illustrative target, not prescriptive to the character)

Branch on whether the selected health check's `path` is a URL path or a probe command, using the already-resolved `endpoint` as the base:

```bash
url=$(node -e '
  const p = JSON.parse(require("fs").readFileSync("plan.json","utf8"));
  const base = p.endpoint;                                  // resolved reachable base (FAFF-791/836)
  const hc = (p.health_checks||[]).find(h => h.name==="app") || (p.health_checks||[])[0] || {};
  const path = hc.path || "";
  // health_checks[].path is a probe descriptor: a URL path for an HTTP app (expected_status 200),
  // else a full probe command with the health URL embedded (expected_status 0).
  if (path.startsWith("/")) console.log(base + path);
  else { const m = String(path).match(/https?:\/\/\S+/); console.log(m ? m[0] : base); }
')
curl -fsS "$url"     # expect the health route to answer (HTTP 200 for an app; the store route for a datastore)
```

The implementer may instead curl `$endpoint` directly with a short note that any answer proves port reachability — either is acceptable provided the snippet, as written, succeeds against a minio-only plan and the surrounding prose is consistent with the field's real meaning.

## How

- Edit `docs/reference/cage-engine-acceptance.md` point 2 (lines ~47-53): replace the `hpath`/`"$endpoint$hpath"` derivation with a snippet that resolves the URL correctly for both service kinds (per the illustrative target above), and add one sentence naming what `health_checks[].path` holds (URL path for an HTTP app with `expected_status: 200`; a full probe command for a datastore with `expected_status: 0`).
- Edit `docs/guide/cli.md` — the `env` row (line ~148, where the ProvisionPlan's `health_checks[]` is listed) — add the same one-line clarification of the `path` field's dual meaning, so the schema description and the runbook agree.
- Do not modify `plugin/skills/faff/bin/lib/env.js` or any contract; the emitted schema is unchanged.
- Keep house voice per the spec dialect: skimmable prose, no invented label schemes.

## Done — acceptance criteria

1. Point 2 of `docs/reference/cage-engine-acceptance.md` no longer concatenates `health_checks[].path` onto `$endpoint` unconditionally; the snippet, run against a minio-only ProvisionPlan (`compose-gen` on a synthetic minio profile), produces a well-formed URL that targets minio's actual health route (not `/health`) — verifiable by reading the plan's minio `health_check` and confirming the derived URL is `http(s)://…/minio/health/ready` (or the resolved `$endpoint` itself), never a base with a command string appended.
2. The runbook states, in one place at point 2, that `health_checks[].path` is a URL path for an HTTP app service (`expected_status: 200`) and a full probe command for a datastore service (`expected_status: 0`).
3. `docs/guide/cli.md`'s ProvisionPlan/`env` description carries the same one-line meaning of `health_checks[].path`, so runbook and schema doc no longer disagree.
4. No change to `plugin/skills/faff/bin/lib/env.js` or any `faff-contract:*` definition; `faff env compose-gen` output is byte-identical (the existing `env` selftest still passes).
5. Prose passes the repo's doc/skill lint (no broken markdown, house voice).

## Already shipped against this surface

- **FAFF-381** (Done) — the in-cage acceptance run that surfaced this as finding 2 and routed it here; it is the source audit, not a fix of the snippet.
- **FAFF-791** (Done) — added the routable `surfaces[]`/`endpoints{}` the corrected snippet should read for a reachable base.
- **FAFF-836** (Done) — exposed `env base.host` to the CLI; part of the same endpoint-resolution machinery. Neither touched the point-2 snippet.
- **FAFF-837** (Backlog, sibling finding 1) — names a real-infra repo / synthetic profile as the point-2 subject; complementary, not overlapping (this ticket fixes the URL derivation, FAFF-837 fixes the subject repo).

confidence: high
spec-review: approve
