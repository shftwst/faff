import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {repoRoot, runCli} from "./helpers/run-cli.mjs";

test("the review entry shell returns the configured reviewer and live posture together", t => {
  const root = mkdtempSync(path.join(tmpdir(),"review-entry-"));
  t.after(() => rmSync(root,{recursive:true,force:true}));
  mkdirSync(path.join(root,".faff"));
  writeFileSync(path.join(root,".faffrc.yaml"),"slots:\n  review: team:custom-review\n");
  const skill = readFileSync(path.join(repoRoot,"plugin/skills/faff-graft/SKILL.md"),"utf8");
  const command = skill.match(/\*\*Review entry\.\*\*[\s\S]*?```bash\n([^\n]+)/)[1];
  for (const level of ["L2","L4"]) {
    writeFileSync(path.join(root,"run-ledger.json"),JSON.stringify({level}));
    const env = {...process.env, FAFF_RUN_DIR:root, faff:path.join(repoRoot,"plugin/skills/faff/bin/faff")};
    const result = spawnSync("bash",["-c",command,"bash","--code-review"],{cwd:root,env,encoding:"utf8"});
    assert.equal(result.status,0,result.stderr);
    const [slot,posture] = result.stdout.trim().split("\n");
    assert.equal(slot,"team:custom-review");
    const expected = runCli(["verification","resolve","--json","--code-review"],{cwd:root,env});
    assert.equal(posture,expected.stdout.trim());
    assert.equal(JSON.parse(posture).legs.code_review,level==="L2");
  }
});
