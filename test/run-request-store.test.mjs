import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import budget from "../plugin/skills/faff/bin/lib/budget.js";
import {runCli} from "./helpers/run-cli.mjs";

test("economics retains scoped native responses from two owner epochs after their source files disappear", t => {
  const root = mkdtempSync(path.join(tmpdir(),"request-history-"));
  t.after(() => rmSync(root,{recursive:true,force:true}));
  const env = {...process.env,CLAUDE_CONFIG_DIR:path.join(root,"claude")};
  const runDir = path.join(root,"run");
  const base = budget.transcriptBaseDir(root,env);
  mkdirSync(runDir); mkdirSync(base,{recursive:true});
  const stamp = second => new Date(Date.UTC(2026,10,26,0,0,second)).toISOString();
  const ledger = {owner:{status:"done",started_at:stamp(2),last_heartbeat:stamp(4)}, outcomes:{"FAFF-1":"shipped"},
    budget:{sessions:[{session_id:"first",closed_at:stamp(2)},{session_id:"second",closed_at:null}]}};
  writeFileSync(path.join(runDir,"run-ledger.json"),JSON.stringify(ledger));
  writeFileSync(path.join(runDir,"events.jsonl"),JSON.stringify({type:"run-start",ts:stamp(1)})+"\n");
  for (const [sid,times] of [["first",[0,1,1,2]],["second",[1,2,3,4]]]) {
    writeFileSync(path.join(base,sid+".jsonl"),times.map(n => JSON.stringify({type:"assistant",sessionId:sid,
      timestamp:stamp(n),turnId:"same-local-turn",message:{id:"msg_"+sid+n,role:"assistant",model:"fixture",
      content:[{type:"text",text:"fixture-private"}],usage:{input_tokens:1,output_tokens:2,cache_read_input_tokens:3,cache_creation_input_tokens:4}}})).join("\n"));
  }
  const query = (...args) => {
    const result = runCli(["economics","--root",root,"--run-dir",runDir,"--by","requests",...args],{cwd:root,env});
    assert.equal(result.code,0,result.stderr);
    return JSON.parse(result.stdout);
  };
  assert.equal(query().requests,null);
  const saved = query("--refresh");
  assert.equal(saved.requests,3);
  assert.equal(saved.turns,null);
  assert.equal(saved.transcript_turn_ids,2);
  assert.equal(saved.by_role.parent,3);
  assert.equal(saved.records,undefined);
  assert.equal(query("--details").records.length,3);
  assert.equal(saved.usage_by_model.fixture.cache_read,9);
  assert.equal(saved.observed_requests_per_shipped_issue,3);
  assert.deepEqual(query("--refresh"),saved);
  rmSync(base,{recursive:true});
  assert.deepEqual(query(),saved);
  assert.equal(query("--refresh").status,"partial");
  assert.equal(query().requests,3);
  assert.doesNotMatch(readFileSync(path.join(runDir,"run-request-metrics.json"),"utf8"),/fixture-private|same-local-turn|msg_first/);
});

test("scheduler timings use the same issue's latest admission and explicitly report incomplete attempts", async t => {
  const {requestReport} = await import("../plugin/skills/faff/bin/lib/run-request-store.js");
  const dir=mkdtempSync(path.join(tmpdir(),"build-timing-"));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const timeline=[
    ["issue-admitted","A-1",0],["issue-admitted","B-2",1],["build-start","B-2",4],
    ["build-start","A-1",5],["build-start","A-1",6],["issue-outcome","A-1",16],
    ["issue-admitted","C-3",20],["issue-outcome","C-3",21],["build-start","C-3",22],
  ];
  writeFileSync(path.join(dir,"events.jsonl"),timeline.map(([type,issue,s],seq)=>JSON.stringify({
    seq,type,issue,ts:new Date(1e12+s*1000).toISOString()
  })).join("\n"));
  const report = requestReport(dir,{},true).build_timing;
  assert.equal(report.starts,4);
  assert.equal(report.open_starts,2);
  assert.equal(report.restarts_without_outcome,1);
  assert.deepEqual(report.admission_to_start,{count:2,median_seconds:4,max_seconds:5});
  assert.deepEqual(report.start_to_outcome,{count:1,median_seconds:10,max_seconds:10});
  assert.equal(report.observations.length,3);
  assert.equal(requestReport(dir,{}).build_timing.observations,undefined);
});
