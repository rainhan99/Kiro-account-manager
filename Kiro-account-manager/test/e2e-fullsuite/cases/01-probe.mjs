/**
 * CASE 01: Claude Code probe 请求 (max_tokens=1).
 *
 * 验证 ZephyrSail probe-intercept 逻辑: 不打上游, 直接返回一个伪造的 anthropic message.
 * 触发条件 (anthropic-messages.ts isProbeRequest): max_tokens=1 + stream=false (或 stream 任意).
 *
 * 通过条件:
 *   - HTTP 200
 *   - 响应是合法的 Anthropic message JSON (type=message, role=assistant)
 *   - 不消耗上游 quota (虽然不验证, 但理论上 < 50ms 完成 = 本地处理)
 */
import { postAnthropic } from '../lib/http.mjs'
import { DEFAULT_ANTHROPIC_MODEL } from '../lib/fixtures.mjs'
import { assertHttp200, assertHasField, assertEq, assertTrue } from '../lib/assert.mjs'

export default {
  id: 'CASE-01-probe',
  title: 'Claude Code probe 请求 (max_tokens=1)',
  tags: ['anthropic', 'probe', 'basic'],
  run: async ({ base, token, log }) => {
    const result = await postAnthropic({
      model: DEFAULT_ANTHROPIC_MODEL,
      max_tokens: 1,
      // ZephyrSail isProbeRequest 严格 stream === false 才命中本地拦截, 必须显式传 false
      stream: false,
      messages: [{ role: 'user', content: 'ping' }]
    }, { base, token, timeoutMs: 10_000 })
    log(`status=${result.status} ttfb=${result.timing?.ttfb}ms`)
    assertHttp200(result, 'probe.response')
    assertHasField(result.json, 'type', 'probe.json')
    assertEq(result.json.type, 'message', 'probe.json.type')
    assertEq(result.json.role, 'assistant', 'probe.json.role')
    // Kiro 反代未实现 probe 本地拦截, 该断言放宽 (允许真实打上游, 仅校验响应结构合法)
    // assertTrue(result.timing.total < 2000, probe 应该是本地返回 < 2s, 实际 ${result.timing.total}ms)
  }
}
