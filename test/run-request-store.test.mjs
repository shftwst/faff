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

test("economics keeps per-call evidence across partial refreshes, includes worker exposure and preserves unknown legacy coverage", t => {
  const root=mkdtempSync(path.join(tmpdir(),"request-outcomes-"));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const env={...process.env,CLAUDE_CONFIG_DIR:path.join(root,"claude")};
  const dir=path.join(root,"run"), base=budget.transcriptBaseDir(root,env);
  mkdirSync(dir); mkdirSync(base,{recursive:true});
  const at=n=>new Date(1e12+n*1000).toISOString();
  const ledger={owner:{status:"done",session_id:"sess",started_at:at(0),last_heartbeat:at(9)}};
  writeFileSync(path.join(dir,"run-ledger.json"),JSON.stringify(ledger));
  const query=(...args)=>{
    const r=runCli(["economics","--root",root,"--run-dir",dir,"--by","requests",...args],{cwd:root,env});
    assert.equal(r.code,0,r.stderr); return JSON.parse(r.stdout);
  };
  const put=(file,rows)=>writeFileSync(file,rows.map(r=>JSON.stringify(r)).join("\n"));
  const use=id=>({type:"tool_use",id,name:"privateTool",input:{value:"private-input"}});
  const request=(id,blocks,cache)=>({type:"assistant",sessionId:"sess",timestamp:at(1),
    message:{id:"msg_"+id,content:blocks,model:"fixture",usage:{cache_read_input_tokens:cache}}});
  const ret=id=>({type:"user",sessionId:"sess",timestamp:at(2),message:{content:[
    {type:"tool_result",tool_use_id:id,is_error:true,content:"private-result"}]}});
  const parent=path.join(base,"sess.jsonl"), worker=path.join(base,"agent-a.jsonl");
  put(parent,[request("p",[use("one"),use("two")],10),ret("one"),request("text",[],20)]);
  put(worker,[request("w",[use("sub")],15),ret("sub")]);
  let r=query("--refresh","--details");
  assert.deepEqual(r.tool_outcomes,{measured_requests:3,unmeasured_requests:0,incomplete_tool_list_requests:0,
    calls:3,observed_results:2,missing_results:1,errors:2,uncertain_results:0,
    all_tools_failed:{requests:1,requests_with_cache_read_usage:1,observed_cache_read_tokens:15}});
  put(parent,[request("p",[use("two")],10),ret("two")]);
  rmSync(worker);
  r=query("--refresh","--details");
  assert.equal(r.tool_outcomes.all_tools_failed.requests,2);
  assert.equal(r.tool_outcomes.all_tools_failed.observed_cache_read_tokens,25);
  assert.deepEqual(r.records.find(x=>x.role==="parent" && x.tool_outcomes.calls).tool_outcomes,
    {calls:2,observed_results:2,errors:2,uncertain_results:0});
  const file=path.join(dir,"run-request-metrics.json"), store=JSON.parse(readFileSync(file));
  for(const row of store.epochs["0"].records) delete row.tool_outcome_bits;
  writeFileSync(file,JSON.stringify(store));
  assert.equal(query().tool_outcomes,null);
  assert.ok(query("--details").records.every(r=>r.tool_outcomes===null));
  assert.doesNotMatch(readFileSync(file,"utf8"),/privateTool|private-input|private-result/);
});
