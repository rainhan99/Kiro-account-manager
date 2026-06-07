exec(open('test/_enterprise_test.py').read())
import requests, json, uuid

r1 = requests.post('https://oidc.us-east-1.amazonaws.com/token',
    json={'clientId': CI, 'clientSecret': CS, 'grantType': 'refresh_token', 'refreshToken': RT},
    headers={'Content-Type': 'application/json'},
    proxies={'https': 'http://127.0.0.1:7890'}, timeout=15)
at = r1.json()['accessToken']
print('Token OK')

REAL_ARN = 'arn:aws:codewhisperer:us-east-1:610548660232:profile/VNECVYCYYAWN'

# 完整 app headers（含 KiroIDE user-agent）
mid = '7e77db7c'
KV = '0.12.155'; SV = '1.0.34'
ua = f'aws-sdk-js/{SV} ua/2.1 os/win32#10.0.0 lang/js md/nodejs#22.22.0 api/codewhispererstreaming#{SV} m/E KiroIDE-{KV}-{mid}'
amzUa = f'aws-sdk-js/{SV} KiroIDE {KV} {mid}'
H = {
    'Authorization': f'Bearer {at}',
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': ua,
    'x-amz-user-agent': amzUa,
    'x-amzn-codewhisperer-optout': 'true'
}

def show(r):
    if r.status_code == 200:
        return f'200 models:{len(r.json().get("models",[]))}'
    return f'{r.status_code} | {r.text[:120]}'

print("\n[1] q NO profileArn + KiroIDE UA")
r = requests.get('https://q.us-east-1.amazonaws.com/ListAvailableModels?origin=AI_EDITOR&maxResults=50',
    headers=H, proxies={'https': 'http://127.0.0.1:7890'}, timeout=15)
print('   ', show(r))

print("\n[2] q WITH real profileArn + KiroIDE UA")
r = requests.get(f'https://q.us-east-1.amazonaws.com/ListAvailableModels?origin=AI_EDITOR&maxResults=50&profileArn={REAL_ARN}',
    headers=H, proxies={'https': 'http://127.0.0.1:7890'}, timeout=15)
print('   ', show(r))

print("\n[3] codewhisperer WITH real profileArn + KiroIDE UA")
r = requests.get(f'https://codewhisperer.us-east-1.amazonaws.com/ListAvailableModels?origin=AI_EDITOR&maxResults=50&profileArn={REAL_ARN}',
    headers=H, proxies={'https': 'http://127.0.0.1:7890'}, timeout=15)
print('   ', show(r))
