exec(open('test/_enterprise_test.py').read())
import requests, json, uuid

r1 = requests.post('https://oidc.us-east-1.amazonaws.com/token',
    json={'clientId': CI, 'clientSecret': CS, 'grantType': 'refresh_token', 'refreshToken': RT},
    headers={'Content-Type': 'application/json'},
    proxies={'https': 'http://127.0.0.1:7890'}, timeout=15)
at = r1.json()['accessToken']
print('Token OK')

url = 'https://codewhisperer.us-east-1.amazonaws.com/ListAvailableProfiles'

# App 实际发的 user-agent 格式
KIRO_VERSION = '0.12.155'
AWS_SDK_VERSION = '1.0.34'
machineId = '7e77db7c'
ua = f'aws-sdk-js/{AWS_SDK_VERSION} ua/2.1 os/win32#10.0.0 lang/js md/nodejs#22.22.0 api/codewhispererstreaming#{AWS_SDK_VERSION} m/E KiroIDE-{KIRO_VERSION}-{machineId}'
amzUa = f'aws-sdk-js/{AWS_SDK_VERSION} KiroIDE {KIRO_VERSION} {machineId}'

# 测试1: 完整 app headers
print("\n[1] App headers (KiroIDE user-agent)")
r = requests.post(url, headers={
    'Content-Type': 'application/json',
    'Authorization': f'Bearer {at}',
    'x-amz-user-agent': amzUa,
    'user-agent': ua,
    'amz-sdk-invocation-id': str(uuid.uuid4()),
    'amz-sdk-request': 'attempt=1; max=1'
}, data=json.dumps({}), proxies={'https': 'http://127.0.0.1:7890'}, timeout=15)
print(f'    {r.status_code} | {r.text[:200]}')

# 测试2: 最小 headers（之前成功的）
print("\n[2] Minimal headers")
r = requests.post(url, headers={
    'Content-Type': 'application/json',
    'Authorization': f'Bearer {at}',
    'amz-sdk-invocation-id': str(uuid.uuid4()),
    'amz-sdk-request': 'attempt=1; max=1'
}, data=json.dumps({}), proxies={'https': 'http://127.0.0.1:7890'}, timeout=15)
print(f'    {r.status_code} | {r.text[:200]}')

# 测试3: 加 x-amz-target (REST-JSON 可能需要)
print("\n[3] With x-amz-target")
r = requests.post(url, headers={
    'Content-Type': 'application/x-amz-json-1.0',
    'Authorization': f'Bearer {at}',
    'x-amz-target': 'AmazonCodeWhispererService.ListAvailableProfiles',
    'amz-sdk-invocation-id': str(uuid.uuid4()),
    'amz-sdk-request': 'attempt=1; max=1'
}, data=json.dumps({}), proxies={'https': 'http://127.0.0.1:7890'}, timeout=15)
print(f'    {r.status_code} | {r.text[:200]}')
