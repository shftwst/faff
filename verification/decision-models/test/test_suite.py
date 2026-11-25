import argparse
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import suite


class PairedRunner(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.frozen = self.root / "suite"
        suite.prepare([ROOT / "controls.json"], self.frozen, "test")
        self.packets = self.frozen / "packets.json"
        self.keys = suite.read(self.frozen / "key.json")

    def arm(self, model, code):
        adapter = self.root / (model + ".py")
        adapter.write_text(code)
        return argparse.Namespace(packets=self.packets, out=self.root / (model + ".json"),
                                  provider="external", model=model, retry_failed=False, timeout=10, adapter_revision=None,
                                  command=json.dumps([sys.executable, str(adapter)]))

    def constant(self, label):
        return self.arm(label, '''
import json, os, sys
request = json.load(sys.stdin)
assert set(request) == {"protocol", "model", "packet"} and os.listdir(".") == []
assert set(request["packet"]) == {"claim","evidence","options","question"}
print(json.dumps(dict(model=request["model"], label=request["model"], confidence=0.95, usage={"requests": 1})))
''')

    def test_two_replaceable_arms_and_blinding(self):
        first = self.constant("supported")
        second = self.constant("insufficient")
        self.assertEqual(18, suite.run(first)["completed"])
        before = first.out.read_bytes()
        self.assertEqual(18, suite.run(first)["attempts"])
        self.assertEqual(first.out.read_bytes(), before)
        suite.run(second)
        a, b = suite.read(first.out), suite.read(second.out)
        calibration = suite.compare(self.keys, a, b, .90, "calibration")
        self.assertEqual(set(calibration["splits"]), {"calibration"})
        report = suite.compare(self.keys, a, b, .90)["splits"]["holdout"]
        self.assertEqual(report["panels"]["all"]["a"]["false_clear_rate_among_unproved"], 1)
        self.assertIsNone(report["panels"]["all"]["b"]["error_rate_among_clearances"])
        self.assertEqual(report["simulated_a_then_b"]["fallback_required"], 0)
        self.assertEqual(report["simulated_b_then_a"]["first_stage_retained"], 0)
        reversed_report = suite.compare(self.keys, b, a, .99)["splits"]["holdout"]
        self.assertEqual(reversed_report["panels"]["all"]["b"], report["panels"]["all"]["a"])
        self.assertEqual(reversed_report["simulated_b_then_a"]["first_stage_retained"], 0)
        self.assertEqual(report["usage_a"]["totals_on_success"]["requests"], len(report["disagreement_ids"]))
        keys = self.keys["keys"]
        for group in {k["group"] for k in keys.values()}:
            self.assertEqual(1, len({k["split"] for k in keys.values() if k["group"] == group}))
        self.assertEqual(set(suite.read(self.packets)["packets"]), set(keys))
        next(iter(keys.values()))["expected"] = "changed"
        with self.assertRaisesRegex(ValueError, "key has changed"):
            suite.compare(self.keys, a, b, .9)

    def test_invalid_response_does_not_turn_into_abstention(self):
        arm = self.arm("sample", "print('{}')")
        with self.assertRaisesRegex(ValueError, "adapter failed"):
            suite.run(arm)
        self.assertEqual({}, suite.read(arm.out)["results"])
        with self.assertRaisesRegex(ValueError, "retry-failed"):
            suite.run(arm)
        with self.assertRaisesRegex(ValueError, "run incomplete"):
            suite.compare(self.keys, suite.read(arm.out), suite.read(arm.out), .9)
        arm.retry_failed = True
        with self.assertRaisesRegex(ValueError, "adapter failed"):
            suite.run(arm)
        self.assertEqual(2, len(suite.read(arm.out)["attempts"]))

    def test_routing_treats_missing_confidence_as_fallback(self):
        rows = {"x": {"label": "supported", "confidence": None}}
        other = {"x": {"label": "contradicted", "confidence": None}}
        metrics = suite.routing({"x": {"expected": "contradicted"}}, rows, other, ["x"], .5)
        self.assertEqual(1, metrics["fallback_required"])
        self.assertEqual(1, metrics["paired_outcome"]["correct"])

    def test_probability_scoring_preserves_native_distribution(self):
        raw = {"label": "supported", "model": "typed-1", "confidence": 0.8,
               "probabilities": {"supported": 0.8, "contradicted": 0.15, "insufficient": 0.05}}
        prediction = suite.check_result(raw, "typed-1")
        metrics = suite.summarize({"x": {"expected": "supported"}}, {"x": prediction}, ["x"])
        self.assertAlmostEqual(metrics["multiclass_brier"], .065)
        self.assertEqual(metrics["cases_with_probabilities"], 1)
        with self.assertRaisesRegex(ValueError, "probability distribution"):
            suite.check_result(dict(raw, label="contradicted"), "typed-1")

    def test_reject_mutated_packet_and_model(self):
        manifest = suite.read(self.packets)
        next(iter(manifest["packets"].values()))["claim"] += " More."
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            suite.check_manifest(manifest)
        with self.assertRaisesRegex(ValueError, "different model"):
            suite.check_result({"label": "supported", "model": "other"}, "sample")
        for value in (2, float("nan"), True):
            with self.assertRaisesRegex(ValueError, "confidence"):
                suite.check_result({"label": "supported", "confidence": value, "model": "sample"}, "sample")
