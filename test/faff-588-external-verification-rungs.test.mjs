// FAFF-588 — the external-verification README's rung results table and the frozen P1 case's
// pinned inputs.
//
// The rung results checker recomputes every row status from the linked cases' `Main result:`
// lines and the first failure rung from the row statuses, so neither can be asserted without the
// evidence underneath. The frozen-input guard re-hashes the four inputs EVP-L4-P1-0002 pins.
// Repository files are read only; the symlink fixture lives in a temporary directory. No network.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");
const EV_REL = "verification/external-verification";
const EV = path.join(REPO, EV_REL);
const README_PATH = path.join(EV, "README.md");
const RESULTS = path.join(EV, "results");

const SIX_RUNGS_HEADING = "## The six rungs";
const RUNG_RESULTS_HEADING = "### Rung results";
const RUNG_RESULTS_COLUMNS = ["Rung", "Script", "Status", "Cases", "Note"];
const FIRST_FAILURE_RE = /^\*\*First failure rung:\*\* `([^`]+)`/;
const STATUSES = new Set(["pass", "fail", "inconclusive", "not-run"]);
const SCORED = new Set(["pass", "fail", "inconclusive"]);
const STATUS_FOR_MAIN_RESULT = {
  "supports-hypothesis": "pass",
  "does-not-support": "fail",
  inconclusive: "inconclusive",
  "protocol-failure": "inconclusive",
};
const MAIN_RESULT_RE = /^Main result: (supports-hypothesis|does-not-support|inconclusive|protocol-failure)\s*$/m;
const CASE_LINK_RE = /^results\/([^/]+)\/README\.md$/;
const MD_LINK_RE = /\[[^\]]*\]\(([^)\s]*)\)/g;

const FROZEN_CASE = "EVP-L4-P1-0002";
const FROZEN_CASE_DIR = `${EV_REL}/results/2026-08-30-l4-p1-link-shortener-faff-499`;
const FROZEN_REPORT = `${FROZEN_CASE_DIR}/report.md`;
const PROTOCOL_ROLE = "protocol README";
const FROZEN_INPUTS = [
  { role: "PRD", path: `${FROZEN_CASE_DIR}/evidence/prd.md`, sha256: "1a7ad6627d14f369f2e176cb40276f277b5446bccc3e8a7f4f7290a49cf3d7a7" },
  { role: "P1 scaffolder", path: `${EV_REL}/scaffold-p1-link-shortener.sh`, sha256: "ae2016e429092a6de675ef5e0a36e2631b43ad38c3892a90ed1d980052d01674" },
  { role: "assertion harness", path: `${EV_REL}/assert-p1-top-of-loop.sh`, sha256: "3e19e987c9687077e52179a64564cb0163930a8377f319c978bdbd451295e1b7" },
  { role: PROTOCOL_ROLE, path: `${EV_REL}/protocol/v0.1/README.md`, sha256: "2082af1f485d3b938eabf8cd80480b2384cf411d93d72b2b93c86050638681a8" },
];

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const readme = () => fs.readFileSync(README_PATH, "utf8");

function splitRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

function parseTableAfterHeading(markdown, heading) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start === -1) throw new Error(`heading not found: ${heading}`);
  let i = start + 1;
  while (i < lines.length && !lines[i].trim().startsWith("|")) {
    if (lines[i].startsWith("#")) throw new Error(`no table after heading: ${heading}`);
    i++;
  }
  const table = [];
  while (i < lines.length && lines[i].trim().startsWith("|")) table.push(lines[i++]);
  if (table.length < 2 || !/^\|?[\s:|-]+\|?$/.test(table[1].trim())) throw new Error(`no table after heading: ${heading}`);
  return { header: splitRow(table[0]), rows: table.slice(2).map(splitRow) };
}

function sectionLines(markdown, heading) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("#"));
  return end === -1 ? rest : rest.slice(0, end);
}

function labelFor(script) {
  if (script === "`scaffold-faff-lab.sh`") return "faff-lab";
  const m = /^`scaffold-p(\d+)-[a-z0-9-]+\.sh`$/.exec(script);
  return m ? `P${m[1]}` : null;
}

function caseMainResult(readCaseFile, caseDir) {
  const text = readCaseFile(caseDir, "report.md") ?? readCaseFile(caseDir, "README.md");
  const m = text === null ? null : MAIN_RESULT_RE.exec(text);
  return m ? m[1] : null;
}

function deriveFirstFailure(rows) {
  for (const { rung, status } of rows) {
    if (status === "pass") continue;
    if (status === "fail") return rung;
    return "undetermined";
  }
  return "none";
}

function makeCaseReader(resultsRoot) {
  return (caseDir, fileName) => {
    if (caseDir.includes("/") || caseDir.includes("..")) return null;
    try {
      const real = fs.realpathSync(path.join(resultsRoot, caseDir, fileName));
      const root = fs.realpathSync(resultsRoot);
      return real.startsWith(root + path.sep) ? fs.readFileSync(real, "utf8") : null;
    } catch {
      return null;
    }
  };
}

function caseLinks(cell) {
  const targets = [...cell.matchAll(MD_LINK_RE)].map((m) => m[1]);
  const leftover = cell.replace(MD_LINK_RE, "").replace(/[\s,]/g, "");
  return { targets, wellFormed: cell === "none" || (targets.length > 0 && leftover === "") };
}

function checkRungResults(readmeText, readCaseFile) {
  let six;
  let rungs;
  try {
    six = parseTableAfterHeading(readmeText, SIX_RUNGS_HEADING);
    rungs = parseTableAfterHeading(readmeText, RUNG_RESULTS_HEADING);
  } catch (err) {
    return [`RUNG_SECTION_MISSING: ${err.message}`];
  }
  const sixScript = six.header.indexOf("Script");
  if (sixScript === -1) return ["RUNG_SECTION_MISSING: no Script column in The six rungs"];
  if (RUNG_RESULTS_COLUMNS.some((c) => !rungs.header.includes(c))) {
    return [`RUNG_SECTION_MISSING: Rung results header must have ${RUNG_RESULTS_COLUMNS.join(", ")}`];
  }
  const col = Object.fromEntries(RUNG_RESULTS_COLUMNS.map((c) => [c, rungs.header.indexOf(c)]));
  const violations = [];

  const firstDiff = Array.from({ length: Math.max(six.rows.length, rungs.rows.length) }, (_, i) => i)
    .find((i) => six.rows[i]?.[sixScript] !== rungs.rows[i]?.[col.Script]);
  if (six.rows.length !== rungs.rows.length || firstDiff !== undefined) {
    violations.push(`RUNG_ROWS_MISMATCH: ${rungs.rows.length} rows vs ${six.rows.length} in The six rungs; first difference at row ${(firstDiff ?? 0) + 1}`);
  }

  const derived = [];
  for (const row of rungs.rows) {
    if (row.length !== rungs.header.length) {
      violations.push(`RUNG_ROWS_MISMATCH: row "${row[0]}" has ${row.length} cells, header has ${rungs.header.length}`);
      continue;
    }
    const rung = row[col.Rung];
    if (rung !== labelFor(row[col.Script])) {
      violations.push(`RUNG_ROWS_MISMATCH: label ${rung} does not match script ${row[col.Script]}`);
    }

    const m = /^`([^`]+)`$/.exec(row[col.Status]);
    const status = m && STATUSES.has(m[1]) ? m[1] : null;
    if (status === null) violations.push(`RUNG_STATUS_UNKNOWN: ${rung} status ${row[col.Status]}`);
    derived.push({ rung, status });

    const { targets, wellFormed } = caseLinks(row[col.Cases]);
    if (!wellFormed) violations.push(`RUNG_CASE_MISSING: ${rung} Cases cell is neither "none" nor links`);
    if (SCORED.has(status) && targets.length === 0) {
      violations.push(`RUNG_CASE_REQUIRED: ${rung} is ${status} with no linked case`);
    }
    const caseDirs = [];
    for (const target of targets) {
      const link = CASE_LINK_RE.exec(target);
      if (!link || target.includes("..") || readCaseFile(link[1], "README.md") === null) {
        violations.push(`RUNG_CASE_MISSING: ${rung} links ${target}`);
      } else {
        caseDirs.push(link[1]);
      }
    }

    const executed = caseDirs
      .map((dir) => ({ dir, result: caseMainResult(readCaseFile, dir) }))
      .filter((c) => c.result !== null)
      .sort((a, b) => (a.dir < b.dir ? -1 : 1));
    const expected = executed.length === 0 ? "not-run" : STATUS_FOR_MAIN_RESULT[executed.at(-1).result];
    if (status !== null && status !== expected) {
      violations.push(`RUNG_STATUS_UNSUPPORTED: ${rung} is ${status} but its linked cases give ${expected}`);
    }
  }

  const line = sectionLines(readmeText, RUNG_RESULTS_HEADING).map((l) => FIRST_FAILURE_RE.exec(l)).find(Boolean);
  if (!line) {
    violations.push("RUNG_SECTION_MISSING: no first failure rung line");
  } else if (line[1] !== deriveFirstFailure(derived)) {
    violations.push(`FIRST_FAILURE_MISMATCH: line reads ${line[1]}, rule gives ${deriveFirstFailure(derived)}`);
  }
  return violations;
}

