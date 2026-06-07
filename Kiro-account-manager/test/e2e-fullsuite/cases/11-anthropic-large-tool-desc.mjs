/**
 * CASE 11: tool description 超大 (>8KB) 触发 ZephyrSail 自动截断 + tool_documentation 注入.
 *
 * 触发 sanitizeTools 截断分支:
 *   - description.bytes > MAX_TOOL_DESCRIPTION_LEN (默认 8KB)
 *   - 截断后用 TOOL_DESC_TRUNCATE_SUFFIX 标记
 *   - 完整原始 description 注入 system prompt 末尾的 <tool_documentation> 块
 *
 * 通过条件:
 *   - HTTP 200 (上游不因 description 过大拒绝)
 *   - 响应正常返回
 */
import { postAnthropic } from '../lib/http.mjs'
import {
  DEFAULT_ANTHROPIC_MODEL,
  SMALL_MAX_TOKENS,
  bigDescription
} from '../lib/fixtures.mjs'
import { assertHttp200, assertTrue } from '../lib/assert.mjs'

const TOOL_HUGE_DESC = {
  name: 'huge_doc_tool',
  description: bigDescription(12_000),
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string' }
    },
    required: ['query']
  }
}

export default {
  id: 'CASE-11-large-tool-desc',
  title: '12KB tool description 触发截断 + tool_documentation 注入',
  tags: ['anthropic', 'tool', 'truncation', 'stream'],
  run: async ({ base, token, log }) => {
    const result = await postAnthropic({
      model: DEFAULT_ANTHROPIC_MODEL,
      max_tokens: SMALL_MAX_TOKENS,
      stream: true,
      tools: [TOOL_HUGE_DESC],
      messages: [{ role: 'user', content: '用一句话告诉我你能做什么.' }]
    }, { base, token })
    log(`status=${result.status} kind=${result.kind}`)
    if (result.kind === 'stream-error') log(`err=${result.text?.slice(0, 300)}`)
    assertHttp200(result, 'large-desc.response')
    const blocks = result.collected?.message?.content ?? []
    const hasContent = blocks.some(
      (b) => (b.type === 'text' && b.text?.length > 0) || b.type === 'tool_use'
    )
    assertTrue(hasContent, '响应应至少含 text 或 tool_use')
    log(`blocks=${blocks.map((b) => b.type).join(',')}`)
  }
}
