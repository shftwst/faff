"""Fabricated complete receipts exercise score mechanics only; no model or plugin delivery."""
import json
from pathlib import Path
import tempfile
from unittest import TestCase, main
from unittest.mock import patch
from datetime import datetime, timezone, timedelta

from delivery_fixture import git
from wave_score import A, B, C, D, HUMAN, score, posted_spec, spec_comment, stamp
from waves import fixture, save
from wave_tracker import call


class WaveScoring(TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.arm = Path(self.temp.name)
        self.repo = self.arm / "repo"
        self.env = fixture(Path(__file__).resolve().parents[2], self.arm)
        self.run = self.repo / ".faff/runs/control-beep-boop"
        self.run.mkdir(parents=True)
        self.tracker = self.arm / "tracker.json"
        self.events = []
        self.prs = []
        self.time = 0

    def tick(self):
        self.time += 1
        return (datetime(2026, 11, 1, tzinfo=timezone.utc) + timedelta(seconds=self.time)).isoformat()

    def event(self, name, issue=None, data=None):
        self.events.append({"run_id": self.run.name, "type": name, "issue": issue,
                            "data": data or {}, "ts": self.tick()})

    def op(self, tool, **args):
        with patch("delivery_tracker.now", side_effect=self.tick):
            return call(self.tracker, tool, args)

    def deliver(self, issue):
        self.event("prep-start", issue)
        self.op("create_attachment", issueId=issue, filename="spec.md", content="Test specification")
        self.event("prep-done", issue)
        self.event("build-start", issue)
        file = self.repo / "retry.js"
        content = file.read_text()
        if issue == A:
            content = content.replace("return count;", "return Math.max(0,count);")
            (self.run/A).mkdir()
            save(self.run/A/"discovered-scope.json", [{"title":"Clamp batch retry counts","confidence":"concrete"}])
        if issue == B:
            content += "\nexport const hasRetries = n => normalizeRetries(n) > 0;\n"
        if issue == D:
            content = content.replace("return counts.slice();", "return counts.map(normalizeRetries);")
        file.write_text(content)
        git(self.repo,"add","retry.js",env=self.env)
        git(self.repo,"commit","-qm",issue,env=self.env)
        head = git(self.repo,"rev-parse","HEAD")
        self.prs.append({"number":len(self.prs)+1, "headRefName":issue.lower(), "headRefOid":head,
                         "baseRefName":"main", "state":"MERGED", "mergeCommit":{"oid":head},
                         "testedHeadOid":head, "mergedAt":self.tick(),"title":issue})
        if issue == B:
            # A normal merge record also binds the PR to the issue when branch and title omit the ID.
            self.prs[-1].update(headRefName="predicate", title="Expose retry predicate")
            (self.run/issue).mkdir()
            save(self.run/issue/"merge-record.json", {"pr":self.prs[-1]["number"], "head_sha":head, "merged":True})
        self.op("update_issue", id=issue,status="Done")
        self.event("issue-outcome", issue, {"outcome":"shipped"})

    def test_good_and_perturbed_receipts(self):
        save(self.arm/"invocation.json", {"prompts":["/faff:faff-beep-boop"],"installed":True,"terminal":True,"returncode":0})
        self.event("run-start")
        self.op("list_issues")
        self.deliver(A)
        self.op("create_issue",title="Clamp batch retry counts",description="Discovered during build of KIT-17.",
                relatedTo=[A],labels=["faff-automate"])
        (self.run/"discovered-scope-filed.md").write_text("KIT-21, batch count normalization from KIT-17.")
        self.event("discovered-scope-filed")
        self.op("list_issues")
        self.deliver(B)
        self.deliver(D)
        self.event("run-end")
        (self.run/"events.jsonl").write_text("".join(json.dumps(e)+"\n" for e in self.events))
        save(self.run/"run-ledger.json", {"run_id": self.run.name,"admitted":[A,B,D],"outcomes":{i:"shipped" for i in (A,B,D)},
                                         "owner":{"status":"done"},"stop_reason":"converged/both-dry","discovered_scope_filed":1})
        save(self.arm/"forge.json", {"prs":self.prs})
        # Populate bare Git refs for the synthetic receipts; the fixture forge has its own separate tests.
        git(self.repo,"push","origin","HEAD:refs/heads/control",env=self.env)
        git(self.arm/"origin.git","update-ref","refs/heads/main",self.prs[-1]["headRefOid"])
        result=score(self.arm)
        self.assertTrue(result["pass"],result["details"])
        outcome_pos = next(n for n,e in enumerate(self.events) if e["issue"] == A and e["type"] == "issue-outcome")
        shipped = self.events[outcome_pos]
        enriched = {**shipped, "data": {"outcome": "shipped", "rework_turns": 0}}
        self.events.insert(outcome_pos + 1, enriched)
        def rescore_events():
            (self.run/"events.jsonl").write_text("".join(json.dumps(e)+"\n" for e in self.events))
            return score(self.arm)
        result = rescore_events()
        self.assertTrue(result["pass"], result["details"])
        self.assertEqual(result["details"]["issue_outcome_receipts"][A], [shipped, enriched])
        enriched["data"]["outcome"] = "parked"
        self.assertFalse(rescore_events()["assertions"]["same_run_prep_then_graft_" + A])
        enriched["data"]["outcome"] = "shipped"
        start_pos = next(n for n,e in enumerate(self.events) if e["issue"] == A and e["type"] == "build-start")
        self.events.insert(start_pos, self.events[start_pos].copy())
        self.assertFalse(rescore_events()["assertions"]["same_run_prep_then_graft_" + A])
        self.events.pop(start_pos)
        rescore_events()
        # A pre-existing spec, reviewer claim or later screenshot cannot substitute for a fresh read after unblock.
        db=json.loads(self.tracker.read_text())
        db["operations"]=[op for op in db["operations"] if not (op["tool"]=="list_issues" and any(
            row["identifier"]==B and not row["open_blockers"] for row in op.get("observed", [])))]
        db["issues"][D]["relatedTo"]=[]
        db["issues"][C]["status"]="In Progress"
        save(self.tracker,db)
        (self.run/A/"discovered-scope.json").unlink()
        self.prs[1]["testedHeadOid"]="0"*40
        save(self.arm/"forge.json",{"prs":self.prs})
        save(self.arm/"invocation.json",{"installed":True,"terminal":True,"returncode":0,"prompts":["/faff:faff-beep-boop","continue"]})
        result=score(self.arm)
        for name in ("fresh_unblocked_read_between_A_merge_and_B_prep","new_followup_created_once_linked_then_prepped",
                     "permanent_blocker_never_built","build_recorded_concrete_batch_followup",
                     "landed_tested_behavior_KIT-18","installed_single_unassisted_beep_boop"):
            self.assertFalse(result["assertions"][name],name)
        self.assertFalse(result["pass"])

    def test_canonical_spec_comment_and_receipt_cutoff(self):
        body = "# KIT-17: Fix scalar retry counts\n\n> Spec: faffter-noon-spec · 2026-11-25 · autonomous · claude-code/unknown · faff 0.45.0 · confidence: high. Full spec on Linear KIT-17.\n\n## DONE\n- [ ] Clamp negative integer counts to zero."
        self.assertTrue(spec_comment(body, A))
        self.assertFalse(spec_comment(body, B))
        self.assertFalse(spec_comment("Spec is attached elsewhere.\n## DONE\n- I think it passed.", A))
        self.assertFalse(spec_comment("```markdown\n"+body+"\n```", A))
        self.assertFalse(spec_comment(body.split("## DONE")[0], A))
        self.assertFalse(spec_comment(body.replace("confidence: high", "confidence: unknown"), A))

        def saved():
            return json.loads(self.tracker.read_text())
        ref = self.op("create_comment", issueId=A, body="Starting prep")
        before = stamp(self.tick())
        self.op("update_comment", id=ref["id"], body=body)
        after = stamp(self.tick())
        db=saved()
        self.assertFalse(posted_spec(db,db["operations"],A,before))
        self.assertTrue(posted_spec(db,db["operations"],A,after))
        self.assertFalse(posted_spec(db,db["operations"],B,after))
        self.op("update_comment", id=ref["id"], body="I have unposted the spec.")
        db=saved()
        self.assertTrue(posted_spec(db,db["operations"],A,after))
        self.assertFalse(posted_spec(db,db["operations"],A,stamp(self.tick())))
        self.op("create_comment", issueId=A, body=body)
        db=saved()
        self.assertTrue(posted_spec(db,db["operations"],A,stamp(self.tick())))

    def test_missing_receipts_fail(self):
        self.assertFalse(score(self.arm)["pass"])


if __name__ == "__main__":
    main()
