/**
 * CASE 14: opencode 1.14.x 风格 — providerOptions.openaiCompatible.reasoningEffort + delta.reasoning_text 下发.
 *
 * 验证:
 *   1. ZephyrSail pickReasoningEffort 能识别 body.providerOptions.openaiCompatible.reasoningEffort
 *      (与顶层 body.reasoning_effort 互为候选)
 *   2. 流式 SSE delta 中实际发出 reasoning_text 字段 (而不只是 reasoning_content)
 *      Vercel AI SDK / opencode 1.14.29+ 客户端从 delta.reasoning_text 读, DeepSeek/GLM/Qwen3
 *      生态从 delta.reasoning_content 读, ZephyrSail emitReasoningDelta 必须双发
 *
 * 通过条件:
 *   - HTTP 200
 *   - 不报 schema 错误 (providerOptions 字段被 ZephyrSail 接受)
 *   - 响应有 text content (模型正常输出)
 *   - 若模型确实输出了思考: choices[0].message.reasoning_text 与 reasoning_content 同时非空且一致
 *     (若模型本次未输出思考, 仅断言 content 非空, 不强制 reasoning 字段, 避免上游模型行为差异导致测试不稳定)
 */
import { postOpenAI } from '../lib/http.mjs'
import { DEFAULT_OPENAI_MODEL, SMALL_MAX_TOKENS } from '../lib/fixtures.mjs'
import { assertHttp200, assertTrue, assertEq } from '../lib/assert.mjs'

export default {
  id: 'CASE-14-opencode-reasoning-effort-and-text',
  title: 'opencode: providerOptions.openaiCompatible.reasoningEffort + delta.reasoning_text 双发',
  tags: ['openai', 'opencode', 'reasoning', 'stream'],
  run: async ({ base, token, log }) => {
    const result = await postOpenAI({
      model: DEFAULT_OPENAI_MODEL,
      max_tokens: SMALL_MAX_TOKENS,
      stream: true,
      // opencode 用 providerOptions 路径传 reasoningEffort, 不用顶层 reasoning_effort
      providerOptions: {
        openaiCompatible: {
          reasoningEffort: 'low'
        }
      },
      messages: [
        { role: 'system', content: '你是一个简洁的助手, 一句话回答即可.' },
        { role: 'user', content: '7 是质数吗?' }
      ]
    }, { base, token })
    log(`status=${result.status} kind=${result.kind} ttfb=${result.timing?.ttfb}ms`)
    if (result.kind === 'stream-error') log(`err=${result.text?.slice(0, 300)}`)
    assertHttp200(result, 'opencode-reasoning.response')
    assertTrue(result.collected.done === true, 'SSE 应以 [DONE] 终止')
    const msg = result.collected.completion.choices[0].message
    assertTrue(typeof msg.content === 'string' && msg.content.length > 0, 'message.content 应非空')
    log(`content=${msg.content.slice(0, 80)}...`)

    // reasoning_text / reasoning_content 双发验证: 仅当模型本次产生 reasoning 才检查
    // (low effort 下模型可能直接给答案不思考, 这是上游正常行为)
    if (typeof msg.reasoning_text === 'string' && msg.reasoning_text.length > 0) {
      log(`reasoning_text=${msg.reasoning_text.slice(0, 60)}... (chars=${msg.reasoning_text.length})`)
      assertTrue(
        typeof msg.reasoning_content === 'string' && msg.reasoning_content === msg.reasoning_text,
        'reasoning_content 应与 reasoning_text 同时非空且内容一致 (ZephyrSail 双发)'
      )
    } else {
      log('模型本次未输出 reasoning, 跳过双发验证 (上游行为差异, 不算失败)')
      assertEq(msg.reasoning_content, undefined, '若 reasoning_text 缺失则 reasoning_content 也应缺失 (双发对称)')
    }
  }
}
