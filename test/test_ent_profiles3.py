exec(open('test/_enterprise_test.py').read())
import requests, json, uuid

r1 = requests.post('https://oidc.us-east-1.amazonaws.com/token',
    json={'clientId': CI, 'clientSecret': CS, 'grantType': 'refresh_token', 'refreshToken': RT},
    headers={'Content-Type': 'application/json'},
    proxies={'https': 'http://127.0.0.1:7890'}, timeout=15)
at = r1.json()['accessToken']
print('Token OK')

headers = {
    'Content-Type': 'application/json',
    'Authorization': f'Bearer {at}',
    'x-amz-user-agent': 'KiroIDE/0.12.155',
    'user-agent': 'KiroIDE/0.12.155',
    'amz-sdk-invocation-id': str(uuid.uuid4()),
    'amz-sdk-request': 'attempt=1; max=1'
}

# 用 codewhisperer runtime client 的端点
print("\n[1] POST codewhisperer /listAvailableProfiles (lowercase)")
r = requests.post('https://codewhisperer.us-east-1.amazonaws.com/listAvailableProfiles',
    headers=headers, data=json.dumps({}),
    proxies={'https': 'http://127.0.0.1:7890'}, timeout=15)
print(f'    Status: {r.status_code} | {r.text[:500]}')

if r.status_code == 200:
    profiles = r.json().get('profiles', [])
    print(f'\n    Found {len(profiles)} profiles:')
    for p in profiles:
        print(f'      ARN: {p.get("arn")}')
        print(f'      Name: {p.get("profileName", p.get("name", "?"))}')
