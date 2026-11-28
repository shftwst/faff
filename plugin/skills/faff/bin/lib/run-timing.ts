// === region:factory — diagnostic lifecycle timings outside the evidence chain ===
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
const { parseArgs } = require("./argv");
const { readLeafNoFollow } = require("./leaf-read");
type Mark = { ts: string; type: string; issue?: string };
const spool = "worker-timing.jsonl";
const ready = "worker-evidence-ready";
const reconcile = "member-verify-start";
const issueKey = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function noteTiming(
  dir: string,
  issue: string,
  type: string,
  ts: string,
): void {
  // Auxiliary telemetry must never change a custody verdict or CLI exit status.
  try {
    const flags = fs.constants;
    const fd = fs.openSync(
      path.join(dir, spool),
      flags.O_APPEND |
        flags.O_CREAT |
        flags.O_WRONLY |
        flags.O_NOFOLLOW |
        flags.O_NONBLOCK,
      0o600,
    );
    try {
      if (fs.fstatSync(fd).isFile())
        fs.writeSync(fd, JSON.stringify({ ts, type, issue }) + "\n");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    /* A missing sample remains unknown. */
  }
}

export function finishPrepTiming(
  root: string,
  issue: string,
  since: string,
  until: string,
) {
  if (
    !issueKey.test(issue) ||
    !Number.isFinite(Date.parse(since)) ||
    !Number.isFinite(Date.parse(until))
  )
    return;
  const key = createHash("sha256")
    .update(issue + "\n" + since)
    .digest("hex")
    .slice(0, 24);
  const dir = path.join(root, ".faff", "prep", "timing", key);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lines = [
    { ts: since, type: "prep-start", issue },
    { ts: until, type: "prep-done", issue },
  ];
  try {
    fs.writeFileSync(
      path.join(dir, "events.jsonl"),
      lines.map((e) => JSON.stringify(e)).join("\n") + "\n",
      { flag: "wx", mode: 0o600 },
    );
  } catch (err) {
    if (!(err instanceof Error && "code" in err && err.code === "EEXIST")) throw err;
  }
  saveTiming(dir);
}

function rows(dir: string, file: string): { rows: Mark[]; skipped: number } {
  const found: Mark[] = [];
  let skipped = 0;
  const leaf = readLeafNoFollow(path.join(dir, file));
  if (leaf.kind === "absent") return { rows: [], skipped };
  if (leaf.kind !== "regular") throw Error("invalid " + file);
  const raw: string = leaf.bytes.toString("utf8");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line);
      if (
        !v ||
        typeof v.ts !== "string" ||
        !Number.isFinite(Date.parse(v.ts)) ||
        typeof v.type !== "string" ||
        (v.issue != null && typeof v.issue !== "string")
      )
        throw Error();
      found.push({
        ts: v.ts,
        type: v.type,
        ...(v.issue ? { issue: v.issue } : {}),
      });
    } catch {
      skipped++;
    }
  }
  return { rows: found, skipped };
}

type ReceiptRow = {
  id?: string;
  at?: string;
  role?: string;
  usage?: Record<string, number | null>;
};
type Receipt = {
  since?: string;
  until?: string;
  status?: string;
  records?: ReceiptRow[];
};

const tokenClasses: ReadonlyArray<"input" | "output" | "cache_read" | "cache_write"> = ["input", "output", "cache_read", "cache_write"];

