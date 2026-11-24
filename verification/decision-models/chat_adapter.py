"""Single-request external adapter for a configured Chat Completions endpoint."""

import argparse
import ipaddress
import json
import os
import sys
import time
from urllib import error, request
from urllib.parse import urlsplit

from providers import LABELS, NoRedirect, ProviderError, public_question


def validate_endpoint(endpoint):
    url = urlsplit(endpoint)
    host = url.hostname
    if not host or url.username is not None or url.password is not None or url.fragment or url.query:
        raise ValueError("Use a complete endpoint URL without credentials, query or fragment")
    local = host.lower() == "localhost"
    try:
        local = local or ipaddress.ip_address(host).is_loopback
    except ValueError:
        pass
    if url.scheme != "https" and not (local and url.scheme == "http"):
        raise ValueError("Use HTTPS for remote endpoints or HTTP for loopback")


def make_request(endpoint, envelope, key):
    validate_endpoint(endpoint)
    if type(envelope["protocol"]) is not int or envelope["protocol"] != 1:
        raise ValueError("Unknown suite protocol")
    model = envelope["model"]
    if not isinstance(model, str) or not model.strip() or model.lower().endswith(("latest", ":latest")):
        raise ValueError("Use an explicit model or deployment version")
    question = public_question(envelope["packet"])
    messages = [
        {"role": "system", "content": 'Answer the supplied Choice question using only the state. '
                                      'Return exactly one JSON object with the option name in the "label" field.'},
        {"role": "user", "content": json.dumps(question, ensure_ascii=False)},
    ]
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = "Bearer " + key
    payload = {"model": model, "messages": messages}
    return request.Request(endpoint, method="POST", headers=headers, data=json.dumps(payload).encode())


def parse(reply, model):
    if reply["model"] != model:
        raise ProviderError("Chat Completions returned a different model")
    choices = reply["choices"]
    if len(choices) != 1 or choices[0]["finish_reason"] != "stop":
        raise ProviderError("Expected one completed Chat Completions choice")
    message = choices[0]["message"]
    if message.get("tool_calls") or message.get("function_call") or message.get("refusal"):
        raise ProviderError("Chat Completions did not return a decision")
    answer = json.loads(message["content"])
    if not isinstance(answer, dict) or set(answer) != {"label"} or answer["label"] not in LABELS:
        raise ValueError("Invalid decision from Chat Completions")
    usage = {"requests": 1}
    native = reply.get("usage") or {}
    for field in ("prompt_tokens", "completion_tokens"):
        if field in native:
            n = native[field]
            if type(n) is not int or n < 0:
                raise ValueError("Invalid usage counter")
            usage[field] = n
    return {"label": answer["label"], "model": model, "confidence": None, "usage": usage}


def classify(endpoint, envelope, key=None):
    req = make_request(endpoint, envelope, key)
    start = time.monotonic()
    with request.build_opener(NoRedirect).open(req, timeout=90) as response:
        answer = parse(json.load(response), envelope["model"])
    answer["usage"]["latency_ms"] = round(1000 * (time.monotonic() - start))
    return answer


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--endpoint", required=True, help="Full chat/completions URL")
    args = parser.parse_args()
    try:
        result = classify(args.endpoint, json.load(sys.stdin), os.environ.get("DECISION_CHAT_API_KEY"))
    except error.HTTPError as failure:
        sys.exit(f"Chat Completions returned HTTP {failure.code}")
    except (OSError, ValueError, TypeError, KeyError, AttributeError, ProviderError) as failure:
        sys.exit(f"Chat adapter failed ({type(failure).__name__})")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
