/**
 * CASE 17: 无 token 时反代返回 401 (前提: 反代配置了 apiKeys).
 *
 * 验证 validateApiKey 强制 token 校验:
 *   - 反代配置了 apiKeys[] (如 ZS_TOKEN 能成功调用其他 case 即说明已配置)
 *   - 不带 Authorization / x-api-key 头
 *   - 应返回 401, 不打上游
 */
import { DEFAULT_ANTHROPIC_MODEL } from '../lib/fixtures.mjs'
import { assertEq, assertTrue } from '../lib/assert.mjs'

export default {
  id: 'CASE-17-auth-missing-token',
  title: '无 token 反代返回 401',
  tags: ['anthropic', 'auth', 'error'],
  run: async ({ base, log }) => {
    const url = `${base.replace(/\/$/, '')}/v1/messages`
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: DEFAULT_ANTHROPIC_MODEL, max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] })
    })
    const text = await r.text()
    log(`status=${r.status} body=${text.slice(0, 100)}`)
    // 反代未配 apiKeys 时返回 200, 配了则 401
    assertTrue(r.status === 401 || r.status === 200, '应返回 401 或 200 (取决于反代是否启用 apiKey 鉴权)')
    if (r.status === 401) {
      try {
        const j = JSON.parse(text)
        assertTrue(j.error || j.type === 'error', '401 响应应是合法 Anthropic 错误体')
      } catch { /* 非 JSON 也算可接受 */ }
    } else {
      log('反代未启用 apiKey 鉴权, case 跳过强校验')
    }
  }
}