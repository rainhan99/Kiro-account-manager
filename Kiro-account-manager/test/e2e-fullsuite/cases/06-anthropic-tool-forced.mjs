/**
 * CASE 06: 强制工具调用 + 验证工具名反向映射.
 *
 * 关键: ZephyrSail 内部 isolateToolNames 把客户端工具名匿名化为 client_tool_NN_xxxx,
 * 上游返回 tool_use 时反代必须把 name 反向映射回客户端原始名字 (这里是 'GetWeather').
 * 如果反向映射失效, 客户端会收到 client_tool_xxx, 完全无法识别.
 *
 * 通过条件:
 *   - HTTP 200
 *   - 响应至少有一个 tool_use block
 *   - tool_use.name === 'GetWeather' (反向映射成功, 不能是 client_tool_*)
 *   - tool_use.input 是合法的 JSON 对象 (含 city 字段)
 */
import { postAnthropic } from '../lib/http.mjs'
import {
  DEFAULT_ANTHROPIC_MODEL,
  SMALL_MAX_TOKENS,
  TOOL_GET_WEATHER
} from '../lib/fixtures.mjs'
import { assertHttp200, assertTrue, assertEq } from '../lib/assert.mjs'

export default {
  id: 'CASE-06-tool-forced-name-roundtrip',
  title: '强制调用工具 + 验证 PascalCase 工具名反向映射 (client_tool_* → GetWeather)',
  tags: ['anthropic', 'tool', 'name-mapping', 'stream'],
  run: async ({ base, token, log }) => {
    const result = await postAnthropic({
      model: DEFAULT_ANTHROPIC_MODEL,
      max_tokens: SMALL_MAX_TOKENS,
      stream: true,
      tools: [TOOL_GET_WEATHER],
      tool_choice: { type: 'tool', name: 'GetWeather' },
      messages: [{ role: 'user', content: '帮我查一下北京的天气.' }]
    }, { base, token })
    log(`status=${result.status} kind=${result.kind}`)
    if (result.kind === 'stream-error') log(`err body=${result.text?.slice(0, 300)}`)
    assertHttp200(result, 'tool-forced.response')
    const blocks = result.collected?.message?.content ?? []
    const toolUse = blocks.find((b) => b.type === 'tool_use')
    assertTrue(toolUse !== undefined, '强制 tool_choice 后应至少含一个 tool_use block')
    log(`tool_use.name=${toolUse.name} tool_use.input=${JSON.stringify(toolUse.input)}`)
    assertEq(toolUse.name, 'GetWeather', 'tool_use.name (反向映射后应回到客户端原始名)')
    assertTrue(
      typeof toolUse.input === 'object' && toolUse.input !== null,
      'tool_use.input 应是对象'
    )
    assertTrue(
      typeof toolUse.input.city === 'string' && toolUse.input.city.length > 0,
      'tool_use.input.city 应是非空字符串'
    )
  }
}
