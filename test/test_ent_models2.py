exec(open('test/_enterprise_test.py').read())
import requests, json, uuid

r1 = requests.post('https://oidc.us-east-1.amazonaws.com/token',
    json={'clientId': CI, 'clientSecret': CS, 'grantType': 'refresh_token', 'refreshToken': RT},
    headers={'Content-Type': 'application/json'},
    proxies={'https': 'http://127.0.0.1:7890'}, timeout=15)
at = r1.json()['accessToken']
print('Token OK')

REAL_ARN = 'arn:aws:codewhisperer:us-east-1:610548660232:profile/VNECVYCYYAWN'
H = {
    'Authorization': f'Bearer {at}',
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'x-amzn-codewhisperer-optout': 'true'
}

# 1. q endpoint, no profileArn
print("\n[1] q.us-east-1 NO profileArn")
r = requests.get('https://q.us-east-1.amazonaws.com/ListAvailableModels?origin=AI_EDITOR&maxResults=50',
    headers=H, proxies={'https': 'http://127.0.0.1:7890'}, timeout=15)
print(f'    {r.status_code} | {r.text[:150]}')

# 2. q endpoint, REAL profileArn
print("\n[2] q.us-east-1 WITH real profileArn")
r = requests.get(f'https://q.us-east-1.amazonaws.com/ListAvailableModels?origin=AI_EDITOR&maxResults=50&profileArn={REAL_ARN}',
    headers=H, proxies={'https': 'http://127.0.0.1:7890'}, timeout=15)
print(f'    {r.status_code} | {"models:" + str(len(r.json().get("models",[]))) if r.status_code==200 else r.text[:150]}')

# 3. codewhisperer endpoint, REAL profileArn
print("\n[3] codewhisperer.us-east-1 WITH real profileArn")
r = requests.get(f'https://codewhisperer.us-east-1.amazonaws.com/ListAvailableModels?origin=AI_EDITOR&maxResults=50&profileArn={REAL_ARN}',
    headers=H, proxies={'https': 'http://127.0.0.1:7890'}, timeout=15)
print(f'    {r.status_code} | {"models:" + str(len(r.json().get("models",[]))) if r.status_code==200 else r.text[:150]}')
