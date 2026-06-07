/**
 * CASE 10: MCP 风格嵌套 schema ($ref / definitions / additionalProperties).
 *
 * 验证 stripJsonSchemaMeta 递归剥离:
 *   - $schema / $id / $defs / $ref / definitions / additionalProperties
 *   - 但保留 type / properties / required / enum / pattern / minimum / default
 *
 * 通过条件:
 *   - HTTP 200 (不报 schema 校验错误)
 *   - 响应有 text 或 tool_use, 至少能完成一轮交互
 */
import { postAnthropic } from '../lib/http.mjs'
import {
  DEFAULT_ANTHROPIC_MODEL,
  SMALL_MAX_TOKENS,
  TOOL_MCP_STYLE
} from '../lib/fixtures.mjs'
import { assertHttp200, assertTrue } from '../lib/assert.mjs'

export default {
  id: 'CASE-10-mcp-schema',
  title: 'MCP 风格嵌套 schema ($ref/definitions/additionalProperties 剥离)',
  tags: ['anthropic', 'tool', 'mcp', 'schema', 'stream'],
  run: async ({ base, token, log }) => {
    const result = await postAnthropic({
      model: DEFAULT_ANTHROPIC_MODEL,
      max_tokens: SMALL_MAX_TOKENS,
      stream: true,
      tools: [TOOL_MCP_STYLE],
      messages: [
        { role: 'user', content: '你好, 用一句话回答即可.' }
      ]
    }, { base, token })
    log(`status=${result.status} kind=${result.kind}`)
    if (result.kind === 'stream-error') log(`err=${result.text?.slice(0, 300)}`)
    assertHttp200(result, 'mcp-schema.response')
    const blocks = result.collected?.message?.content ?? []
    const hasContent = blocks.some(
      (b) => (b.type === 'text' && b.text?.length > 0) || b.type === 'tool_use'
    )
    assertTrue(hasContent, '响应应至少有 text 或 tool_use')
    log(`blocks=${blocks.map((b) => b.type).join(',')}`)
  }
}
