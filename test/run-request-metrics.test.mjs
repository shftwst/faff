import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectRunRequestMetrics } from "../plugin/skills/faff/bin/lib/run-request-metrics.js";
import budget from "../plugin/skills/faff/bin/lib/budget.js";

const at = sec => new Date(Date.UTC(2026,10,1) + sec*1000).toISOString();
function assistant(id, second, content = [], overrides = {}) {
  return {type:"assistant",sessionId:"session1",timestamp:at(second),message:{role:"assistant",id:"msg_"+id,
    model:"claude-opus-5-5",usage:{input_tokens:43,output_tokens:12,cache_read_input_tokens:40,
      cache_creation_input_tokens:30,cache_creation:{ephemeral_5m_input_tokens:8,ephemeral_1h_input_tokens:22}},content},...overrides};
}
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),"request-metrics-"));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  const env = {CLAUDE_CONFIG_DIR:path.join(root,"claude")};
  const runDir = path.join(root,".faff","runs","run-one");
  const dir = budget.transcriptBaseDir(root,env);
  fs.mkdirSync(runDir,{recursive:true}); fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(runDir,"run-ledger.json"),JSON.stringify({admitted:["PROJ-7","PROJ-8"],outcomes:{}}));
  const put = (file,rows) => {
    fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,rows.map(r => typeof r === "string" ? r : JSON.stringify(r)).join("\n")+"\n");
  };
  const main = path.join(dir,"session1.jsonl");
  return {dir,main,put,runDir,report:(opts={}) => collectRunRequestMetrics({root,runDir,env,sessionId:"session1",since:at(10),until:at(20),...opts})};
}
test("unique native responses across parent, nested and legacy workers retain latest usage within the epoch", t => {
  const f = setup(t);
  const d = assistant("duplicate",12);
  const changed = structuredClone(d);
  changed.message.usage.output_tokens = 25;
  changed.timestamp = at(13);
  changed.message.content = [{type:"text",text:"private fixture text"}];
  f.put(f.main,[assistant("before",9),d,changed,assistant("end",20),assistant("wrong",16,[],{sessionId:"other"}),assistant("sdk-wrong",15,[],{sessionId:undefined,session_id:"other"})]);
  const a = path.join(f.dir,"session1/subagents/agent-A.jsonl"), b = path.join(f.dir,"subagents/agent-B.jsonl");
  f.put(a,[assistant("worker",15),d]);
  f.put(b,[assistant("second",17)]);
  f.put(path.join(f.dir,"agent-foreign.jsonl"),[assistant("foreign",15,[],{sessionId:"someone"})]);
  const r = f.report();
  assert.equal(r.requests,3);
  assert.equal(r.turns,null);
  assert.equal(r.coverage.worker_responses,3);
  assert.equal(r.by_model["claude-opus-5-5"].usage.output,49);
  assert.equal(r.by_model["claude-opus-5-5"].usage.cache_write,90);
  assert.equal(r.by_model["claude-opus-5-5"].usage.cache_write_5m,24);
  assert.doesNotMatch(JSON.stringify(r),/msg_duplicate|private fixture text|agent-A|session1|agent-B/);
  assert.deepEqual(f.report().records,r.records);
});
test("real turn IDs, incomplete token classes and truncated records stay distinguishable from zero",t => {
  const f=setup(t), a=assistant("a",11,[],{turnId:"turn-one"}), b=assistant("b",12,[],{turnId:"turn-one"});
  b.message.usage={input_tokens:0};
  f.put(f.main,[a,b,"{truncated"]);
  const r=f.report();
  assert.equal(r.turns,1);
  assert.equal(r.requests,2);
  assert.equal(r.status,"partial");
  assert.equal(r.by_model["claude-opus-5-5"].usage.output,null);
  assert.equal(r.by_model["claude-opus-5-5"].usage.input,43);
  assert.ok(r.warnings.includes("malformed-transcript-row"));
  assert.ok(r.warnings.includes("incomplete-token-usage"));
});
test("scoped worker evidence identifies phase, wave and verified-to-handoff window",t => {
  const f=setup(t), file=path.join(f.dir,"agent-known.jsonl");
  f.put(f.main,[assistant("parent",12)]);
  f.put(path.join(f.runDir,"events.jsonl"),[
    {seq:1,type:"build-start",phase:"build",issue:"PROJ-7",ts:at(10)},
    {seq:2,type:"issue-outcome",phase:"build",issue:"PROJ-7",ts:at(19)}]);
  f.put(file.replace(".jsonl",".meta.json"),[{description:"private project description, PROJ-7 wave 2"}]);
  f.put(file,[
    assistant("verify",11,[{type:"tool_use",name:"Bash",id:"tool-x",input:{command:'"$faff" graft verify-build --issue PROJ-7'}}]),
    {type:"user",sessionId:"session1",timestamp:at(12),message:{content:[{type:"tool_result",tool_use_id:"tool-x",
      content:JSON.stringify({action:"verify-criteria",spec:{token:"verified",issue:"PROJ-7"}})}]}},
    assistant("middle",13),
    assistant("handoff",15,[{type:"text",text:JSON.stringify({issue:"PROJ-7",outcome:"pr-ready",pr:1})}]),
    assistant("later",17)]);
  const r=f.report(), workers=r.records.filter(row=>row.role==="worker");
  assert.deepEqual(workers.map(w=>w.verification_to_handoff),[null,true,true,null]);
  assert.ok(workers.every(w=>w.wave===2 && w.phase==="build" && w.issue==="PROJ-7"));
  assert.equal(r.records.find(x=>x.role==="parent").issue,null);
  assert.equal(r.records.find(x=>x.role==="parent").phase,"build");
  assert.doesNotMatch(JSON.stringify(r),/description|graft verify-build|pr-ready|tool-x/);
});
test("unknown or unsafe session and unavailable transcript preserve null request counts",t=>{
  const f=setup(t);
  assert.equal(f.report().requests,null);
  assert.equal(f.report({sessionId:"../../outside"}).status,"unavailable");
  assert.equal(f.report({since:""}).requests,null);
  f.put(f.main,[assistant("outside",2)]);
  assert.equal(f.report().requests,0);
  const target=path.join(f.dir,"agent-other.jsonl");
  fs.symlinkSync(f.main,target);
  assert.equal(f.report().coverage.files,1);
});
test("recorded consecutive run-done consults bracket parent waves and exclude startup, gap and close", t=>{
  const f=setup(t);
  f.put(f.main,[10,11,12,13,14,15,16,17,18,19].map(n=>assistant("wave"+n,n)));
  const consult = (wave,sec) => ({type:"decision-capture",issue:"__run__",ts:at(sec),
    data:{kernel:"run-done",correlation_id:"run-one/__run__/run-done/"+wave}});
  f.put(path.join(f.runDir,"events.jsonl"),[
    {type:"run-start",ts:at(10)},
    {type:"prep-start",phase:"prep",issue:"PROJ-7",ts:at(11)},consult(1,13),
    {type:"build-start",phase:"build",issue:"PROJ-8",ts:at(15)},consult(2,16),
    {type:"build-start",phase:"build",issue:"PROJ-7",ts:at(17)},consult(4,18),
    {type:"run-end",ts:at(19)}]);
  assert.deepEqual(f.report().records.map(r=>r.wave),[null,1,1,1,null,2,2,null,null,null]);
});
test("standalone graft resolves its one issue while synthetic assistant error rows contribute nothing", t=>{
  const f=setup(t);
  const renamed = path.join(path.dirname(f.runDir),"run-20261126-000000-graft-PROJ-7");
  fs.renameSync(f.runDir,renamed);
  const synthetic = assistant("error",14);
  synthetic.message.model = "<synthetic>";
  const dash = assistant("wrong-id",12); dash.message.id = "msg-danger";
  f.put(f.main,[assistant("real",12),synthetic,dash]);
  const r = f.report({runDir:renamed});
  assert.equal(r.requests,1);
  assert.equal(r.records[0].issue,"PROJ-7");
  assert.equal(r.records[0].phase,"build");
});

