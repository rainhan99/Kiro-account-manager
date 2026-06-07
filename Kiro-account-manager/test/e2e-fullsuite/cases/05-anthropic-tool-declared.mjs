/**
 * CASE 05: 声明工具但不强制调用. 模型可能选择文本回答, 也可能调工具.
 *
 * 验证:
 *   - tools 数组被正确转发, schema 元字段 ($schema/additionalProperties) 被剥离不报错
 *   - 不会因 schema 字段触发上游 permission_denied
 *
 * 通过条件:
 *   - HTTP 200
 *   - SSE 完整收尾 (message_stop)
 *   - 至少有 text block 或 tool_use block 之一
 */
import { postAnthropic } from '../lib/http.mjs'
import {
  DEFAULT_ANTHROPIC_MODEL,
  SMALL_MAX_TOKENS,
  TOOL_GET_WEATHER,
  TOOL_GET_TIME,
  TOOL_WITH_SCHEMA_META
} from '../lib/fixtures.mjs'
import { assertHttp200, assertTrue } from '../lib/assert.mjs'

export default {
  id: 'CASE-05-tool-declared-no-force',
  title: '声明工具不强制 + schema 元字段 ($schema/additionalProperties)',
  tags: ['anthropic', 'tool', 'stream'],
  run: async ({ base, token, log }) => {
    const result = await postAnthropic({
      model: DEFAULT_ANTHROPIC_MODEL,
      max_tokens: SMALL_MAX_TOKENS,
      stream: true,
      tools: [TOOL_GET_WEATHER, TOOL_GET_TIME, TOOL_WITH_SCHEMA_META],
      messages: [{ role: 'user', content: '你好, 用一句话回答我.' }]
    }, { base, token })
    log(`status=${result.status} kind=${result.kind}`)
    if (result.kind === 'stream-error') log(`err body=${result.text?.slice(0, 300)}`)
    assertHttp200(result, 'tool-decl.response')
    const c = result.collected
    const evNames = c.events.map((e) => e.event)
    assertTrue(evNames.includes('message_stop'), 'SSE 缺少 message_stop')
    const blocks = c.message?.content ?? []
    const hasText = blocks.some((b) => b.type === 'text' && b.text?.length > 0)
    const hasTool = blocks.some((b) => b.type === 'tool_use')
    assertTrue(hasText || hasTool, '响应应至少包含 text 或 tool_use block')
    log(`blocks=${blocks.map((b) => b.type).join(',')}`)
  }
}
