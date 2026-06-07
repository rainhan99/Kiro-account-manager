/**
 * CASE 22: POST /v1/messages/count_tokens (Claude Code 调用).
 *
 * 验证反代支持 token 计数端点 (handleCountTokens 模拟响应).
 */
import { DEFAULT_ANTHROPIC_MODEL } from '../lib/fixtures.mjs'
import { assertTrue, assertHasField } from '../lib/assert.mjs'

export default {
  id: 'CASE-22-count-tokens',
  title: '/v1/messages/count_tokens 端点',
  tags: ['anthropic', 'endpoint'],
  run: async ({ base, token, log }) => {
    const url = `${base.replace(/\/$/, '')}/v1/messages/count_tokens`
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        model: DEFAULT_ANTHROPIC_MODEL,
        messages: [{ role: 'user', content: 'Hello, how many tokens is this?' }]
      })
    })
    const text = await r.text()
    log(`status=${r.status} body=${text.slice(0, 200)}`)
    assertTrue(r.status === 200, `count_tokens 应返回 200, 实际 ${r.status}`)
    const json = JSON.parse(text)
    assertHasField(json, 'input_tokens', 'count_tokens.json')
    assertTrue(typeof json.input_tokens === 'number' && json.input_tokens >= 0, 'input_tokens 应是非负数')
  }
}
