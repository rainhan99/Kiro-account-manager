"""
刷新 Enterprise 账号 token 后获取 profileArn
"""
import requests
import json
import uuid
import hashlib

# 账号信息
REFRESH_TOKEN = "aorAAAAAGqawtUiAVvOuOoZiEsNStSUpX4qG7RIGn5YEcM-Nj3mBC50p8SAqCCY4lbr_k65ducj4TACUJhfs-UNgYCkc0:MGUCMARqssqTybVi0rbEBEk3+vt6zZ7N9XN38FpdiBy0e7vnTuVH45CLzblG3l8E7hZrpAIxALkhlf528dRJxmGiN4vzEXoa2cy2gAvaGIgdVWJgek4B0uEAwoYXqCqwqNGI404wGg"
CLIENT_ID = "0ldnK0xmrGHmpAdraJJAH3VzLWVhc3QtMQ"
REGION = "us-east-1"
MACHINE_ID = "32351881-b6b4-4e33-9e31-ba4c16a35f17"
START_URL = "https://d-9066713dd7.awsapps.com/start/"

PROXY = "http://127.0.0.1:7890"

OIDC_ENDPOINT = f"https://oidc.{REGION}.amazonaws.com"

CLIENT_SECRET = "eyJraWQiOiJrZXktMTU2NDAyODA5OSIsImFsZyI6IkhTMzg0In0.eyJzZXJpYWxpemVkIjoie1wiY2xpZW50SWRcIjp7XCJ2YWx1ZVwiOlwiMGxkbksweG1yR0htcEFkcmFKSkFIM1Z6TFdWaGMzUXRNUVwifSxcImlkZW1wb3RlbnRLZXlcIjpudWxsLFwidGVuYW50SWRcIjpudWxsLFwiY2xpZW50TmFtZVwiOlwiS2lybyBJREVcIixcImJhY2tmaWxsVmVyc2lvblwiOm51bGwsXCJjbGllbnRUeXBlXCI6XCJQVUJMSUNcIixcInRlbXBsYXRlQXJuXCI6bnVsbCxcInRlbXBsYXRlQ29udGV4dFwiOm51bGwsXCJleHBpcmF0aW9uVGltZXN0YW1wXCI6MTc4ODUyNzI1Ny41OTg3MTAzNTEsXCJjcmVhdGVkVGltZXN0YW1wXCI6MTc4MDc1MTI1Ny41OTg3MTAzNTEsXCJ1cGRhdGVkVGltZXN0YW1wXCI6MTc4MDc1MTI1Ny41OTg3MTAzNTEsXCJjcmVhdGVkQnlcIjpudWxsLFwidXBkYXRlZEJ5XCI6bnVsbCxcInN0YXR1c1wiOm51bGwsXCJpbml0aWF0ZUxvZ2luVXJpXCI6XCJodHRwczovL2QtOTA2NjcxM2RkNy5hd3NhcHBzLmNvbS9zdGFydC9cIixcImVudGl0bGVkUmVzb3VyY2VJZFwiOm51bGwsXCJlbnRpdGxlZFJlc291cmNlQ29udGFpbmVySWRcIjpudWxsLFwiZXh0ZXJuYWxJZFwiOm51bGwsXCJzb2Z0d2FyZUlkXCI6bnVsbCxcInNjb3Blc1wiOlt7XCJmdWxsU2NvcGVcIjpcImNvZGV3aGlzcGVyZXI6Y29tcGxldGlvbnNcIixcInN0YXR1c1wiOlwiSU5JVElBTFwiLFwiYXBwbGljYXRpb25Bcm5cIjpudWxsLFwidXNlQ2FzZUFjdGlvblwiOlwiY29tcGxldGlvbnNcIixcImZyaWVuZGx5SWRcIjpcImNvZGV3aGlzcGVyZXJcIixcInR5cGVcIjpcIkltbXV0YWJsZUFjY2Vzc1Njb3BlXCIsXCJzY29wZVR5cGVcIjpcIkFDQ0VTU19TQ09QRVwifV19In0.kdrPjvTsO4gLmPLzYnxp1xqxmQIVbomZKrTMDTlrw7JiB-uMNKiYDlhF4R3UZ8H0"

