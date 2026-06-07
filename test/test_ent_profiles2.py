exec(open('test/_enterprise_test.py').read())
import requests, json, uuid

r1 = requests.post('https://oidc.us-east-1.amazonaws.com/token',
    json={'clientId': CI, 'clientSecret': CS, 'grantType': 'refresh_token', 'refreshToken': RT},
    headers={'Content-Type': 'application/json'},
    proxies={'https': 'http://127.0.0.1:7890'}, timeout=15)
at = r1.json()['accessToken']
print('Token OK')

# Try different approaches to ListAvailableProfiles
base_headers = {
    'Content-Type': 'application/json',
    'Authorization': f'Bearer {at}',
    'x-amz-user-agent': 'KiroIDE/0.12.155',
    'user-agent': 'KiroIDE/0.12.155',
    'amz-sdk-invocation-id': str(uuid.uuid4()),
    'amz-sdk-request': 'attempt=1; max=1'
}

# Attempt 1: POST /List-Available-Profiles with empty body
print("\n[1] POST /List-Available-Profiles (empty body)")
r = requests.post('https://q.us-east-1.amazonaws.com/List-Available-Profiles',
    headers=base_headers, data='{}',
    proxies={'https': 'http://127.0.0.1:7890'}, timeout=15)
print(f'    Status: {r.status_code} | {r.text[:200]}')

# Attempt 2: with maxResults
print("\n[2] POST /List-Available-Profiles (maxResults=50)")
r = requests.post('https://q.us-east-1.amazonaws.com/List-Available-Profiles',
    headers=base_headers, data=json.dumps({"maxResults": 50}),
    proxies={'https': 'http://127.0.0.1:7890'}, timeout=15)
print(f'    Status: {r.status_code} | {r.text[:200]}')

# Attempt 3: codewhisperer endpoint
print("\n[3] POST codewhisperer /List-Available-Profiles")
r = requests.post('https://codewhisperer.us-east-1.amazonaws.com/List-Available-Profiles',
    headers=base_headers, data=json.dumps({"maxResults": 50}),
    proxies={'https': 'http://127.0.0.1:7890'}, timeout=15)
print(f'    Status: {r.status_code} | {r.text[:200]}')

# Attempt 4: kiro.dev endpoint
print("\n[4] POST kiro.dev /List-Available-Profiles")
r = requests.post('https://api.kiro.dev/List-Available-Profiles',
    headers=base_headers, data=json.dumps({"maxResults": 50}),
    proxies={'https': 'http://127.0.0.1:7890'}, timeout=15)
print(f'    Status: {r.status_code} | {r.text[:200]}')

# Attempt 5: with x-amzn-kiro-agent-mode header
print("\n[5] POST /List-Available-Profiles + kiro-agent-mode=vibe")
h5 = {**base_headers, 'x-amzn-kiro-agent-mode': 'vibe'}
r = requests.post('https://q.us-east-1.amazonaws.com/List-Available-Profiles',
    headers=h5, data=json.dumps({"maxResults": 50}),
    proxies={'https': 'http://127.0.0.1:7890'}, timeout=15)
print(f'    Status: {r.status_code} | {r.text[:200]}')

# Attempt 6: ListProfiles (without Available)
print("\n[6] POST /ListProfiles")
r = requests.post('https://q.us-east-1.amazonaws.com/ListProfiles',
    headers=base_headers, data=json.dumps({"maxResults": 50}),
    proxies={'https': 'http://127.0.0.1:7890'}, timeout=15)
print(f'    Status: {r.status_code} | {r.text[:200]}')
