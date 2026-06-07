/**
 * CASE 07: 多轮 — 同一条 user message 同时含 tool_result + text. (本轮修复的关键场景)
 *
 * 这是 anthropic-converter 转换顺序错位 bug 的复现:
 *   - 原始 user.content = [{tool_result}, {text}]
 *   - 内部 ChatMessage 序列要求: assistant(tool_calls) → tool → user(text), 紧密相邻
 *   - 之前实现先推 user(text) 后推 tool, 导致上游 invalid_argument 502
 *
 * 通过条件:
 *   - HTTP 200 (不能是 502)
 *   - 不出现任何 'invalid_argument' / 'internal error' 字样在错误体里
 *   - 至少收到一个完整 message_stop 事件
 */
import { postAnthropic } from '../lib/http.mjs'
import {
  DEFAULT_ANTHROPIC_MODEL,
  SMALL_MAX_TOKENS,
  TOOL_GET_WEATHER
} from '../lib/fixtures.mjs'
import { assertHttp200, assertTrue, assertNotContains } from '../lib/assert.mjs'

export default {
  id: 'CASE-07-multi-turn-tool-result-and-text',
  title: '关键: user message 含 tool_result + text 多 block (修复后不报 invalid_argument)',
  tags: ['anthropic', 'tool', 'multi-turn', 'regression', 'stream'],
  run: async ({ base, token, log }) => {
    const toolUseId = 'toolu_e2e_test_tr1'
    const result = await postAnthropic({
      model: DEFAULT_ANTHROPIC_MODEL,
      max_tokens: SMALL_MAX_TOKENS,
      stream: true,
      tools: [TOOL_GET_WEATHER],
      messages: [
        { role: 'user', content: '帮我查一下上海的天气.' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: '我来调用工具查询.' },
            {
              type: 'tool_use',
              id: toolUseId,
              name: 'GetWeather',
              input: { city: 'Shanghai', unit: 'celsius' }
            }
          ]
        },
        {
          // 关键: 同一条 user message 同时含 tool_result + text
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: toolUseId,
              content: '上海, 晴, 28°C, 湿度 60%, 风速 3km/h.'
            },
            {
              type: 'text',
              text: '请根据上面的天气信息, 用一句话给我穿衣建议.'
            }
          ]
        }
      ]
    }, { base, token })
    log(`status=${result.status} kind=${result.kind}`)
    if (result.kind === 'stream-error') {
      log(`upstream body: ${result.text?.slice(0, 500)}`)
      // 关键断言: 不应该出现 invalid_argument
      assertNotContains(result.text ?? '', 'invalid_argument', 'response.error.message')
      assertNotContains(result.text ?? '', 'an internal error occurred', 'response.error.message')
    }
    assertHttp200(result, 'multi-turn-tr-text.response')
    const evNames = result.collected.events.map((e) => e.event)
    assertTrue(evNames.includes('message_stop'), 'SSE 缺少 message_stop')
    const blocks = result.collected.message?.content ?? []
    const textBlock = blocks.find((b) => b.type === 'text')
    assertTrue(textBlock && textBlock.text.length > 0, '响应应包含 text 内容回应工具结果')
    log(`assistant text=${textBlock.text.slice(0, 120)}...`)
  }
}