function changedInputMessage(input, actual) {
  const head = `${input.role} ${input.path} changed (expected ${input.sha256}, got ${actual}).`;
  if (input.role === PROTOCOL_ROLE) {
    return `${head} ${FROZEN_CASE} pins protocol v0.1, so v0.1 stays frozen: ship the protocol change as a new ${EV_REL}/protocol/v0.2/ beside v0.1 and leave v0.1 byte-for-byte unchanged. The other pinned inputs (PRD, P1 scaffolder, assertion harness) have no versioned path: changing one opens a new experiment identity, so register a successor case under results/ and move this guard to it.`;
  }
  return `${head} ${FROZEN_CASE} is frozen: changing a pinned input opens a new experiment identity (register a new case under results/), it does not amend this one. Revert the change, or register a successor case and move this guard to it.`;
}

function checkFrozenInputs(readBytes, reportText) {
  const failures = [];
  for (const input of FROZEN_INPUTS) {
    let actual;
    try {
      actual = sha256(readBytes(input.path));
    } catch {
      actual = "a missing file";
    }
    if (actual !== input.sha256) failures.push(changedInputMessage(input, actual));
    if (!reportText.includes(input.sha256)) {
      failures.push(`${input.role} pin ${input.sha256} no longer appears in the frozen ${FROZEN_CASE} report.md; frozen sections must not be edited.`);
    }
  }
  return failures;
}

