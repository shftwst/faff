import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {analyzeCorpus,readMapDecisionKernelCommands}=require('../../../../plugin/skills/faff/bin/lib/shadow-fidelity.js');
const dir=path.dirname(new URL(import.meta.url).pathname);
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const save=(name,x)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(x,null,2)+'\n');
const installed=[];
for(const root of [path.join(os.homedir(),'.codex/plugins/cache/faff/faff/0.44.0/skills'),path.join(os.homedir(),'.agents/skills')]){
 const rows=[];
 for(const n of fs.readdirSync(root).filter(n=>n==='faff'||n.startsWith('faff-')||n.startsWith('faffter-')||n.startsWith('faffidavit-'))){
  const f=path.join(root,n,'SKILL.md');if(!fs.existsSync(f))continue;
  const s=fs.readFileSync(f,'utf8');const desc=s.match(/^description:\s*(.*)$/m)?.[1]||'';const repo=path.join('plugin/skills',n,'SKILL.md');
  rows.push({name:n,description_chars:desc.replace(/^"|"$/g,'').length,sha256:digest(s),matches_checkout:fs.existsSync(repo)&&digest(s)===digest(fs.readFileSync(repo)),resolved:fs.realpathSync(f)});
 }
 installed.push({root,entries:rows.length,description_est_tokens:rows.reduce((a,x)=>a+Math.ceil(x.description_chars/4),0),rows});
}
save('installed-reading.json',installed);
const previous=JSON.parse(fs.readFileSync(path.join(dir,'../data/prior-run-fidelity.json')));
const records=[];const sources=[];
for(const p of previous.source_files){const text=fs.readFileSync(p,'utf8');sources.push({path:p,sha256:digest(text)});records.push(...text.split('\n').filter(Boolean).map(JSON.parse).filter(r=>['decision-capture','decision-capture-action'].includes(r.type)));}
const replay=analyzeCorpus(records,{mapDecisionKernelCommands:readMapDecisionKernelCommands(process.cwd())});
save('september-replay.json',{sources,source_read_only:true,record_count:records.length,matrix:replay.matrix,action_uncaptured:replay.action_uncaptured.length,null_result:replay.null_result});
const old=JSON.parse(fs.readFileSync(path.join(dir,'../data/local-codex-usage.json')));
const sessions=[];
for(const s of old.sessions){const f=path.join(os.homedir(),'.codex/sessions',s.file);const bytes=fs.readFileSync(f);const rows=bytes.toString('utf8').split('\n').filter(Boolean).map(JSON.parse);const totals=rows.filter(r=>r.type==='event_msg'&&r.payload?.type==='token_count'&&r.payload?.info?.total_token_usage).map(r=>r.payload.info.total_token_usage);const last=totals.at(-1);sessions.push({file:s.file,sha256:digest(bytes),hash_matches:digest(bytes)===s.sha256,usage_event_count:totals.length,counter_resets:totals.filter((v,i)=>i>0&&v.total_tokens<totals[i-1].total_tokens).length,last_reported_totals:last,matches_report:JSON.stringify(last)===JSON.stringify(s.last_reported_totals)});}
save('local-usage-recheck.json',{scope:'Recheck only the five files selected by the original audit. No transcript text retained. No inference about representativeness or the newest-file selection.',sessions});
console.log(JSON.stringify({installed:installed.map(x=>({entries:x.entries,description_est_tokens:x.description_est_tokens})),september:{records:records.length,graded:Object.values(replay.matrix).reduce((a,x)=>a+x.denominator,0),uncaptured:replay.action_uncaptured.length},sessions:sessions.map(x=>({hash_matches:x.hash_matches,matches_report:x.matches_report,events:x.usage_event_count,resets:x.counter_resets}))}));
