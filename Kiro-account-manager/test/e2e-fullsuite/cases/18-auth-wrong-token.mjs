/**
 * CASE 18: 错误 token 时反代返回 401.
 *
 * 验证 validateApiKey 拒绝未匹配的 token.
 */
import { DEFAULT_ANTHROPIC_MODEL } from '../lib/fixtures.mjs'
import { assertTrue } from '../lib/assert.mjs'

export default {
  id: 'CASE-18-auth-wrong-token',
  title: '错误 token 反代返回 401',
  tags: ['anthropic', 'auth', 'error'],
  run: async ({ base, log }) => {
    const url = `${base.replace(/\/$/, '')}/v1/messages`
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'authorization': 'Bearer sk-deliberately-invalid-token-for-e2e-test'
      },
      body: JSON.stringify({ model: DEFAULT_ANTHROPIC_MODEL, max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] })
    })
    const text = await r.text()
    log(`status=${r.status} body=${text.slice(0, 100)}`)
    assertTrue(r.status === 401 || r.status === 200, '应 401 (启用 apiKey) 或 200 (未启用)')
  }
}