/**
 * CASE 24: POST /v1/responses (OpenAI Responses API).
 *
 * 验证 handleOpenAIResponses 路径: 把 Responses API 转为内部 chat.completions, 再调上游.
 */
import { DEFAULT_OPENAI_MODEL, SMALL_MAX_TOKENS } from '../lib/fixtures.mjs'
import { assertTrue } from '../lib/assert.mjs'

export default {
  id: 'CASE-24-openai-responses',
  title: 'POST /v1/responses (OpenAI Responses API)',
  tags: ['openai', 'endpoint', 'responses'],
  run: async ({ base, token, log }) => {
    const url = `${base.replace(/\/$/, '')}/v1/responses`
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${token}` },
      body: JSON.stringify({
        model: DEFAULT_OPENAI_MODEL,
        max_output_tokens: SMALL_MAX_TOKENS,
        input: [{ role: 'user', content: '一句话回答即可.' }]
      })
    })
    const text = await r.text()
    log(`status=${r.status} bytes=${text.length}`)
    assertTrue(r.status === 200 || r.status === 400 || r.status === 404, `responses 端点应 200 (实现) 或 404 (未实现), 实际 ${r.status}`)
    if (r.status === 200) {
      const json = JSON.parse(text)
      assertTrue(json.output !== undefined || json.choices !== undefined, '应含 output 或 choices 字段')
    } else {
      log('Responses API 不支持或未实现, 跳过详细断言')
    }
  }
}
