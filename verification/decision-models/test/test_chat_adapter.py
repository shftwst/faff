import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import chat_adapter as chat


def envelope():
    return {"protocol": 1, "model": "fixture-v2", "packet": {
        "question": "Which conclusion follows?", "claim": "Output has no trailing spaces.",
        "evidence": [{"id": "e1", "text": "out = x.rstrip()", "oracle": "HIDDEN"}],
        "options": {label: label for label in sorted(chat.LABELS)}, "basis": "HIDDEN",
    }}


def reply(**fields):
    return {"model": "fixture-v2", "choices": [{"finish_reason": "stop", "message": {
        "role": "assistant", "content": '{"label":"supported"}'}}], **fields}


class ChatAdapterTest(unittest.TestCase):
    @patch("chat_adapter.request.build_opener")
    def test_one_post_blind_packet_no_optional_protocol_features(self, opener):
        opened = opener.return_value.open
        opened.return_value = io.BytesIO(json.dumps(reply(usage={
            "prompt_tokens": 9, "completion_tokens": 4})).encode())
        result = chat.classify("https://example.test/v1/chat/completions", envelope(), "fixture-key")
        opened.assert_called_once()
        req = opened.call_args.args[0]
        self.assertEqual(req.method, "POST")
        self.assertEqual(req.get_header("Authorization"), "Bearer fixture-key")
        body = json.loads(req.data)
        self.assertEqual(set(body), {"model", "messages"})
        content = body["messages"][1]["content"]
        self.assertEqual(json.loads(content), chat.public_question(envelope()["packet"]))
        self.assertNotIn("HIDDEN", content)
        self.assertEqual(result["label"], "supported")
        self.assertIsNone(result["confidence"])
        self.assertEqual(result["usage"]["prompt_tokens"], 9)
        self.assertEqual(result["usage"]["completion_tokens"], 4)

    def test_no_usage_and_no_key(self):
        req = chat.make_request("http://[::1]:8080/v1/chat/completions", envelope(), None)
        self.assertNotIn("Authorization", req.headers)
        self.assertEqual(chat.parse(reply(), "fixture-v2")["usage"], {"requests": 1})

    def test_requires_correct_model_and_a_single_completed_decision(self):
        modified = [
            reply(model="other-model"), reply(choices=[]),
            reply(choices=[{"finish_reason": "length", "message": {"content": '{"label":"supported"}'}}]),
            reply(choices=[{"finish_reason": "stop", "message": {"content": '{"label":"unknown"}'}}]),
            reply(usage={"completion_tokens": -1}),
        ]
        for response in modified:
            with self.subTest(response=response), self.assertRaises((ValueError, chat.ProviderError)):
                chat.parse(response, "fixture-v2")

    def test_no_remote_plaintext_credentials_or_redirect(self):
        for endpoint in ("http://example.test/v1", "https://user:key@example.test/v1",
                         "https://example.test/v1?key=private"):
            with self.subTest(endpoint=endpoint), self.assertRaises(ValueError):
                chat.make_request(endpoint, envelope(), "token")
        with self.assertRaises(chat.ProviderError):
            chat.NoRedirect().redirect_request(None, None, 302, "", {}, "https://example.test")