function requestWindows(
  dir: string,
  firstPrep?: string,
  prepEnd?: string,
  firstBuild?: string,
  lastOutcome?: string,
) {
  const prep = readLeafNoFollow(path.join(dir, "prep-request-metrics.json"));
  const store = readLeafNoFollow(path.join(dir, "run-request-metrics.json"));
  const receipts: Receipt[] = [];
  if (store.kind === "regular") {
    const data = JSON.parse(store.bytes.toString("utf8"));
    if (data.schema === 1 && data.epochs)
      receipts.push(...Object.values<Receipt>(data.epochs));
  } else if (prep.kind === "regular")
    receipts.push(JSON.parse(prep.bytes.toString("utf8")));
  if (!receipts.length) return null;
  const windows = {
    entry: bucket(),
    prep_and_admission: bucket(),
    build_to_last_outcome: bucket(),
    after_last_outcome: bucket(),
    unattributed: bucket(),
  };
  const seen = new Map<string, ReceiptRow>();
  for (const receipt of receipts)
    for (const row of receipt.records ?? []) if (row.id) seen.set(row.id, row);
  for (const row of seen.values()) {
    const at = Date.parse(row.at ?? "");
    const before = (edge?: string) =>
      edge !== undefined && at < Date.parse(edge);
    const window = !Number.isFinite(at)
      ? windows.unattributed
      : before(firstPrep)
        ? windows.entry
        : firstPrep && (before(firstBuild) || (!firstBuild && prepEnd && at <= Date.parse(prepEnd)))
          ? windows.prep_and_admission
          : firstBuild && at >= Date.parse(firstBuild)
            ? lastOutcome && at > Date.parse(lastOutcome)
              ? windows.after_last_outcome
              : windows.build_to_last_outcome
            : windows.unattributed;
    window.requests++;
    if (row.role === "parent" || row.role === "worker") window[row.role]++;
    for (const key of tokenClasses) {
      const value = row.usage?.[key];
      if (typeof value === "number") window[key] = (window[key] ?? 0) + value;
    }
  }
  return {
    coverage: receipts.map((r) => ({
      status: r.status,
      since: r.since,
      until: r.until,
    })),
    observed_requests: seen.size,
    windows,
  };
}
function bucket() {
  const tokens: Record<
    "input" | "output" | "cache_read" | "cache_write",
    number | null
  > = { input: null, output: null, cache_read: null, cache_write: null };
  return { requests: 0, parent: 0, worker: 0, ...tokens };
}

export function timingReport(dir: string) {
  const ledger = rows(dir, "events.jsonl");
  const signals = rows(dir, spool);
  const types = new Set([
    "run-start",
    "run-end",
    "tidy-done",
    "prep-start",
    "prep-done",
    "issue-admitted",
    "build-start",
    "issue-outcome",
    "discovered-scope-filed",
    ready,
    reconcile,
  ]);
  const timeline = [
    ...ledger.rows.filter((e) => e.type !== ready && e.type !== reconcile),
    ...signals.rows.filter((e) => e.type === ready || e.type === reconcile),
  ]
    .filter((e) => types.has(e.type))
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const first = (kind: string) => timeline.find((e) => e.type === kind)?.ts;
  const last = (kind: string) =>
    timeline.filter((e) => e.type === kind).at(-1)?.ts;
  const elapsed = (a?: string, b?: string) =>
    a && b && Date.parse(b) >= Date.parse(a)
      ? Date.parse(b) - Date.parse(a)
      : null;
  const active = new Map<
    string,
    {
      issue: string;
      start: string;
      ready?: string;
      verify?: string;
      outcome?: string;
    }
  >();
  const attempts: Array<NonNullable<ReturnType<typeof active.get>>> = [];
  for (const e of timeline) {
    if (!e.issue) continue;
    if (e.type === "build-start") {
      const attempt = { issue: e.issue, start: e.ts };
      attempts.push(attempt);
      active.set(e.issue, attempt);
      continue;
    }
    const a = active.get(e.issue);
    if (!a) continue;
    if (e.type === ready) a.ready ??= e.ts;
    if (e.type === reconcile) a.verify ??= e.ts;
    if (e.type === "issue-outcome") {
      a.outcome = e.ts;
      active.delete(e.issue);
    }
  }
  const prepEnd = last("prep-done");
  let runEnd = last("run-end");
  let endSource = runEnd ? "run-end" : null;
  if (!runEnd) {
    const leaf = readLeafNoFollow(path.join(dir, "run-ledger.json"));
    if (leaf.kind === "regular") {
      const metadata = JSON.parse(leaf.bytes.toString("utf8"));
      if (
        metadata?.level === "L2" &&
        metadata.owner?.status === "done" &&
        typeof metadata.owner.last_heartbeat === "string"
      ) {
        runEnd = metadata.owner.last_heartbeat;
        endSource = "terminal-owner-heartbeat";
      }
    }
  }
  return {
    schema: 1,
    prep_observed_span_ms: elapsed(first("prep-start"), prepEnd),
    run: path.basename(path.resolve(dir)),
    skipped_rows: ledger.skipped + signals.skipped,
    run_ms: elapsed(first("run-start"), runEnd),
    end_source: endSource,
    prep_to_build_ms: elapsed(first("prep-start"), first("build-start")),
    build_to_close_ms: elapsed(first("build-start"), runEnd),
    timeline,
    request_windows: requestWindows(
      dir,
      first("prep-start"),
      prepEnd,
      first("build-start"),
      last("issue-outcome"),
    ),
    builds: attempts.map((a) => ({
      ...a,
      start_to_ready_ms: elapsed(a.start, a.ready),
      ready_to_verify_ms: elapsed(a.ready, a.verify),
      start_to_outcome_ms: elapsed(a.start, a.outcome),
    })),
  };
}

