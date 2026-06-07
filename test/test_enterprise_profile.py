"""
调用 Kiro ListAvailableProfiles API 获取 Enterprise 账号的真实 profileArn
"""
import requests
import json
import uuid
import hashlib

# 账号信息
ACCESS_TOKEN = "aoaAAAAAGokOp0NC8MveI0iwILsAjYEfC-9p-L7UBQuWLsxEx9X8rnLP_F2g8YmUwKwbovHDLv7-hoAS8N0PiwFXACkc0:MGUCMQCEo7zwmsMXEwrsYcWaeTThVhyp9XNHE1wYYFR0EtqCryy6z1LMfpQn0vR2efNfAG0CMCChCkE6ND97UWe/mgc4tdT1Xjpa38rtBdiQWJWWB42FwFC9/yZgB5RX/wrzUhDsHg"
REGION = "us-east-1"
MACHINE_ID = "32351881-b6b4-4e33-9e31-ba4c16a35f17"

# Kiro Control Plane endpoint
ENDPOINT = f"https://q.{REGION}.amazonaws.com"
LIST_PROFILES_PATH = "/List-Available-Profiles"

# 代理（如需要）
PROXY = "http://127.0.0.1:7890"

def get_profiles():
    url = f"{ENDPOINT}{LIST_PROFILES_PATH}"
    
    machine_hash = hashlib.sha256(MACHINE_ID.encode()).hexdigest()[:16]
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {ACCESS_TOKEN}",
        "x-amz-user-agent": f"KiroIDE/0.12.155 ClientId/{machine_hash}",
        "user-agent": f"KiroIDE/0.12.155 ClientId/{machine_hash} os/windows lang/js md/nodejs",
        "amz-sdk-invocation-id": str(uuid.uuid4()),
        "amz-sdk-request": "attempt=1; max=3",
    }
    
    body = json.dumps({"maxResults": 50})
    
    print(f"URL: {url}")
    print(f"Headers: {json.dumps({k: v[:50]+'...' if len(v) > 50 else v for k, v in headers.items()}, indent=2)}")
    print(f"Body: {body}")
    print()
    
    try:
        resp = requests.post(
            url,
            headers=headers,
            data=body,
            proxies={"https": PROXY, "http": PROXY},
            timeout=15
        )
        print(f"Status: {resp.status_code}")
        print(f"Response: {resp.text[:2000]}")
        
        if resp.status_code == 200:
            data = resp.json()
            profiles = data.get("profiles", [])
            print(f"\n{'='*50}")
            print(f"Found {len(profiles)} profile(s):")
            for p in profiles:
                print(f"  - ARN: {p.get('arn')}")
                print(f"    Name: {p.get('name')}")
                print(f"    Region: {p.get('region', 'N/A')}")
            print(f"{'='*50}")
            if profiles:
                print(f"\n✅ profileArn = {profiles[0].get('arn')}")
        else:
            print(f"\n❌ Failed to get profiles")
            
    except Exception as e:
        print(f"❌ Error: {e}")


if __name__ == "__main__":
    get_profiles()
