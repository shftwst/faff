import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import budget from "../plugin/skills/faff/bin/lib/budget.js";
import econ from "../plugin/skills/faff/bin/lib/economics.js";

test("a worker's tracker result earns cache attribution only within that worker", t => {
  const root = mkdtempSync(path.join(tmpdir(),"worker-cache-"));
  t.after(() => rmSync(root,{recursive:true,force:true}));
  const env = { CLAUDE_CONFIG_DIR:root, CLAUDE_CODE_SESSION_ID:"owned" };
  const dir = budget.transcriptBaseDir(root,env);
  mkdirSync(dir,{recursive:true});
  writeFileSync(path.join(dir,"owned.jsonl"),"");
  const row = (n,content,usage) => ({sessionId:"owned",isSidechain:true,timestamp:new Date(n*1000).toISOString(),message:{content,usage}});
  const a = [row(1,[{type:"tool_use",id:"tool1",name:"mcp__tracker__list_comments",input:{}}]),
    row(2,[{type:"tool_result",tool_use_id:"tool1",content:"x".repeat(800)}])];
  const b = [row(3,[],{cache_read_input_tokens:1000})];
  function write(name,rows) {writeFileSync(path.join(dir,name),rows.map(r => JSON.stringify(r)).join("\n"));}
  write("agent-first.jsonl",a);
  write("agent-second.jsonl",b);
  function snapshot() {
    const {records} = econ.readRunTranscriptRecords(root,env,null);
    return econ.economicsMcpBreakdown(records,{},null);
  }
  const split = snapshot();
  assert.equal(split.rows[0].cache_read_measured_tok,0);
  assert.equal(split.reconciliation.unattributed,1000);
  write("agent-first.jsonl",[...a,...b]);
  write("agent-second.jsonl",[]);
  assert.ok(snapshot().rows[0].cache_read_measured_tok > 0);
  const streamed = [...a.map(r => ({...r,parent_tool_use_id:"first"})), {...b[0],parent_tool_use_id:"second"}];
  assert.equal(econ.economicsMcpBreakdown(streamed,{},null).rows[0].cache_read_measured_tok,0);
});
