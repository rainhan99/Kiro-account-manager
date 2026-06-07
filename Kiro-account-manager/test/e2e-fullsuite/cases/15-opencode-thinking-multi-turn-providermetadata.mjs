/**
 * CASE 15: opencode 多轮 thinking signature 回传路径 (providerOptions.openaiCompatible.{signature,thinking}).
 *
 * 背景:
 *   - opencode 1.14.x `transform.ts` 在 interleaved 模型下, 把 reasoningText 拼到
 *     assistant message 的 providerOptions.openaiCompatible.<field> 里 (典型 'reasoning_content')
 *   - 多轮上行时, 客户端把上一轮 ZephyrSail 下发的 providerMetadata.openaiCompatible.{signature,thinking}
 *     反注到下一条请求的 providerOptions.openaiCompatible 路径
 *   - 若 ZephyrSail 收到含 providerOptions.openaiCompatible.signature 的 assistant message 报 schema 错,
 *     opencode 多轮 thinking 链路就会断
 *
 * 验证:
 *   - ZephyrSail 不拒绝 message.providerOptions.openaiCompatible.{signature,thinking,reasoning_content}
 *     这种 opencode-shape assistant message
 *   - 第二轮请求正常返回, 不报 400 / schema 错误
 *
 * 通过条件:
 *   - HTTP 200
 *   - 响应有 text content
 */
import { postOpenAI } from '../lib/http.mjs'
import { DEFAULT_OPENAI_MODEL, SMALL_MAX_TOKENS } from '../lib/fixtures.mjs'
import { assertHttp200, assertTrue } from '../lib/assert.mjs'

export default {
  id: 'CASE-15-opencode-multi-turn-provider-metadata',
  title: 'opencode: 多轮 assistant.providerOptions.openaiCompatible 回传不报 schema 错',
  tags: ['openai', 'opencode', 'reasoning', 'multi-turn', 'stream'],
  run: async ({ base, token, log }) => {
    const result = await postOpenAI({
      model: DEFAULT_OPENAI_MODEL,
      max_tokens: SMALL_MAX_TOKENS,
      stream: true,
      providerOptions: {
        openaiCompatible: {
          reasoningEffort: 'low'
        }
      },
      messages: [
        { role: 'user', content: '请简单告诉我什么是质数.' },
        {
          role: 'assistant',
          // opencode transform.ts 注入: 上一轮的 reasoning 文本走 providerOptions.openaiCompatible
          // 而不是 message.reasoning_content / reasoning_text 顶层字段
          providerOptions: {
            openaiCompatible: {
              reasoning_content: '用户问质数定义. 我应该用通俗语言解释.',
              // 这两个字段是 ZephyrSail 上一轮 emitReasoningEnd 下发的, opencode 反注
              signature: 'sig_e2e_test_truncated_for_validation',
              thinking: 'sig_e2e_test_truncated_for_validation',
              provider: 'anthropic'
            }
          },
          content: '质数是只能被 1 和自身整除的自然数.'
        },
        { role: 'user', content: '那 1 是不是质数?' }
      ]
    }, { base, token })
    log(`status=${result.status} kind=${result.kind}`)
    if (result.kind === 'stream-error') log(`err=${result.text?.slice(0, 300)}`)
    assertHttp200(result, 'opencode-multi-turn-pm.response')
    const msg = result.collected.completion.choices[0].message
    assertTrue(typeof msg.content === 'string' && msg.content.length > 0, 'message.content 应非空')
    log(`content=${msg.content.slice(0, 80)}...`)
  }
}
