/**
 * CASE 04: system 是 array (3 个 text block + cache_control), 复刻 Claude Code 真实结构.
 *
 * 验证 flattenAnthropicSystem 路径:
 *   - HTTP-header-like 段会被跳过 (不污染 system prompt)
 *   - Claude Code 身份字串被改写
 *   - cache_control 字段被忽略
 *
 * 通过条件:
 *   - HTTP 200
 *   - 响应正常 text 输出 (不报 400 / 不触发上游 permission_denied)
 */
import { postAnthropic } from '../lib/http.mjs'
import {
  DEFAULT_ANTHROPIC_MODEL,
  SMALL_MAX_TOKENS,
  SYSTEM_CLAUDECODE_STYLE
} from '../lib/fixtures.mjs'
import { assertHttp200, assertTrue } from '../lib/assert.mjs'

export default {
  id: 'CASE-04-system-array',
  title: 'system=array 多 block (复刻 Claude Code 结构)',
  tags: ['anthropic', 'system', 'stream'],
  run: async ({ base, token, log }) => {
    const result = await postAnthropic({
      model: DEFAULT_ANTHROPIC_MODEL,
      max_tokens: SMALL_MAX_TOKENS,
      stream: true,
      system: SYSTEM_CLAUDECODE_STYLE,
      messages: [{ role: 'user', content: '简单介绍一下你能做什么.' }]
    }, { base, token })
    log(`status=${result.status} kind=${result.kind}`)
    if (result.kind === 'stream-error') log(`err body=${result.text?.slice(0, 300)}`)
    assertHttp200(result, 'system-array.response')
    const textBlock = (result.collected?.message?.content ?? []).find((b) => b.type === 'text')
    assertTrue(textBlock !== undefined, '响应应至少含一个 text content block')
    assertTrue(textBlock.text.length > 0, 'text 内容不应为空')
    log(`text=${textBlock.text.slice(0, 100)}...`)
  }
}
