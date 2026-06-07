import requests, json

r = requests.post(
    'http://127.0.0.1:5580/v1/chat/completions',
    json={
        'model': 'claude-sonnet-4.6',
        'stream': True,
        'reasoning_effort': 'max',
        'thinking': {'type': 'enabled', 'budget_tokens': 100000},
        'messages': [{'role': 'user', 'content': 'Prove that there are infinitely many prime numbers. Give a rigorous mathematical proof.'}]
    },
    headers={'Authorization': 'Bearer sk-3e93sqp358onv2rcb3wc4btqoy2eu7kb4fpyouea02hou3y4'},
    stream=True,
    timeout=120
)

print(f"Status: {r.status_code}")
reasoning = ''
content = ''
for line in r.iter_lines(decode_unicode=True):
    if not line or not line.startswith('data: '):
        continue
    d = line[6:]
    if d == '[DONE]':
        break
    try:
        c = json.loads(d)
        delta = c.get('choices', [{}])[0].get('delta', {})
        if delta.get('reasoning_content'):
            reasoning += delta['reasoning_content']
        if delta.get('content'):
            content += delta['content']
    except:
        pass

print(f"Reasoning: {len(reasoning)} chars")
print(f"Content: {len(content)} chars")
if reasoning:
    print(f"--- Reasoning preview ---")
    print(reasoning[:300])
else:
    print("NO REASONING RETURNED")
print(f"--- Content preview ---")
print(content[:200])