test("only workers inherit an unambiguous in-window Agent or Task dispatch through its invocation ID", t => {
  const f = setup(t);
  const dispatch = (id, description, name = "Agent") => ({
    type: "tool_use", name, id, input: { description, prompt: "private prompt PROJ-8" },
  });
  const worker = (id, sec, launch, tools = []) => assistant(id, sec, tools, {parent_tool_use_id: launch});
  f.put(f.main, [
    assistant("early", 9, [dispatch("outside", "PROJ-8")]),
    assistant("root", 10, [dispatch("a", "build PROJ-7"), dispatch("b", "review PROJ-8", "Task")]),
    worker("member", 11, "a", [
      dispatch("nested", "verify"),
      dispatch("foreign", "review OTHER-91"),
      dispatch("multiple", "compare PROJ-7 and PROJ-8"),
    ]),
    worker("nested-result", 12, "nested"),
    worker("sibling", 13, "b"),
    worker("foreign-result", 14, "foreign"),
    worker("multiple-result", 15, "multiple"),
    worker("outside-result", 16, "outside"),
    worker("missing", 17, "unknown"),
    assistant("repeat", 18, [dispatch("ambiguous", "PROJ-7"), dispatch("ambiguous", "PROJ-8")]),
    worker("conflict", 19, "ambiguous"),
  ]);
  const file = path.join(f.dir, "session1/subagents/agent-known.jsonl");
  f.put(file.replace(".jsonl", ".meta.json"), [{toolUseId:"a"}]);
  f.put(file, [assistant("native", 17)]);
  const report = f.report();
  assert.deepEqual(report.records.map(r => r.issue), [null,"PROJ-7","PROJ-7","PROJ-8",null,null,null,null,"PROJ-7",null,null]);
  assert.equal(report.requests, 11);
  assert.ok(report.records.every(r => r.phase === null));
  assert.doesNotMatch(JSON.stringify(report), /private prompt|verify|OTHER-91|nested-result/);
});

