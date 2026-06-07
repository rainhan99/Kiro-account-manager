/**
 * 测试脚本：诊断 tlsclientwrapper 发送的 headers
 * 用法: node test/test-tls-oidc.mjs [proxy]
 */
import { ModuleClient, SessionClient } from 'tlsclientwrapper'

const proxy = process.argv[2] || ''
const oidcUrl = 'https://oidc.us-east-1.amazonaws.com/client/register'
const echoUrl = 'https://httpbin.org/post'
const body = JSON.stringify({
  clientName: 'Amazon Q Developer for command line',
  clientType: 'public',
  scopes: ['codewhisperer:completions', 'codewhisperer:analysis', 'codewhisperer:conversations', 'codewhisperer:transformations', 'codewhisperer:taskassist']
})

async function main() {
  console.log(`proxy: ${proxy || '(none)'}`)
  const mc = new ModuleClient()

  const session = new SessionClient(mc, {
    tlsClientIdentifier: 'chrome_144',
    timeoutSeconds: 15,
    followRedirects: true,
    insecureSkipVerify: true,
    proxyUrl: proxy || undefined
  })

  // 测试 1: 发到 httpbin 看实际发送的 headers (正确 API)
  console.log('\n=== httpbin echo (正确 API: body 第2参, headers 第3参) ===')
  try {
    const echoResp = await session.post(echoUrl, body, {
      headers: { 'Content-Type': 'application/json' }
    })
    const echoData = JSON.parse(echoResp.body || '{}')
    console.log('request headers:', JSON.stringify(echoData.headers, null, 2))
    console.log('body received:', echoData.data?.slice(0, 200))
  } catch (err) {
    console.log('httpbin error:', err.message)
  }

  // 测试 2: 发到 OIDC (正确 API)
  console.log('\n=== OIDC register ===')
  try {
    const resp = await session.post(oidcUrl, body, {
      headers: { 'Content-Type': 'application/json' }
    })
    console.log(`status=${resp.status}`)
    console.log(`body=${(resp.body || '').slice(0, 200)}`)
  } catch (err) {
    console.log('OIDC error:', err.message)
  }

  await session.destroySession()
  await mc.terminate()
  console.log('\nDone.')
}

main().catch(console.error)
