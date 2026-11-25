import copy
import io
import json
import os
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest
from unittest.mock import patch
from urllib import error

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import providers


PACKET = {
    "claim": "The retry keeps the issue owner.",
    "evidence": [{"id": "e1", "text": "observed output", "grader": "hidden grader"}],
    "question": "Which conclusion follows from the evidence?",
    "options": {"supported": "evidence confirms it", "contradicted": "evidence refutes it",
                "insufficient": "evidence does not decide"},
    "expected": "hidden answer", "basis": "hidden oracle",
}


def jev_reply():
    return {
        "model": providers.JEV_MODEL, "usage": {"input_tokens": 357, "output_tokens": 38},
        "answers": {"verdict": {"type": "choice", "choice": "supported", "confidence": 0.91,
                                "probabilities": {"supported": 0.85, "insufficient": 0.1, "contradicted": 0.05}}},
    }


def opus_reply():
    return {"subtype": "success", "is_error": False, "modelUsage": {providers.OPUS_MODEL: {}},
            "result": "contradicted", "num_turns": 1,
            "usage": {"input_tokens": 9, "output_tokens": 1, "cache_read_input_tokens": 0,
                      "cache_creation_input_tokens": 0}}


class ProvidersTest(unittest.TestCase):
    @patch.dict(os.environ, {"TYPESAFE_API_KEY": "stub-token"})
    @patch("providers.request.build_opener")
    def test_jev_uses_typed_question_and_winning_probability(self, opener):
        opened = opener.return_value.open
        opened.return_value = io.BytesIO(json.dumps(jev_reply()).encode())
        prediction = providers.predict("jev", providers.JEV_MODEL, PACKET)
        req = opened.call_args.args[0]
        payload = json.loads(req.data)
        self.assertEqual(req.full_url, "https://api.typesafe.ai/v1/systemone")
        self.assertEqual(req.get_header("Authorization"), "Bearer stub-token")
        self.assertEqual(payload["questions"]["verdict"]["criteria"], PACKET["options"])
        self.assertNotIn("hidden", req.data.decode())
        self.assertEqual(prediction["label"], "supported")
        self.assertEqual(prediction["confidence"], 0.85)
        self.assertEqual(prediction["provider_confidence"], 0.91)
        self.assertEqual(prediction["usage"]["requests"], 1)
        self.assertEqual(prediction["usage"]["input_tokens"], 357)
        self.assertNotIn("cache_read_input_tokens", prediction["usage"])

    @patch.dict(os.environ, {"CLAUDE_CODE_OAUTH_TOKEN": "stub-token", "ANTHROPIC_API_KEY": "other-key"})
    @patch("providers.subprocess.run")
    def test_toolless_opus_fresh_directory_and_equivalent_question(self, run):
        run.return_value = SimpleNamespace(stdout=json.dumps(opus_reply()), returncode=0)
        prediction = providers.predict("opus", providers.OPUS_MODEL, PACKET)
        args, kwargs = run.call_args
        args = args[0]
        self.assertEqual(args[args.index("--tools") + 1], "")
        self.assertIn("--safe-mode", args)
        self.assertIn("--no-session-persistence", args)
        self.assertEqual(kwargs["env"]["CLAUDE_CODE_OAUTH_TOKEN"], "stub-token")
        self.assertNotIn("ANTHROPIC_API_KEY", kwargs["env"])
        self.assertEqual(json.loads(kwargs["input"]), providers.public_question(PACKET))
        self.assertNotIn("hidden", kwargs["input"])
        self.assertFalse(Path(kwargs["cwd"]).exists())
        self.assertIsNone(prediction["confidence"])
        self.assertEqual(prediction["usage"]["turns"], 1)

    @patch.dict(os.environ, {"TYPESAFE_API_KEY": "one-secret"})
    @patch("providers.request.build_opener")
    def test_http_failure_omits_provider_echo_and_token(self, opener):
        opener.return_value.open.side_effect = error.HTTPError(
            providers.JEV_URL, 403, "one-secret", {}, io.BytesIO(b"private prompt")
        )
        with self.assertRaisesRegex(providers.ProviderError, "^TypeSafe returned HTTP 403$"):
            providers.predict("jev", providers.JEV_MODEL, PACKET)
        opener.return_value.open.assert_called_once()

    def test_incomplete_or_inconsistent_probabilities_refused(self):
        distributions = [
            {"supported": 1},
            {"supported": 0.1, "contradicted": 0.8, "insufficient": 0.1},
            {"supported": 0.5, "contradicted": 0.5, "insufficient": 0.5},
            {"supported": float("nan"), "contradicted": 0.0, "insufficient": 0.0},
        ]
        for probabilities in distributions:
            reply = jev_reply()
            reply["answers"]["verdict"]["probabilities"] = probabilities
            with self.subTest(probabilities=probabilities), self.assertRaises(ValueError):
                providers.parse_jev(reply, providers.JEV_MODEL)

    def test_changed_model_or_output_refused(self):
        with self.assertRaises(providers.ProviderError):
            providers.parse_jev(jev_reply(), "jev-1.13.0")
        changes = [{"modelUsage": {"another-model": {}}}, {"result": "Here is my reasoning"},
                   {"num_turns": 2}, {"is_error": True}]
        for change in changes:
            with self.subTest(change=change), self.assertRaises((ValueError, providers.ProviderError)):
                providers.parse_opus({**opus_reply(), **change}, providers.OPUS_MODEL)

    def test_reject_aliases_and_missing_credentials_without_dispatch(self):
        with patch.dict(os.environ, {}, clear=True):
            for provider, model in (("jev", "jev-latest"), ("jev", providers.JEV_MODEL),
                                    ("opus", "opus"), ("opus", providers.OPUS_MODEL)):
                with self.subTest(provider=provider, model=model), self.assertRaises(providers.ProviderError):
                    providers.predict(provider, model, PACKET)

    def test_invalid_rubric_refused_before_dispatch(self):
        packet = copy.deepcopy(PACKET)
        del packet["options"]["insufficient"]
        with self.assertRaises(ValueError):
            providers.predict("jev", providers.JEV_MODEL, packet)


if __name__ == "__main__":
    unittest.main()
