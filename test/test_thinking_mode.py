"""
测试反代 thinking mode（Claude 4.6+ 模型思考模式）

用法：
  python test/test_thinking_mode.py [--port 18888] [--model claude-sonnet-4.6]

测试项：
  1. OpenAI 格式 + reasoning_effort=high（流式）
  2. OpenAI 格式 + thinking.type=enabled + budget_tokens（流式）
  3. Claude 格式 + thinking.type=enabled（流式）
  4. 不启用 thinking 的基准请求（对比用）
"""

import argparse
import json
import time
import requests

def test_openai_reasoning_effort(base_url: str, model: str, effort: str = "high"):
    """测试 OpenAI 格式 reasoning_effort 参数"""
    print(f"\n{'='*60}")
    print(f"[Test 1] OpenAI + reasoning_effort={effort}, model={model}")
    print(f"{'='*60}")

    payload = {
        "model": model,
        "stream": True,
        "reasoning_effort": effort,
        "thinking": {"type": "enabled", "budget_tokens": 50000},
        "messages": [
            {"role": "user", "content": "What is 15 * 27 + 3? Think step by step."}
        ]
    }

    resp = requests.post(
        f"{base_url}/v1/chat/completions",
        json=payload,
        headers=HEADERS,
        stream=True,
        timeout=60
    )
    print(f"Status: {resp.status_code}")
    if resp.status_code != 200:
        print(f"Error: {resp.text[:500]}")
        return False

    reasoning = ""
    content = ""
    for line in resp.iter_lines(decode_unicode=True):
        if not line or not line.startswith("data: "):
            continue
        data = line[6:]
        if data == "[DONE]":
            break
        try:
            chunk = json.loads(data)
            delta = chunk.get("choices", [{}])[0].get("delta", {})
            if "reasoning_content" in delta and delta["reasoning_content"]:
                reasoning += delta["reasoning_content"]
            if "content" in delta and delta["content"]:
                content += delta["content"]
        except json.JSONDecodeError:
            pass

    print(f"\n--- Reasoning ({len(reasoning)} chars) ---")
    print(reasoning[:500] + ("..." if len(reasoning) > 500 else ""))
    print(f"\n--- Content ({len(content)} chars) ---")
    print(content[:500])

    has_thinking = len(reasoning) > 0
    has_content = len(content) > 0
    print(f"\n✅ Thinking: {'YES' if has_thinking else 'NO'} | Content: {'YES' if has_content else 'NO'}")
    return has_thinking and has_content


def test_openai_budget_tokens(base_url: str, model: str, budget: int = 30000):
    """测试 OpenAI 格式 thinking.budget_tokens 参数"""
    print(f"\n{'='*60}")
    print(f"[Test 2] OpenAI + thinking.budget_tokens={budget}, model={model}")
    print(f"{'='*60}")

    payload = {
        "model": model,
        "stream": True,
        "thinking": {"type": "enabled", "budget_tokens": budget},
        "messages": [
            {"role": "user", "content": "Explain why 0.1 + 0.2 != 0.3 in most programming languages."}
        ]
    }

    resp = requests.post(
        f"{base_url}/v1/chat/completions",
        json=payload,
        headers=HEADERS,
        stream=True,
        timeout=60
    )
    print(f"Status: {resp.status_code}")
    if resp.status_code != 200:
        print(f"Error: {resp.text[:500]}")
        return False

    reasoning = ""
    content = ""
    for line in resp.iter_lines(decode_unicode=True):
        if not line or not line.startswith("data: "):
            continue
        data = line[6:]
        if data == "[DONE]":
            break
        try:
            chunk = json.loads(data)
            delta = chunk.get("choices", [{}])[0].get("delta", {})
            if "reasoning_content" in delta and delta["reasoning_content"]:
                reasoning += delta["reasoning_content"]
            if "content" in delta and delta["content"]:
                content += delta["content"]
        except json.JSONDecodeError:
            pass

    print(f"\n--- Reasoning ({len(reasoning)} chars) ---")
    print(reasoning[:300] + ("..." if len(reasoning) > 300 else ""))
    print(f"\n--- Content ({len(content)} chars) ---")
    print(content[:300])

    has_thinking = len(reasoning) > 0
    has_content = len(content) > 0
    print(f"\n✅ Thinking: {'YES' if has_thinking else 'NO'} | Content: {'YES' if has_content else 'NO'}")
    return has_thinking and has_content


def test_claude_thinking(base_url: str, model: str):
    """测试 Claude 格式 thinking 参数"""
    print(f"\n{'='*60}")
    print(f"[Test 3] Claude /v1/messages + thinking, model={model}")
    print(f"{'='*60}")

    payload = {
        "model": model,
        "max_tokens": 8192,
        "stream": True,
        "thinking": {"type": "enabled", "budget_tokens": 40000},
        "messages": [
            {"role": "user", "content": "Write a Python function to check if a number is prime. Think carefully."}
        ]
    }

    claude_headers = {"Content-Type": "application/json", "anthropic-version": "2023-06-01", **HEADERS}
    resp = requests.post(
        f"{base_url}/v1/messages",
        json=payload,
        headers=claude_headers,
        stream=True,
        timeout=60
    )
    print(f"Status: {resp.status_code}")
    if resp.status_code != 200:
        print(f"Error: {resp.text[:500]}")
        return False

    thinking = ""
    content = ""
    for line in resp.iter_lines(decode_unicode=True):
        if not line or not line.startswith("data: "):
            continue
        data = line[6:]
        try:
            event = json.loads(data)
            if event.get("type") == "content_block_delta":
                delta = event.get("delta", {})
                if delta.get("type") == "thinking_delta":
                    thinking += delta.get("thinking", "")
                elif delta.get("type") == "text_delta":
                    content += delta.get("text", "")
        except json.JSONDecodeError:
            pass

    print(f"\n--- Thinking ({len(thinking)} chars) ---")
    print(thinking[:300] + ("..." if len(thinking) > 300 else ""))
    print(f"\n--- Content ({len(content)} chars) ---")
    print(content[:300])

    has_thinking = len(thinking) > 0
    has_content = len(content) > 0
    print(f"\n✅ Thinking: {'YES' if has_thinking else 'NO'} | Content: {'YES' if has_content else 'NO'}")
    return has_thinking and has_content


