import io
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import providers

MODEL = "example/decision-1-20260101"
PACKET = {
    "question": "Which conclusion follows?", "claim": "The result is sorted.",
    "evidence": [{"id": "code", "text": "return sorted(items)", "basis": "HIDDEN"}],
    "options": {label: label for label in sorted(providers.LABELS)}, "expected": "HIDDEN",
}


def decision(**fields):
    return {"model": MODEL, "answers": {"verdict": {
        "type": "choice", "choice": "supported", "confidence": 0.57,
        "probabilities": {"supported": 0.8, "contradicted": 0.15, "insufficient": 0.05},
    }}, **fields}


class OpenRouterDecisionTest(unittest.TestCase):
    @patch.dict(os.environ, {"OPENROUTER_API_KEY": "test-key"})
    @patch("providers.request.build_opener")
    def test_blinded_request_and_provider_metering(self, opener):
        opened = opener.return_value.open
        opened.return_value = io.BytesIO(json.dumps(decision(usage={
            "input_tokens": 44, "output_tokens": 6, "cost": 0.00012})).encode())
        result = providers.predict("openrouter-decisions", MODEL, PACKET)
        opened.assert_called_once()
        req = opened.call_args.args[0]
        self.assertEqual(req.full_url, "https://openrouter.ai/api/alpha/decisions")
        self.assertEqual(req.get_header("Authorization"), "Bearer test-key")
        self.assertEqual(json.loads(req.data), {"model": MODEL, **providers.public_question(PACKET)})
        self.assertNotIn(b"HIDDEN", req.data)
        self.assertEqual(result["confidence"], 0.8)
        self.assertEqual(result["usage"]["cost_usd"], 0.00012)
        self.assertEqual(result["usage"]["input_tokens"], 44)
        self.assertEqual(result["usage"]["requests"], 1)

    @patch("providers.post_decision")
    def test_choice_without_probabilities_keeps_unknowns(self, post):
        reply = decision()
        del reply["answers"]["verdict"]["probabilities"]
        post.return_value = reply
        result = providers.predict("openrouter-decisions", MODEL, PACKET)
        self.assertIsNone(result["confidence"])
        self.assertNotIn("probabilities", result)
        self.assertNotIn("cost_usd", result["usage"])

    @patch("providers.post_decision")
    def test_invalid_usage_model_and_malformed_distribution(self, post):
        bad_probabilities = decision()
        bad_probabilities["answers"]["verdict"]["probabilities"] = {"supported": 0.8}
        for reply in (decision(model="other/decision-1"), bad_probabilities, decision(usage={"cost": -1}),
                      decision(usage={"input_tokens": True})):
            with self.subTest(reply=reply), self.assertRaises(providers.ProviderError):
                post.return_value = reply
                providers.predict("openrouter-decisions", MODEL, PACKET)

    @patch("providers.request.build_opener")
    def test_missing_credentials_and_unpinned_alias(self, opener):
        with patch.dict(os.environ, {}, clear=True):
            for model in (MODEL, "provider/decision-latest"):
                with self.subTest(model=model), self.assertRaises(providers.ProviderError):
                    providers.predict("openrouter-decisions", model, PACKET)
        opener.assert_not_called()
