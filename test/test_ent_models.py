exec(open('test/_enterprise_test.py').read())
import requests, json, uuid

r1 = requests.post('https://oidc.us-east-1.amazonaws.com/token',
    json={'clientId': CI, 'clientSecret': CS, 'grantType': 'refresh_token', 'refreshToken': RT},
    headers={'Content-Type': 'application/json'},
    proxies={'https': 'http://127.0.0.1:7890'}, timeout=15)
at = r1.json()['accessToken']
print('Token OK')

# Test ListAvailableModels WITHOUT profileArn
r3 = requests.get('https://q.us-east-1.amazonaws.com/ListAvailableModels?origin=AI_EDITOR&maxResults=50',
    headers={
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {at}',
        'x-amz-user-agent': 'KiroIDE/0.12.155',
        'user-agent': 'KiroIDE/0.12.155',
        'amz-sdk-invocation-id': str(uuid.uuid4()),
        'amz-sdk-request': 'attempt=1; max=1'
    },
    proxies={'https': 'http://127.0.0.1:7890'}, timeout=15)

print(f'Models (no profileArn): {r3.status_code}')
if r3.status_code == 200:
    d = r3.json()
    models = d.get('models', [])
    print(f'Count: {len(models)}')
    for m in models[:5]:
        print(f'  {m["modelId"]}')
else:
    print(f'Error: {r3.text[:300]}')