const realReader = makeCaseReader(RESULTS);
const readRepoBytes = (rel) => fs.readFileSync(path.join(REPO, rel));
const frozenReport = () => fs.readFileSync(path.join(REPO, FROZEN_REPORT), "utf8");

function codes(violations) {
  return violations.map((v) => v.split(":")[0]);
}

function withRow(text, rung, replace) {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.startsWith(`| ${rung} |`));
  assert.notEqual(i, -1, `row ${rung} not found`);
  lines[i] = replace(lines[i]);
  return lines.join("\n");
}

function setCell(text, rung, column, value) {
  return withRow(text, rung, (line) => {
    const cells = splitRow(line);
    cells[RUNG_RESULTS_COLUMNS.indexOf(column)] = value;
    return `| ${cells.join(" | ")} |`;
  });
}

function setFirstFailure(text, value) {
  return text.replace(/^\*\*First failure rung:\*\* `[^`]+`/m, `**First failure rung:** \`${value}\``);
}

function stubReader(cases) {
  return (dir, file) => (dir in cases ? cases[dir][file] ?? null : realReader(dir, file));
}

const link = (dir) => `[\`results/${dir}/\`](results/${dir}/README.md)`;

describe("rung results table", () => {
  test("the committed README satisfies every invariant", () => {
    assert.deepEqual(checkRungResults(readme(), realReader), []);
  });

  test("case main results are read from the committed P1 cases", () => {
    assert.equal(caseMainResult(realReader, "2026-08-29-l4-p1-link-shortener-faff-499"), "inconclusive");
    assert.equal(caseMainResult(realReader, "2026-08-30-l4-p1-link-shortener-faff-499"), null);
  });

  test("a missing heading or first failure rung line is RUNG_SECTION_MISSING", () => {
    assert.deepEqual(codes(checkRungResults(readme().replace(RUNG_RESULTS_HEADING, "### Rung outcomes"), realReader)), ["RUNG_SECTION_MISSING"]);
    const noLine = readme().replace(/^\*\*First failure rung:\*\*.*\n/m, "");
    assert.deepEqual(codes(checkRungResults(noLine, realReader)), ["RUNG_SECTION_MISSING"]);
  });

  test("a deleted, swapped or edited row is RUNG_ROWS_MISMATCH", () => {
    const deleted = readme().replace(/^\| P3 \|.*\n/m, "");
    assert.ok(codes(checkRungResults(deleted, realReader)).includes("RUNG_ROWS_MISMATCH"));

    const lines = readme().split("\n");
    const p2 = lines.findIndex((l) => l.startsWith("| P2 |"));
    [lines[p2], lines[p2 + 1]] = [lines[p2 + 1], lines[p2]];
    assert.ok(codes(checkRungResults(lines.join("\n"), realReader)).includes("RUNG_ROWS_MISMATCH"));

    const script = setCell(readme(), "P4", "Script", "`scaffold-p4-stripe-live.sh`");
    assert.ok(codes(checkRungResults(script, realReader)).includes("RUNG_ROWS_MISMATCH"));
  });

  test("a label that does not match its script is RUNG_ROWS_MISMATCH", () => {
    const relabelled = setCell(readme(), "P2", "Rung", "P3");
    assert.deepEqual(codes(checkRungResults(relabelled, realReader)), ["RUNG_ROWS_MISMATCH"]);
  });

  test("an out-of-set status is RUNG_STATUS_UNKNOWN and blocks the derivation", () => {
    const passed = setCell(readme(), "P2", "Status", "`passed`");
    assert.deepEqual(codes(checkRungResults(passed, realReader)), ["RUNG_STATUS_UNKNOWN"]);
    assert.equal(deriveFirstFailure([{ rung: "P1", status: null }, { rung: "P2", status: "fail" }]), "undetermined");
  });

  test("a scored status with no linked case is RUNG_CASE_REQUIRED", () => {
    const unbacked = setCell(readme(), "P2", "Status", "`pass`");
    assert.ok(codes(checkRungResults(unbacked, realReader)).includes("RUNG_CASE_REQUIRED"));
  });

  test("a link to a missing case or through .. is RUNG_CASE_MISSING", () => {
    const missing = setCell(readme(), "P2", "Cases", link("2026-01-01-no-such-case"));
    assert.deepEqual(codes(checkRungResults(missing, realReader)), ["RUNG_CASE_MISSING"]);
    const dotdot = setCell(readme(), "P2", "Cases", "[`x`](results/../README.md)");
    assert.deepEqual(codes(checkRungResults(dotdot, realReader)), ["RUNG_CASE_MISSING"]);
    const prose = setCell(readme(), "P2", "Cases", "see the P1 cases");
    assert.deepEqual(codes(checkRungResults(prose, realReader)), ["RUNG_CASE_MISSING"]);
  });

  test("a P1 status that its linked cases do not record is RUNG_STATUS_UNSUPPORTED", () => {
    for (const status of ["pass", "not-run"]) {
      const text = setCell(readme(), "P1", "Status", `\`${status}\``);
      assert.ok(codes(checkRungResults(text, realReader)).includes("RUNG_STATUS_UNSUPPORTED"), status);
    }
  });

  test("a row's status must equal its linked case's mapped main result", () => {
    const reader = stubReader({ "2026-09-01-p2-stub": { "README.md": "# stub", "report.md": "Main result: does-not-support\n" } });
    const linked = setCell(readme(), "P2", "Cases", link("2026-09-01-p2-stub"));
    assert.deepEqual(codes(checkRungResults(setCell(linked, "P2", "Status", "`pass`"), reader)), ["RUNG_STATUS_UNSUPPORTED"]);
    assert.deepEqual(checkRungResults(setCell(linked, "P2", "Status", "`fail`"), reader), []);
  });

  test("a first failure rung line that disagrees with the rule is FIRST_FAILURE_MISMATCH", () => {
    for (const value of ["none", "P1"]) {
      assert.deepEqual(codes(checkRungResults(setFirstFailure(readme(), value), realReader)), ["FIRST_FAILURE_MISMATCH"], value);
    }
  });

  test("the most recent executed case sets the status, and a P2 failure behind a P1 pass is derived", () => {
    const reader = stubReader({
      "2026-09-01-p1-stub": { "README.md": "# stub", "report.md": "Main result: supports-hypothesis\n" },
      "2026-09-02-p2-stub": { "README.md": "# stub", "report.md": "Main result: does-not-support\n" },
    });
    let text = setCell(readme(), "P1", "Cases", `${splitRow(readme().split("\n").find((l) => l.startsWith("| P1 |")))[3]}, ${link("2026-09-01-p1-stub")}`);
    text = setCell(text, "P1", "Status", "`pass`");
    text = setCell(setCell(text, "P2", "Cases", link("2026-09-02-p2-stub")), "P2", "Status", "`fail`");
    const violations = checkRungResults(text, reader);
    assert.deepEqual(codes(violations), ["FIRST_FAILURE_MISMATCH"]);
    assert.match(violations[0], /rule gives P2/);
  });

  test("deriveFirstFailure follows the stated rule", () => {
    const rows = (...statuses) => statuses.map((status, i) => ({ rung: i === 5 ? "faff-lab" : `P${i + 1}`, status }));
    const rest = (n, s) => Array(n).fill(s);
    assert.equal(deriveFirstFailure(rows("pass", "fail", ...rest(4, "not-run"))), "P2");
    assert.equal(deriveFirstFailure(rows("inconclusive", "fail", ...rest(4, "not-run"))), "undetermined");
    assert.equal(deriveFirstFailure(rows("pass", ...rest(5, "not-run"))), "undetermined");
    assert.equal(deriveFirstFailure(rows(...rest(6, "pass"))), "none");
    assert.equal(deriveFirstFailure(rows("fail", ...rest(5, "not-run"))), "P1");
    assert.equal(deriveFirstFailure(rows(...rest(5, "pass"), "fail")), "faff-lab");
  });

  test("a case reached through a symlink outside results/ is RUNG_CASE_MISSING (real filesystem)", (t) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-588-"));
    t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
    const results = path.join(tmp, "results");
    const outside = path.join(tmp, "outside");
    const writeCase = (dir, mainResult) => {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "README.md"), "# case\n");
      fs.writeFileSync(path.join(dir, "report.md"), `Main result: ${mainResult}\n`);
    };
    writeCase(path.join(results, "2026-09-01-real-case"), "does-not-support");
    writeCase(path.join(outside, "escaped-case"), "does-not-support");
    fs.symlinkSync("2026-09-01-real-case", path.join(results, "2026-09-02-inside-link"));
    fs.symlinkSync(path.join("..", "outside", "escaped-case"), path.join(results, "2026-09-03-escape-link"));
    fs.mkdirSync(path.join(results, "2026-09-04-file-link"));
    fs.symlinkSync(path.join(outside, "escaped-case", "README.md"), path.join(results, "2026-09-04-file-link", "README.md"));

    const reader = makeCaseReader(results);
    assert.equal(reader("2026-09-02-inside-link", "README.md"), "# case\n");
    assert.equal(reader("2026-09-03-escape-link", "README.md"), null);
    assert.equal(reader("2026-09-04-file-link", "README.md"), null);
    assert.equal(fs.readFileSync(path.join(results, "2026-09-03-escape-link", "README.md"), "utf8"), "# case\n");
    fs.mkdirSync(path.join(results, "2026-09-05-unreadable", "report.md"), { recursive: true });
    assert.equal(reader("2026-09-05-unreadable", "report.md"), null);

    const base = setCell(setCell(readme(), "P1", "Status", "`not-run`"), "P1", "Cases", "none");
    for (const dir of ["2026-09-03-escape-link", "2026-09-04-file-link"]) {
      const escaped = setCell(setCell(base, "P2", "Cases", link(dir)), "P2", "Status", "`fail`");
      const violations = checkRungResults(escaped, reader);
      assert.ok(codes(violations).includes("RUNG_CASE_MISSING"), dir);
      assert.ok(violations.some((v) => v.includes(`results/${dir}/README.md`)), dir);
    }
    const inside = setCell(setCell(base, "P2", "Cases", link("2026-09-02-inside-link")), "P2", "Status", "`fail`");
    assert.deepEqual(checkRungResults(inside, reader), []);
  });
});

