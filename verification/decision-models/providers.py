"""Built-in blind-inference adapters. Only fields from the public packet go on the wire."""

import json
import math
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
from urllib import error, request

JEV_MODEL = "jev-1.14.0"
OPUS_MODEL = "claude-opus-5-5"
JEV_URL = "https://api.typesafe.ai/v1/systemone"
LABELS = {"supported", "contradicted", "insufficient"}
TOKEN_KEYS = ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")


class ProviderError(RuntimeError):
    """Message safe to record without exposing prompts or authentication data."""


def public_question(packet):
    if set(packet["options"]) != LABELS:
        raise ValueError("Expected all three evidence choices")
    state = {
        "claim": packet["claim"],
        "evidence": [{"id": row["id"], "text": row["text"]} for row in packet["evidence"]],
    }
    return {
        "state": json.dumps(state, ensure_ascii=False, separators=(",", ":")),
        "questions": {"verdict": {
            "type": "choice", "instructions": packet["question"], "criteria": packet["options"],
        }},
    }


def token_counts(usage):
    if not isinstance(usage, dict) or not {"input_tokens", "output_tokens"}.issubset(usage):
        raise ValueError("Missing token counters")
    counts = {}
    for key in TOKEN_KEYS:
        if key in usage:
            value = usage[key]
            if type(value) is not int or value < 0:
                raise ValueError("Invalid token counter")
            counts[key] = value
    return counts


def choice_probabilities(answer):
    label = answer["choice"]
    probabilities = answer["probabilities"]
    if answer["type"] != "choice" or label not in LABELS or set(probabilities) != LABELS:
        raise ValueError("Incomplete choice")
    if any(type(p) not in (int, float) or not 0 <= p <= 1 for p in probabilities.values()):
        raise ValueError("Invalid probabilities")
    if not math.isclose(sum(probabilities.values()), 1, abs_tol=0.001):
        raise ValueError("Invalid probability total")
    if probabilities[label] != max(probabilities.values()):
        raise ValueError("Choice and probabilities disagree")
    return probabilities


def parse_jev(reply, model):
    if reply["model"] != model:
        raise ProviderError("TypeSafe returned a different model")
    answer = reply["answers"]["verdict"]
    label = answer["choice"]
    probabilities = choice_probabilities(answer)
    provider_confidence = answer["confidence"]
    if type(provider_confidence) not in (int, float) or not 0 <= provider_confidence <= 1:
        raise ValueError("Invalid TypeSafe confidence")
    return {
        "label": label, "confidence": probabilities[label], "probabilities": probabilities,
        "provider_confidence": provider_confidence, "model": model,
        "usage": {**token_counts(reply["usage"]), "requests": 1},
    }


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise ProviderError("Endpoint redirected the request")


def post_decision(url, key_name, provider, model, question):
    key = os.environ.get(key_name)
    if not key:
        raise ProviderError(f"Set {key_name} for {provider}")
    req = request.Request(
        url, method="POST", data=json.dumps({"model": model, **question}).encode(),
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
    )
    try:
        with request.build_opener(NoRedirect).open(req, timeout=90) as response:
            return json.load(response)
    except error.HTTPError as failure:
        raise ProviderError(f"{provider} returned HTTP {failure.code}") from None
    except (OSError, error.URLError):
        raise ProviderError(f"{provider} request failed or timed out") from None


def jev_call(model, question):
    if not re.fullmatch(r"jev-\d+\.\d+\.\d+", model):
        raise ValueError("Use a versioned TypeSafe model such as jev-1.14.0")
    reply = post_decision(JEV_URL, "TYPESAFE_API_KEY", "TypeSafe", model, question)
    return parse_jev(reply, model)


