exec(open('test/_enterprise_test.py').read())
import requests, json, uuid

r1 = requests.post('https://oidc.us-east-1.amazonaws.com/token',
    json={'clientId': CI, 'clientSecret': CS, 'grantType': 'refresh_token', 'refreshToken': RT},
    headers={'Content-Type': 'application/json'},
    proxies={'https': 'http://127.0.0.1:7890'}, timeout=15)
at = r1.json()['accessToken']
print('Token OK')

# Test generateAssistantResponse WITHOUT profileArn
payload = {
    "conversationState": {
        "currentMessage": {
            "userInputMessage": {
                "content": "Say hello in one word",
                "userInputMessageContext": {},
                "origin": "AI_EDITOR",
                "modelId": "claude-sonnet-4.6"
            }
        },
        "history": []
    }
    # NO profileArn!
}

r = requests.post('https://q.us-east-1.amazonaws.com/generateAssistantResponse',
    headers={
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {at}',
        'x-amzn-kiro-agent-mode': 'vibe',
        'x-amz-user-agent': 'KiroIDE/0.12.155',
        'user-agent': 'KiroIDE/0.12.155',
        'amz-sdk-invocation-id': str(uuid.uuid4()),
        'amz-sdk-request': 'attempt=1; max=3'
    },
    json=payload,
    proxies={'https': 'http://127.0.0.1:7890'}, timeout=30)

print(f'Generate (no profileArn): {r.status_code}')
if r.status_code == 200:
    print('SUCCESS! Enterprise works without profileArn')
    print(f'Response size: {len(r.content)} bytes')
else:
    print(f'Error: {r.text[:300]}')