export function saveTiming(dir: string): void {
  const tmp = path.join(dir, ".run-timing-" + randomUUID());
  try {
    fs.writeFileSync(tmp, JSON.stringify(timingReport(dir), null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    fs.renameSync(tmp, path.join(dir, "run-timing.json"));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export function cmdTiming(args: string[], wait = false): number {
  const flags = wait
    ? {
        "--run-dir": { arity: 1 },
        "--since": { arity: 1 },
        "--timeout-ms": { arity: 1 },
      }
    : { "--run-dir": { arity: 1 }, "--json": { arity: 0 } };
  const { values, positionals, errors } = parseArgs(args, {
    flags,
    positionals: { min: wait ? 1 : 0, ...(wait ? {} : { max: 0 }) },
  });
  try {
    const infra = require("./shared-infra");
    const dir =
      values["--run-dir"] ??
      process.env.FAFF_RUN_DIR ??
      (wait ? null : infra.latestRunDir(infra.findRoot()));
    if (errors.length || !dir || !fs.statSync(dir).isDirectory())
      throw Error("expected --run-dir DIR or FAFF_RUN_DIR");
    if (wait) {
      const since = Date.parse(values["--since"]);
      const timeout = Number(values["--timeout-ms"] ?? 30000);
      if (
        !Number.isFinite(since) ||
        !Number.isSafeInteger(timeout) ||
        timeout < 0 ||
        timeout > 60000 ||
        !positionals.every((id: string) => issueKey.test(id))
      )
        throw Error(
          "expected --since ISO_TIMESTAMP [--timeout-ms 0..60000] ISSUE...",
        );
      const end = performance.now() + timeout;
      const sleeper = new Int32Array(new SharedArrayBuffer(4));
      for (;;) {
        const hit = rows(dir, spool).rows.find(
          (e) =>
            e.type === ready &&
            Date.parse(e.ts) >= since &&
            positionals.includes(e.issue),
        );
        if (hit) {
          console.log(JSON.stringify({ wake: "evidence-ready", ...hit }));
          break;
        }
        const left = end - performance.now();
        if (left <= 0) {
          console.log(JSON.stringify({ wake: "checkpoint" }));
          break;
        }
        Atomics.wait(sleeper, 0, 0, Math.min(left, 250));
      }
    } else {
      const report = timingReport(dir);
      if (values["--json"]) console.log(JSON.stringify(report));
      else {
        const sec = (ms: number | null) =>
          ms === null ? "unknown" : (ms / 1000).toFixed(1) + "s";
        if (report.prep_observed_span_ms !== null)
          console.log(
            `Observed prep span ${sec(report.prep_observed_span_ms)}`,
          );
        console.log(
          `Run ${report.run} | elapsed ${sec(report.run_ms)} | prep to build ${sec(report.prep_to_build_ms)} | build to close ${sec(report.build_to_close_ms)}`,
        );
        if (report.request_windows)
          for (const [name, w] of Object.entries(
            report.request_windows.windows,
          )) {
            if (w.requests)
              console.log(
                `${name} | ${w.requests} observed requests | parent ${w.parent} | worker ${w.worker} | cache reads ${w.cache_read ?? "unknown"} tokens`,
              );
          }
        for (const b of report.builds)
          console.log(
            `${b.issue} | build to evidence ${sec(b.start_to_ready_ms)} | evidence to verification ${sec(b.ready_to_verify_ms)} | build to outcome ${sec(b.start_to_outcome_ms)}`,
          );
      }
    }
    return 0;
  } catch (err) {
    console.error(
      "faff run " +
        (wait ? "wait-ready" : "timing") +
        ": " +
        (err instanceof Error ? err.message : String(err)),
    );
    return 2;
  }
}
