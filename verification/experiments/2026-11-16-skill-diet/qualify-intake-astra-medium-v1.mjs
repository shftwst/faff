import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=process.cwd(),e=resolve('verification/experiments/2026-11-16-skill-diet');
const sha=b=>createHash('sha256').update(b).digest('hex'),hash=p=>sha(readFileSync(p)),read=p=>JSON.parse(readFileSync(join(e,p),'utf8')),bind=p=>({path:p,sha256:hash(join(e,p))});
const need=(ok,n)=>{if(!ok)throw Error(n)};
const {assessIntakeQuestions}=await import(pathToFileURL(join(e,'assess-intake-questions.mjs')));
const {gradeRenderingCapture}=await import(pathToFileURL(join(root,'eval/control-parity/rendering-artifact.mjs')));
const fixtureName='workflow-fixtures/intake-brief-v2.json',fixture=read(fixtureName),sourceReview=read('intake-brief-v1-source-review.json');
const reviews=['manual-artifact-reviews/intake-astra-medium-v1-independent.json','manual-artifact-reviews/intake-astra-medium-v1-continuation-independent.json'];
const artifacts=reviews.flatMap(n=>read(n).artifact_reviews);
need(artifacts.length===60,'Need all60manualreviews');need(new Set(artifacts.map(a=>a.path)).size===60,'duplicate manual artifacts');
const disclosedManualStatuses=new Map([
 ['intake-brief-astra-medium-v1-baseline-2','semantic-pass-frozen-oracle-fail'],
 ['intake-brief-astra-medium-v1-candidate-3','semantic-pass-frozen-raw-lexical-fail-assessed-pass'],
]);
for(const a of artifacts){
 const manualPass=a.manual_status==='pass'||a.case_id==='greenfield-thin'&&disclosedManualStatuses.get(a.sample)===a.manual_status;
 need(manualPass&&['facts','format','invention'].every(k=>a[k].status==='pass'),'manual failure '+a.path);
 need(hash(resolve(root,a.path))===a.sha256,'manual hash '+a.path);
}
const originalRegistration=read('diet-continuation-architecture-intake-v1.json');
for(const b of [...originalRegistration.plans,...originalRegistration.unchanged_inputs,originalRegistration.runner])need(hash(join(e,b.path))===b.sha256,'registration drift '+b.path);
const correction=read('intake-astra-medium-v1-question-correction.json');
for(const b of correction.bindings)need(hash(join(e,b.path))===b.sha256,'correction drift '+b.path);
need(hash(join(e,'candidates/intake-brief-v1.md'))===sourceReview.candidate_sha256,'candidate source drift');
const samples=[],totals={};
for(const arm of ['baseline','candidate']){
 const t={samples:5,artifacts_passed:0,artifacts_total:30,raw_artifacts_passed:0,decisions_passed:0,decisions_total:60,native_samples_passed:0,manual_artifacts_passed:0,normalisations:0};
 const policy=arm==='baseline'?'baseline/intake-brief-with-context.md':'candidates/intake-brief-v1-with-context.md';
 for(let i=1;i<=5;i++){
  const name=`intake-brief-astra-medium-v1-${arm}-${i}`,base='workflow-runs/'+name,report=read(base+'/report.json'),capture=read(base+'/capture.json'),assessment=read(base+'/assessment.json'),audit=read(base+'/native-audit.json'),manifest=read(base+'/manifest.json'),worker=read(base+'/worker-manifest.json'),state=read(base+'/worker-final-state.json');
  need(state.exit_code===0&&audit.runs.length===1&&audit.runs[0].status==='pass'&&audit.runs[0].complete,'native failure '+name);
  need(worker.requested_model==='gpt-6-astra'&&worker.effort==='medium'&&isDeepStrictEqual(audit.runs[0].model_ids,['gpt-6-astra'])&&isDeepStrictEqual(audit.runs[0].efforts,['medium']),'model mismatch '+name);
  need(manifest.binding.commit==='a8509086ad28fa0e55cf3d1d818f2055294e663b'&&manifest.policy_sha256===hash(join(e,policy))&&manifest.fixture_sha256===hash(join(e,fixtureName))&&manifest.harness_sha256===hash(join(root,'eval/control-parity/rendering-artifact.mjs')),'manifest drift '+name);
  need(!report.bridge.stop&&!report.bridge.rejected&&report.policy_delivery.complete&&!report.policy_delivery.errors.length,'delivery failure '+name);
  need(manifest.task_sha256===hash(join(e,base,'task.json')),'task drift '+name);
  const raw=gradeRenderingCapture(capture,fixture),fresh=assessIntakeQuestions(capture,fixture);
  need(isDeepStrictEqual(raw,report.grade)&&isDeepStrictEqual(fresh.grade,assessment.grade)&&isDeepStrictEqual(fresh.normalisations,assessment.normalisations),'regrade differs '+name);
  need(assessment.status==='pass'&&fresh.grade.status==='pass'&&fresh.grade.cases.length===18,'assessed failure '+name);
  need(assessment.capture_sha256===hash(join(e,base,'capture.json'))&&assessment.report_sha256===hash(join(e,base,'report.json'))&&assessment.assessor_sha256===hash(join(e,'assess-intake-questions.mjs')),'assessment drift '+name);
  need(capture.outputs.length===6,'artifact cardinality '+name);
  for(const output of capture.outputs){const file=base+'/artifacts/'+output.id+'.md';need(hash(join(e,file))===sha(output.text)&&output.persisted_sha256===sha(output.text),'actual artifact drift '+file);need(artifacts.some(a=>a.sample===name&&a.case_id===output.id&&a.sha256===sha(output.text)),'missing manual artifact '+file)}
  t.artifacts_passed+=fresh.grade.cases.filter(c=>c.kind==='artifact'&&c.pass).length;t.raw_artifacts_passed+=raw.cases.filter(c=>c.kind==='artifact'&&c.pass).length;t.decisions_passed+=fresh.grade.cases.filter(c=>c.kind==='decision'&&c.pass).length;t.native_samples_passed++;t.manual_artifacts_passed+=6;t.normalisations+=fresh.normalisations.length;
  samples.push({name,arm,raw_status:report.status,assessed_status:assessment.status,normalisations:fresh.normalisations,artifacts:capture.outputs.map(o=>({id:o.id,sha256:o.persisted_sha256})),bindings:['manifest.json','capture.json','report.json','assessment.json','native-audit.json','native-audit-sample.json','worker-manifest.json','worker-final-state.json'].map(n=>bind(base+'/'+n))});
 }
 totals[arm]=t;
}
const integration=read('intake-astra-medium-v1-integration.json');need(integration.status==='pass'&&integration.source_sha256===sourceReview.candidate_sha256&&integration.checks.every(c=>c.exit_code===0),'integration failed');for(const c of integration.checks)need(hash(join(e,c.path))===c.sha256,'integration drift '+c.path);
const q={schema:1,created_utc:new Date().toISOString(),accepted:true,status:'qualified-bounded-intake-brief-production',model:'gpt-6-astra',effort:'medium',source_sha256:sourceReview.candidate_sha256,source_review:'intake-brief-v1-source-review.json',source_review_sha256:hash(join(e,'intake-brief-v1-source-review.json')),fixed_context_sha256:sourceReview.fixed_context_sha256,before:totals.baseline,after:totals.candidate,samples,manual_artifact_reviews:reviews.map(bind),root_spotcheck:bind('manual-artifact-reviews/intake-astra-medium-v1-root-spotcheck.json'),question_correction:bind('intake-astra-medium-v1-question-correction.json'),integration:{record:bind('intake-astra-medium-v1-integration.json'),tests_passed:632,tests_failed:0,checks:integration.checks},mandatory_dependencies_added:[],limits:['Fresh five-versus-five Astra-medium comparison. Older Sol native failures and Astra-low usage-limit samples remain excluded and preserved.','All60actualbriefs manually read; independently verify source facts, required/optional sections, dependencies, unresolved questions and no invented goals/tickets. Root additionally read candidate1 sixbriefs.','Raw lexical failures remain in baseline2andcandidate3. The identical frozen exact-question assessment applies symmetrically; no sample replaced or semantic requirement relaxed.','There is no executable semantic discovery-brief consumer. This measures persisted brief production and contract regrading, not elicitation, methodology ticket shaping, tracker mutation or a complete jot/plot workflow.','Shared context is fixed to the registered context for both arms; this is a bounded comparison, not a model proof of every combined skill context or statistical equivalence.','Intended daily-driver Opus confirmation remains pending allowance renewal; no general Opus parity or provider billing savings claimed.']};
writeFileSync(join(e,'intake-astra-medium-v1-final-qualification.json'),JSON.stringify(q,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({before:q.before,after:q.after,status:q.status},null,2));
