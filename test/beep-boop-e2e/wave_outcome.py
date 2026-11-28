"""Score discovered-scope filing alongside continued eligible work under the real label policy."""
import json
from pathlib import Path
from wave_score import stamp, behavior, git, EXTRAS, A, B, C, HUMAN, D

def outcome(arm, original, mode="sequential"):
    read=lambda filename: json.loads((arm/filename).read_text())
    tracker,forge=read('tracker.json'),read('forge.json')
    issues,ops=tracker['issues'],tracker['operations']
    checks=original['assertions']
    ledger_files=list((arm/'repo/.faff/runs').glob('*beep*/run-ledger.json'))
    if len(ledger_files)!=1:
        return {'pass':False,'checks':{'single_run':False}}
    ledger=json.loads(ledger_files[0].read_text())
    ev=[json.loads(s) for s in (ledger_files[0].parent/'events.jsonl').read_text().splitlines() if s]
    def times(kind,issue):
        return [stamp(r['ts']) for r in ev if r['type']==kind and r.get('issue')==issue]
    prs={k:next((r for r in forge['prs'] if r['number']==original['details']['delivery_prs'].get(k)),{}) for k in (A,B)}
    landed_at=stamp(prs[A].get('mergedAt'))
    build_b=times('build-start',B)
    scope=issues.get(D,{})
    identities={D,scope.get('id')}
    label_writes=[op for op in ops if op['ok'] and 'faff-automate' in op['arguments'].get('labels',[])
                  and (op.get('result_id') in identities-{None} or op['arguments'].get('id') in identities-{None})]
    report={
        'one_installed_full_run': checks['installed_single_unassisted_beep_boop'] and checks['single_bracketed_run'],
        'queue_discovery':checks['orchestrator_discovered_initial_queue'],
        'A_landed_before_B_build': bool(landed_at and build_b and landed_at <= min(build_b)),
        'scope_recorded_and_filed_once': all(checks[k] for k in ('build_recorded_concrete_batch_followup','run_logged_scope_filing','new_followup_created_once_linked_then_prepped')),
        'child_built_without_automation_label': bool(scope and 'faff-automate' not in scope['labels'] and not label_writes and checks['same_run_prep_then_graft_'+D] and checks['landed_tested_behavior_'+D]),
        'expected_deliveries_and_working_main':all(checks[k] for k in ('distinct_deliveries','final_main_contains_all_behavior','one_converged_reconciled_ledger','tracker_matches_shipped_outcomes')),
        'terminal_reviews_posted':all(checks['posted_terminal_review_'+i] for i in ((A,B,D) + (EXTRAS if mode == "parallel" else ()))),
        'all_specs_and_builds_verified':all(checks[prefix+i] for i in ((A,B,D) + (EXTRAS if mode == "parallel" else ())) for prefix in ('spec_attached_before_graft_','same_run_prep_then_graft_','landed_tested_behavior_')),
        'human_blocked_work_never_built':HUMAN in issues[C].get('blockedBy',[]) and not any(times('build-start',i) for i in (C,HUMAN)) and not set((C,HUMAN)).intersection(ledger.get('admitted',[])),
    }
    # Tracker claim-to-handoff intervals measure implementation before merge.
    boundaries = []
    complete = True
    for key in ((A,B,D) + (EXTRAS if mode == "parallel" else ())):
        row = issues.get(key, {})
        writes = [op for op in ops if op.get("ok") and op["tool"] == "update_issue"
                  and op.get("result_id") == row.get("id")]
        start = end = None
        for op in writes:
            state = op["arguments"].get("status", op["arguments"].get("state"))
            if state == "In Progress" and start is None:
                start = stamp(op["at"])
            if start is not None and state in ("In Review", "Done"):
                end = stamp(op["at"])
                break
        if start is None or end is None or end <= start:
            complete = False
        else:
            boundaries.extend([(start, 1), (end, -1)])
    active = peak = 0
    for _, delta in sorted(boundaries):
        active += delta
        peak = max(active, peak)
    report["observed_claim_concurrency"] = complete and (1 < peak <= 3 if mode == "parallel" else peak == 1)
    return {'pass':all(report.values()),'checks':report,'peak_claims':peak,'run_id':ledger['run_id'],'followup':D if scope else None}

if __name__ == "__main__":
    import argparse
    from wave_score import score

    parser = argparse.ArgumentParser(description="Re-score saved run receipts offline.")
    parser.add_argument("mode", choices=["sequential", "parallel"])
    parser.add_argument("run", type=Path)
    args = parser.parse_args()
    result = outcome(args.run, score(args.run, args.mode), args.mode)
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result["pass"] else 1)