test("handoffs bind a worker to its launch and measure returned UTF-8 text once", t => {
  const f = setup(t);
  const launch = assistant("launch", 11, [{type:"tool_use", name:"Agent", id:"private-tool-id", input:{}}]);
  const child = assistant("child", 12, [], {parent_tool_use_id:"private-tool-id"});
  const result = {type:"user", timestamp:at(13), message:{content:[{type:"tool_result", tool_use_id:"private-tool-id",
    content:[{type:"text",text:"résumé"},{type:"image",data:"private-pixels"}]}]}};
  f.put(f.main,[launch,launch,child,result,result]);
  const report = f.report();
  assert.equal(report.requests,2);
  const [parent,worker] = report.records;
  assert.deepEqual(parent.worker_handoffs,[{dispatch_id:worker.worker_dispatch_id,returned_at:at(13),returned_text_bytes:8,is_error:false}]);
  assert.doesNotMatch(JSON.stringify(report), /résumé|private-tool-id|private-pixels/);
  assert.equal(f.report({until:at(13)}).records[0].worker_handoffs[0].returned_at,null);
});

test("actual build dispatch tags bind wave to workers and their nested reviewers", t => {
  const f = setup(t);
  const call = (id,description) => [{type:"tool_use",name:"Agent",id,input:{description}}];
  f.put(f.main,[
    assistant("parent",11,call("outer","PROJ-7 subagent-cluster:a faff-build-wave:3")),
    assistant("build",12,call("inner","Review changes"),{parent_tool_use_id:"outer"}),
    assistant("review",13,[],{parent_tool_use_id:"inner"}),
    assistant("conflict",14,call("invalid","faff-build-wave:3 faff-build-wave:9")),
    assistant("unknown",15,[],{parent_tool_use_id:"invalid"}),
  ]);
  const {records} = f.report();
  assert.deepEqual(records.map(r=>r.wave),[null,3,3,null,null]);
  assert.deepEqual(records.map(r=>r.enclosing_build_wave),[undefined,3,3,undefined,undefined]);
  assert.equal(records[0].worker_handoffs[0].build_wave,3);
  assert.equal(records[1].worker_handoffs[0].build_wave,undefined);
});

test("scopes tool results to the issuing worker and epoch and deduplicates split native responses", t => {
  const f = setup(t);
  const call = id => ({type:"tool_use", id, name:"private-tool", input:{x:"private-value"}});
  const result = (id, error, second, dispatch = null) => ({type:"user", sessionId:"session1",
    timestamp:at(second), parent_tool_use_id:dispatch, message:{content:[
      {type:"tool_result", tool_use_id:id, is_error:error, content:"private-return"}]}});
  const parent = assistant("parent",11,[call("shared"),call("pending")]);
  const worker = assistant("worker",13,[call("shared"),call("disputed")],{parent_tool_use_id:"worker"});
  f.put(f.main,[parent,parent,worker,result("shared",true,14),result("shared",true,14),
    result("shared",false,15,"worker"),result("disputed",true,15,"worker"),
    result("disputed",false,16,"worker"),result("pending",true,20)]);
  const rows = f.report().records;
  assert.deepEqual(rows.map(r=>Object.values(r.tool_outcome_bits).sort()),[[0,2],[1,3]]);
  assert.doesNotMatch(JSON.stringify(rows),/private-|shared|pending|disputed/);
});

test("attributes CLI diagnostic text only to the matched Bash request, independently of shell success", t => {
  const f = setup(t);
  const diagnostic = "faff: unknown-flag: unknown flag --private\nusage: faff eligible [--label L]";
  const call = (id,name) => ({type:"tool_use",id,name,input:{}});
  const ret = (id,content,worker=null) => ({type:"user",sessionId:"session1",timestamp:at(15),
    parent_tool_use_id:worker,message:{content:[{type:"tool_result",tool_use_id:id,content,is_error:false}]}});
  f.put(f.main,[
    assistant("parent",11,[call("shared","Bash")]),
    assistant("worker",12,[call("shared","Read")],{parent_tool_use_id:"agent"}),
    assistant("help",13,[call("help","Bash")]),
    ret("shared",[{type:"text",text:diagnostic}]),ret("shared",diagnostic,"agent"),
    ret("help","usage: faff eligible [--label L]"),
  ]);
  const rows=f.report().records;
  assert.deepEqual(rows.map(r=>r.bash_cli_usage_diagnostic),[true,false,false]);
  assert.deepEqual(rows.map(r=>Object.values(r.tool_outcome_bits)),[[1],[1],[1]]);
  assert.doesNotMatch(JSON.stringify(rows),/--private|usage: faff/);
});
