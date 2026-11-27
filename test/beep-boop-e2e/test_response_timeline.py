import json
import tempfile
import unittest
from pathlib import Path
from response_timeline import Timeline


class Capture(unittest.TestCase):
    def test_split_records_share_identity_and_exclude_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            raw, target = (Path(tmp)/f for f in ("stream", "timeline"))
            raw.touch()
            with Timeline(raw, target):
                with raw.open("w") as out:
                    for block in [{"type":"text","text":"private"},
                                  {"type":"tool_use","name":"Bash","id":"t","input":{"command":"private KIT-17 heartbeat"}}]:
                        print(json.dumps({"type":"assistant","parent_tool_use_id":"agent1",
                                          "message":{"id":"response1","content":[block],"usage":{"output_tokens":12}}}),file=out)
            rows = list(map(json.loads,target.read_text().splitlines()))
            self.assertEqual([r["response"] for r in rows], ["response1"]*2)
            self.assertEqual(rows[1]["tools"][0]["issues"], ["KIT-17"])
            self.assertNotIn("private",target.read_text())