def test_no_thinking(base_url: str, model: str):
    """基准：不启用 thinking 的请求"""
    print(f"\n{'='*60}")
    print(f"[Test 4] Baseline (no thinking), model={model}")
    print(f"{'='*60}")

    payload = {
        "model": model,
        "stream": True,
        "messages": [
            {"role": "user", "content": "Say hello in one sentence."}
        ]
    }

    resp = requests.post(
        f"{base_url}/v1/chat/completions",
        json=payload,
        headers=HEADERS,
        stream=True,
        timeout=30
    )
    print(f"Status: {resp.status_code}")
    if resp.status_code != 200:
        print(f"Error: {resp.text[:500]}")
        return False

    reasoning = ""
    content = ""
    for line in resp.iter_lines(decode_unicode=True):
        if not line or not line.startswith("data: "):
            continue
        data = line[6:]
        if data == "[DONE]":
            break
        try:
            chunk = json.loads(data)
            delta = chunk.get("choices", [{}])[0].get("delta", {})
            if "reasoning_content" in delta and delta["reasoning_content"]:
                reasoning += delta["reasoning_content"]
            if "content" in delta and delta["content"]:
                content += delta["content"]
        except json.JSONDecodeError:
            pass

    print(f"\n--- Content ({len(content)} chars) ---")
    print(content[:200])
    no_thinking = len(reasoning) == 0
    has_content = len(content) > 0
    print(f"\n✅ No reasoning: {'YES' if no_thinking else 'NO (unexpected!)'} | Content: {'YES' if has_content else 'NO'}")
    return no_thinking and has_content


def test_models_list(base_url: str, model: str):
    """检查模型列表中 thinking 字段是否正确"""
    print(f"\n{'='*60}")
    print(f"[Test 0] Check /v1/models thinking fields")
    print(f"{'='*60}")

    resp = requests.get(f"{base_url}/v1/models", headers=HEADERS, timeout=15)
    if resp.status_code != 200:
        print(f"Error: {resp.status_code} {resp.text[:300]}")
        return False

    models = resp.json().get("data", [])
    target = None
    for m in models:
        if m["id"].lower() == model.lower():
            target = m
            break

    if not target:
        print(f"Model {model} not found in list. Available: {[m['id'] for m in models[:10]]}")
        # 尝试模糊匹配
        for m in models:
            if "sonnet" in m["id"].lower() and "4" in m["id"]:
                target = m
                print(f"Using fuzzy match: {m['id']}")
                break

    if target:
        print(f"Model: {target['id']}")
        print(f"  supportsThinking: {target.get('supportsThinking')}")
        print(f"  thinkingEfforts:  {target.get('thinkingEfforts')}")
        print(f"  thinkingSchemaPath: {target.get('thinkingSchemaPath')}")
        ok = target.get("supportsThinking") == True and target.get("thinkingSchemaPath") is not None
        print(f"\n✅ Thinking metadata: {'CORRECT' if ok else 'MISSING'}")
        return ok
    else:
        print("No matching model found")
        return False


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test thinking mode via reverse proxy")
    parser.add_argument("--port", type=int, default=18888, help="Proxy port")
    parser.add_argument("--host", default="127.0.0.1", help="Proxy host")
    parser.add_argument("--model", default="claude-sonnet-4.6", help="Model to test")
    parser.add_argument("--api-key", default="", help="API key for proxy auth")
    parser.add_argument("--only", type=int, help="Run only test N (0-4)")
    args = parser.parse_args()

    base = f"http://{args.host}:{args.port}"
    HEADERS = {}
    if args.api_key:
        HEADERS["Authorization"] = f"Bearer {args.api_key}"
    print(f"🔗 Proxy: {base}")
    print(f"🤖 Model: {args.model}")

    tests = [
        ("Model metadata", lambda: test_models_list(base, args.model)),
        ("OpenAI reasoning_effort", lambda: test_openai_reasoning_effort(base, args.model, "high")),
        ("OpenAI budget_tokens", lambda: test_openai_budget_tokens(base, args.model, 30000)),
        ("Claude thinking", lambda: test_claude_thinking(base, args.model)),
        ("Baseline (no thinking)", lambda: test_no_thinking(base, args.model)),
    ]

    results = []
    for i, (name, fn) in enumerate(tests):
        if args.only is not None and args.only != i:
            continue
        t0 = time.time()
        try:
            ok = fn()
        except Exception as e:
            print(f"\n❌ Exception: {e}")
            ok = False
        elapsed = time.time() - t0
        results.append((name, ok, elapsed))

    print(f"\n\n{'='*60}")
    print("SUMMARY")
    print(f"{'='*60}")
    for name, ok, elapsed in results:
        status = "✅ PASS" if ok else "❌ FAIL"
        print(f"  {status}  {name}  ({elapsed:.1f}s)")
