/**
 * CASE 13: OpenAI /v1/chat/completions 工具调用 + 多轮 tool message.
 *
 * 验证 OpenAI 端点的:
 *   - tools[].function.parameters 中的 $schema/additionalProperties 被剥离
 *   - 工具名反向映射: 上游返回 client_tool_* 时反代映射回 'GetWeather'
 *   - assistant.tool_calls → role:tool 多轮交互不报错 (OpenAI 协议本身就是 flat sequence, 这条 case 主要做基线对比)
 *
 * 通过条件:
 *   - 单轮: HTTP 200, tool_calls 非空, function.name === 'GetWeather'
 *   - 多轮: HTTP 200, 不报 invalid_argument, 至少有 message.content 输出
 */
import { postOpenAI } from '../lib/http.mjs'
import { DEFAULT_OPENAI_MODEL, SMALL_MAX_TOKENS } from '../lib/fixtures.mjs'
import { assertHttp200, assertTrue, assertEq, assertNotContains } from '../lib/assert.mjs'

const OPENAI_TOOL_WEATHER = {
  type: 'function',
  function: {
    name: 'GetWeather',
    description: '查询城市当前天气.',
    parameters: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        city: { type: 'string', description: '城市名' },
        unit: { type: 'string', enum: ['celsius', 'fahrenheit'] }
      },
      required: ['city'],
      additionalProperties: false
    }
  }
}

export default {
  id: 'CASE-13-openai-tool-call-and-multi-turn',
  title: 'OpenAI 端点: 强制工具调用 + 多轮 tool message',
  tags: ['openai', 'tool', 'multi-turn', 'stream', 'name-mapping'],
  run: async ({ base, token, log }) => {
    // 第 1 步: 强制工具调用
    const r1 = await postOpenAI({
      model: DEFAULT_OPENAI_MODEL,
      max_tokens: SMALL_MAX_TOKENS,
      stream: true,
      tools: [OPENAI_TOOL_WEATHER],
      tool_choice: { type: 'function', function: { name: 'GetWeather' } },
      messages: [
        { role: 'system', content: '帮助用户查询天气.' },
        { role: 'user', content: '查一下深圳的天气.' }
      ]
    }, { base, token })
    log(`step1: status=${r1.status} kind=${r1.kind}`)
    if (r1.kind === 'stream-error') log(`step1 err=${r1.text?.slice(0, 300)}`)
    assertHttp200(r1, 'openai-tool.step1')
    const msg1 = r1.collected.completion.choices[0].message
    assertTrue(Array.isArray(msg1.tool_calls) && msg1.tool_calls.length > 0, 'step1 应含 tool_calls')
    const tc1 = msg1.tool_calls[0]
    log(`step1 tool_call.name=${tc1.function.name} args=${tc1.function.arguments}`)
    assertEq(tc1.function.name, 'GetWeather', 'step1.tool_call.function.name')

    // 第 2 步: 模拟 tool 返回 + 让模型继续回复
    const r2 = await postOpenAI({
      model: DEFAULT_OPENAI_MODEL,
      max_tokens: SMALL_MAX_TOKENS,
      stream: true,
      tools: [OPENAI_TOOL_WEATHER],
      messages: [
        { role: 'system', content: '帮助用户查询天气.' },
        { role: 'user', content: '查一下深圳的天气.' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: tc1.id,
              type: 'function',
              function: { name: 'GetWeather', arguments: tc1.function.arguments }
            }
          ]
        },
        {
          role: 'tool',
          tool_call_id: tc1.id,
          content: '深圳, 多云, 30°C, 湿度 75%.'
        },
        { role: 'user', content: '基于上面的天气, 用一句话给我穿衣建议.' }
      ]
    }, { base, token })
    log(`step2: status=${r2.status} kind=${r2.kind}`)
    if (r2.kind === 'stream-error') {
      log(`step2 err=${r2.text?.slice(0, 500)}`)
      assertNotContains(r2.text ?? '', 'invalid_argument', 'openai-tool.step2.error')
    }
    assertHttp200(r2, 'openai-tool.step2')
    const msg2 = r2.collected.completion.choices[0].message
    assertTrue(typeof msg2.content === 'string' && msg2.content.length > 0, 'step2 应返回 text content')
    log(`step2 content=${msg2.content.slice(0, 120)}...`)
  }
}