def refresh_token():
    """Step 1: 刷新 token"""
    url = f"{OIDC_ENDPOINT}/token"
    body = {
        "clientId": CLIENT_ID,
        "clientSecret": CLIENT_SECRET,
        "grantType": "refresh_token",
        "refreshToken": REFRESH_TOKEN
    }
    
    headers = {
        "Content-Type": "application/json",
        "x-amz-user-agent": "KiroIDE/0.12.155",
        "user-agent": "KiroIDE/0.12.155"
    }
    
    print("[1] Refreshing token...")
    resp = requests.post(url, json=body, headers=headers, proxies={"https": PROXY}, timeout=15)
    print(f"    Status: {resp.status_code}")
    
    if resp.status_code != 200:
        print(f"    Error: {resp.text[:500]}")
        return None
    
    data = resp.json()
    access_token = data.get("accessToken")
    new_refresh = data.get("refreshToken")
    expires_in = data.get("expiresIn")
    print(f"    accessToken: {access_token[:50]}...")
    print(f"    expiresIn: {expires_in}s")
    print(f"    newRefreshToken: {'yes' if new_refresh else 'no'}")
    return access_token


def get_profiles(access_token):
    """Step 2: 获取 profiles"""
    url = f"https://q.{REGION}.amazonaws.com/List-Available-Profiles"
    
    machine_hash = hashlib.sha256(MACHINE_ID.encode()).hexdigest()[:16]
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {access_token}",
        "x-amz-user-agent": f"KiroIDE/0.12.155 ClientId/{machine_hash}",
        "user-agent": f"KiroIDE/0.12.155 ClientId/{machine_hash} os/windows lang/js md/nodejs",
        "amz-sdk-invocation-id": str(uuid.uuid4()),
        "amz-sdk-request": "attempt=1; max=3",
    }
    
    body = json.dumps({"maxResults": 50})
    
    print(f"\n[2] Fetching profiles...")
    resp = requests.post(url, headers=headers, data=body, proxies={"https": PROXY}, timeout=15)
    print(f"    Status: {resp.status_code}")
    
    if resp.status_code == 200:
        data = resp.json()
        profiles = data.get("profiles", [])
        print(f"    Found {len(profiles)} profile(s):")
        for p in profiles:
            print(f"      - ARN: {p.get('arn')}")
            print(f"        Name: {p.get('name')}")
        if profiles:
            print(f"\n✅ profileArn = {profiles[0].get('arn')}")
            return profiles[0].get('arn')
    else:
        print(f"    Error: {resp.text[:500]}")
    return None


def test_generate(access_token, profile_arn):
    """Step 3: 测试调用 generateAssistantResponse"""
    url = "https://q.us-east-1.amazonaws.com/generateAssistantResponse"
    
    machine_hash = hashlib.sha256(MACHINE_ID.encode()).hexdigest()[:16]
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {access_token}",
        "x-amzn-kiro-agent-mode": "vibe",
        "x-amz-user-agent": f"KiroIDE/0.12.155 ClientId/{machine_hash}",
        "user-agent": f"KiroIDE/0.12.155 ClientId/{machine_hash} os/windows lang/js md/nodejs",
        "amz-sdk-invocation-id": str(uuid.uuid4()),
        "amz-sdk-request": "attempt=1; max=3",
    }
    
    payload = {
        "conversationState": {
            "currentMessage": {
                "userInputMessage": {
                    "content": "Say hello",
                    "userInputMessageContext": {},
                    "origin": "AI_EDITOR",
                    "modelId": "claude-sonnet-4.6"
                }
            },
            "history": []
        },
        "profileArn": profile_arn
    }
    
    print(f"\n[3] Testing generateAssistantResponse with profileArn...")
    print(f"    profileArn: {profile_arn}")
    resp = requests.post(url, headers=headers, json=payload, proxies={"https": PROXY}, timeout=30)
    print(f"    Status: {resp.status_code}")
    if resp.status_code == 200:
        print(f"    ✅ SUCCESS! Enterprise account works with profileArn")
    else:
        print(f"    Response: {resp.text[:500]}")


if __name__ == "__main__":
    # Step 1: Refresh
    access_token = refresh_token()
    if not access_token:
        print("\n❌ Token refresh failed, cannot continue")
        exit(1)
    
    # Step 2: Get profiles
    profile_arn = get_profiles(access_token)
    if not profile_arn:
        print("\n❌ Could not get profileArn")
        exit(1)
    
    # Step 3: Test API call
    test_generate(access_token, profile_arn)
