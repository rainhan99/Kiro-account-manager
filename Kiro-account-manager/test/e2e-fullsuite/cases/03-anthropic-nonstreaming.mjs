/**
 * CASE 03: Anthropic 非流式 (一次性 JSON 响应).
 *
 * 通过条件:
 *   - HTTP 200
 *   - JSON 含 type=message, role=assistant
 *   - content 数组至少有一个 text block
 *   - usage.input_tokens > 0 & output_tokens > 0
 */
import { postAnthropic } from '../lib/http.mjs'
import { DEFAULT_ANTHROPIC_MODEL, SMALL_MAX_TOKENS } from '../lib/fixtures.mjs'
import { assertHttp200, assertEq, assertTrue } from '../lib/assert.mjs'

export default {
  id: 'CASE-03-anthropic-nostream',
  title: 'Anthropic 非流式简单对话',
  tags: ['anthropic', 'nonstream', 'basic'],
  run: async ({ base, token, log }) => {
    const result = await postAnthropic({
      model: DEFAULT_ANTHROPIC_MODEL,
      max_tokens: SMALL_MAX_TOKENS,
      stream: false,
      messages: [{ role: 'user', content: '请用一句话告诉我现在大概是什么季节.' }]
    }, { base, token })
    log(`status=${result.status} total=${result.timing?.total}ms`)
    assertHttp200(result, 'nostream.response')
    assertEq(result.json?.type, 'message', 'nostream.json.type')
    assertEq(result.json?.role, 'assistant', 'nostream.json.role')
    const textBlock = (result.json?.content ?? []).find((b) => b.type === 'text')
    assertTrue(textBlock !== undefined, '响应应至少含一个 text content block')
    assertTrue(textBlock.text.length > 0, 'text 内容不应为空')
    assertTrue((result.json?.usage?.input_tokens ?? 0) > 0, 'usage.input_tokens 应 > 0')
    assertTrue((result.json?.usage?.output_tokens ?? 0) > 0, 'usage.output_tokens 应 > 0')
    log(`text=${textBlock.text.slice(0, 100)}...`)
  }
}