def openrouter_decision(model, question):
    if not re.fullmatch(r"[a-z0-9.-]+/[a-z0-9._-]+", model) or model.endswith(("-latest", "/latest")):
        raise ValueError("Use a canonical decision model ID")
    reply = post_decision("https://openrouter.ai/api/alpha/decisions", "OPENROUTER_API_KEY",
                          "OpenRouter", model, question)
    if reply["model"] != model:
        raise ProviderError("OpenRouter returned a different model")
    answer = reply["answers"]["verdict"]
    if answer["type"] != "choice" or answer["choice"] not in LABELS:
        raise ValueError("Invalid decision")
    usage = {"requests": 1}
    metering = reply.get("usage") or {}
    for field in ("input_tokens", "output_tokens"):
        if field in metering:
            value = metering[field]
            if type(value) is not int or value < 0:
                raise ValueError("Invalid token count")
            usage[field] = value
    if "cost" in metering:
        value = metering["cost"]
        if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
            raise ValueError("Invalid cost")
        usage["cost_usd"] = value
    label = answer["choice"]
    result = {"model": model, "label": label, "confidence": None, "usage": usage}
    if answer.get("probabilities") is not None:
        probabilities = choice_probabilities(answer)
        result.update(probabilities=probabilities, confidence=probabilities[label])
    return result


def parse_opus(reply, model):
    if reply.get("is_error") or reply["subtype"] != "success":
        raise ProviderError("Claude Code returned an unsuccessful result")
    if set(reply["modelUsage"]) != {model}:
        raise ProviderError("Claude Code returned a different or additional model")
    if reply["num_turns"] != 1:
        raise ProviderError("Claude Code did not finish in a single turn")
    label = reply["result"].strip()
    if label not in LABELS:
        raise ValueError("Claude Code returned an invalid label")
    return {
        "label": label, "confidence": None, "model": model,
        "usage": {**token_counts(reply["usage"]), "turns": 1},
    }


def opus_call(model, question):
    if not re.fullmatch(r"claude-opus-\d+-\d+(?:-\d{8})?", model):
        raise ValueError("Use a versioned Opus model such as claude-opus-5-5")
    token = os.environ.get("CLAUDE_CODE_OAUTH_TOKEN")
    if not token:
        raise ProviderError("Run in the subscription worker with CLAUDE_CODE_OAUTH_TOKEN")
    args = [
        os.environ.get("CLAUDE_BIN", "claude"), "-p", "--safe-mode",
        "--no-session-persistence", "--strict-mcp-config", "--tools", "",
        "--output-format", "json", "--model", model, "--effort", "medium",
        "--system-prompt", "Answer the supplied Choice question using only the state. Return exactly one option name.",
    ]
    with tempfile.TemporaryDirectory(prefix="decision-model-") as scratch:
        env = {k: os.environ[k] for k in ("PATH", "HOME", "USER", "LANG", "TMPDIR", "SSL_CERT_FILE",
                                            "NODE_EXTRA_CA_CERTS") if k in os.environ}
        env.update(CLAUDE_CODE_OAUTH_TOKEN=token, CLAUDE_CONFIG_DIR=str(Path(scratch) / "claude"),
                   CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1", DISABLE_NON_ESSENTIAL_MODEL_CALLS="1")
        try:
            result = subprocess.run(
                args, cwd=scratch, env=env, input=json.dumps(question, ensure_ascii=False),
                capture_output=True, text=True, timeout=180, check=False,
            )
        except FileNotFoundError:
            raise ProviderError("Claude Code executable missing; set CLAUDE_BIN or use the subscription worker") from None
        except subprocess.TimeoutExpired:
            raise ProviderError("Claude Code timed out") from None
    if result.returncode:
        raise ProviderError(f"Claude Code exited with status {result.returncode}")
    return parse_opus(json.loads(result.stdout), model)


def predict(provider, model, packet):
    question = public_question(packet)
    call = {"jev": jev_call, "opus": opus_call, "openrouter-decisions": openrouter_decision}[provider]
    started = time.monotonic()
    try:
        result = call(model, question)
    except (KeyError, TypeError, ValueError, AttributeError):
        raise ProviderError("Invalid provider model, usage or response format") from None
    result["usage"]["latency_ms"] = round(1000 * (time.monotonic() - started))
    return result
