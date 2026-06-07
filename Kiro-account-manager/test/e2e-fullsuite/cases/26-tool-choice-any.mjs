/**
 * CASE 26: tool_choice = { type: 'any' } 强制必须调用某个工具 (但不限定哪个).
 */
import { postAnthropic } from '../lib/http.mjs'
import { DEFAULT_ANTHROPIC_MODEL, SMALL_MAX_TOKENS, TOOL_GET_WEATHER, TOOL_GET_TIME } from '../lib/fixtures.mjs'
import { assertHttp200, assertTrue } from '../lib/assert.mjs'

export default {
  id: 'CASE-26-tool-choice-any',
  title: 'tool_choice=any 强制调用某工具',
  tags: ['anthropic', 'tool', 'tool-choice', 'stream'],
  run: async ({ base, token, log }) => {
    const result = await postAnthropic({
      model: DEFAULT_ANTHROPIC_MODEL,
      max_tokens: SMALL_MAX_TOKENS,
      stream: true,
      tools: [TOOL_GET_WEATHER, TOOL_GET_TIME],
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: '我想知道北京的天气.' }]
    }, { base, token })
    log(`status=${result.status} kind=${result.kind}`)
    if (result.kind === 'stream-error') log(`err=${result.text?.slice(0, 300)}`)
    assertHttp200(result, 'tool-choice-any.response')
    const blocks = result.collected?.message?.content ?? []
    const toolUse = blocks.find(b => b.type === 'tool_use')
    assertTrue(toolUse !== undefined, 'tool_choice=any 应必须调用一个工具')
    log(`tool_use.name=${toolUse.name}`)
  }
}