describe("frozen EVP-L4-P1-0002 inputs", () => {
  test("the four pinned inputs match the committed files and the frozen report", () => {
    assert.deepEqual(checkFrozenInputs(readRepoBytes, frozenReport()), []);
  });

  test("a changed scaffolder names the frozen case and the new-experiment-identity cost", () => {
    const scaffolder = FROZEN_INPUTS.find((i) => i.role === "P1 scaffolder");
    const reader = (rel) => (rel === scaffolder.path ? Buffer.concat([readRepoBytes(rel), Buffer.from(" ")]) : readRepoBytes(rel));
    const failures = checkFrozenInputs(reader, frozenReport());
    assert.equal(failures.length, 1);
    for (const needle of ["P1 scaffolder", scaffolder.path, FROZEN_CASE, "new experiment identity"]) {
      assert.ok(failures[0].includes(needle), needle);
    }
    assert.ok(!failures[0].includes("protocol/v0.2/"));
  });

  test("a changed protocol README directs the edit to protocol/v0.2/ and names the other inputs' cost", () => {
    const protocol = FROZEN_INPUTS.find((i) => i.role === PROTOCOL_ROLE);
    const reader = (rel) => (rel === protocol.path ? Buffer.from("edited protocol\n") : readRepoBytes(rel));
    const failures = checkFrozenInputs(reader, frozenReport());
    assert.equal(failures.length, 1);
    for (const needle of [protocol.path, FROZEN_CASE, `${EV_REL}/protocol/v0.2/`, "v0.1 byte-for-byte unchanged", "PRD, P1 scaffolder, assertion harness", "new experiment identity", "successor case"]) {
      assert.ok(failures[0].includes(needle), needle);
    }
  });

  test("a missing pinned input fails rather than throwing", () => {
    const prd = FROZEN_INPUTS.find((i) => i.role === "PRD");
    const reader = (rel) => {
      if (rel === prd.path) throw new Error("ENOENT");
      return readRepoBytes(rel);
    };
    const failures = checkFrozenInputs(reader, frozenReport());
    assert.equal(failures.length, 1);
    assert.match(failures[0], /^PRD .* got a missing file/);
  });

  test("a report copy missing one pin fails the cross-check, naming the role", () => {
    const harness = FROZEN_INPUTS.find((i) => i.role === "assertion harness");
    const edited = frozenReport().replaceAll(harness.sha256, "0".repeat(64));
    const failures = checkFrozenInputs(readRepoBytes, edited);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /^assertion harness pin [0-9a-f]{64} no longer appears in the frozen EVP-L4-P1-0002 report\.md/);
  });
});
