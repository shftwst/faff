import unittest
from request_metrics import request_metrics
from response_timeline import markers


def row(second, parent=None, *calls):
    return dict(at=f"2026-01-01T00:00:{second:02}Z", parent=parent,
                tools={c["id"]:c for c in calls})


class RequestMetrics(unittest.TestCase):
    def test_split_and_missing_windows(self):
        dispatch = dict(id="d", name="Agent")
        verify = dict(id="v", name="Bash", **markers("Bash", 'timeout 590 faff graft verify-build --issue KIT-2'))
        check = dict(id="c", name="Bash", **markers("Bash", '"$faff" run checkpoint --phase wave'))
        rows = [row(0), row(2,None,dispatch), row(3,"d",verify), row(4,"d"), row(5,None,check), row(6)]
        events = [dict(ts=rows[1]["at"], type="prep-start")]
        m = request_metrics(rows, events, [1], {"KIT-2","KIT-3"})
        self.assertEqual(m["all_responses_per_shipped_issue"], 3)
        self.assertEqual(m["parent_responses"], dict(by_wave={1:2},outside_or_unattributed=2))
        g = m["graft_verification_to_return"]
        self.assertEqual(g["by_issue"], {"KIT-2":[2]})
        self.assertEqual(g["shipped_without_window"], ["KIT-3"])
        self.assertEqual(g["mean_per_covered_shipped_issue"], 2)
        partial = request_metrics(rows, events, [1,2], set())
        self.assertIsNone(partial["all_responses_per_shipped_issue"])
        self.assertIsNone(partial["parent_responses"]["by_wave"])

    def test_skip_ambiguous_chain_and_log_mentions(self):
        self.assertEqual(markers("Bash", 'echo "faff graft verify-build --issue KIT-1"'), {})
        dispatch = dict(id="d",name="Agent")
        rows = [row(1,None,dispatch)]
        for i in (1,2):
            rows.append(row(i+1,"d",dict(id=str(i),name="Bash",
                **markers("Bash",f"faff graft verify-build --issue KIT-{i}"))))
        g = request_metrics(rows, [], [], set())["graft_verification_to_return"]
        self.assertEqual(g["ambiguous_worker_contexts"], 1)
        self.assertEqual(g["by_issue"], {})
