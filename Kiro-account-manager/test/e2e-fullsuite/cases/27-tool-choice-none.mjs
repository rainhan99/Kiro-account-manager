/**
 * CASE 27: tool_choice = { type: 'none' } 应禁止模型调用工具.
 *
 * 即使有 tools 声明, tool_choice=none 时模型应只输出 text 不调工具.
 */
import { postAnthropic } from '../lib/http.mjs'
import { DEFAULT_ANTHROPIC_MODEL, SMALL_MAX_TOKENS, TOOL_GET_WEATHER } from '../lib/fixtures.mjs'
import { assertHttp200, assertTrue } from '../lib/assert.mjs'

export default {
  id: 'CASE-27-tool-choice-none',
  title: 'tool_choice=none 禁止调用工具',
  tags: ['anthropic', 'tool', 'tool-choice', 'stream'],
  run: async ({ base, token, log }) => {
    const result = await postAnthropic({
      model: DEFAULT_ANTHROPIC_MODEL,
      max_tokens: SMALL_MAX_TOKENS,
      stream: true,
      tools: [TOOL_GET_WEATHER],
      tool_choice: { type: 'none' },
      messages: [{ role: 'user', content: '北京的天气如何? 一句话回答.' }]
    }, { base, token })
    log(`status=${result.status} kind=${result.kind}`)
    if (result.kind === 'stream-error') log(`err=${result.text?.slice(0, 300)}`)
    assertHttp200(result, 'tool-choice-none.response')
    const blocks = result.collected?.message?.content ?? []
    const toolUse = blocks.find(b => b.type === 'tool_use')
    const textBlock = blocks.find(b => b.type === 'text')
    assertTrue(toolUse === undefined, 'tool_choice=none 时不应有 tool_use block')
    assertTrue(textBlock && textBlock.text.length > 0, '应返回纯文本响应')
  }
}
