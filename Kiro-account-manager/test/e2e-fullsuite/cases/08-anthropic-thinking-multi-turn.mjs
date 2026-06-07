/**
 * CASE 08: thinking block + signature 在多轮里被正确处理.
 *
 * 流程:
 *   turn 1: 客户端 → 反代 → 上游, 得到 assistant.content=[thinking, text]
 *   turn 2: 客户端把上轮 thinking + signature 原样回传, 反代要能正常处理 (signature 字段会被丢弃但不报错)
 *
 * 这里直接构造 turn-2 请求验证:
 *   messages = [
 *     { user: 你好 },
 *     { assistant: [thinking, text] },        // 含 signature (任意非空字符串)
 *     { user: 继续 }
 *   ]
 *
 * 通过条件:
 *   - HTTP 200
 *   - assistant 响应正常输出
 *   - 不报 schema 校验错误
 */
import { postAnthropic } from '../lib/http.mjs'
import { DEFAULT_ANTHROPIC_MODEL, SMALL_MAX_TOKENS } from '../lib/fixtures.mjs'
import { assertHttp200, assertTrue } from '../lib/assert.mjs'

export default {
  id: 'CASE-08-thinking-multi-turn',
  title: 'assistant.thinking + signature 多轮回传 (signature 丢弃路径)',
  tags: ['anthropic', 'thinking', 'multi-turn', 'stream'],
  run: async ({ base, token, log }) => {
    const result = await postAnthropic({
      model: DEFAULT_ANTHROPIC_MODEL,
      max_tokens: SMALL_MAX_TOKENS,
      stream: true,
      thinking: { type: 'enabled', budget_tokens: 1024 },
      messages: [
        { role: 'user', content: '请简单告诉我什么是质数.' },
        {
          role: 'assistant',
          content: [
            {
              type: 'thinking',
              thinking: '用户在问质数的定义. 我应该用通俗的语言解释.',
              // signature 是 Anthropic 加密验证字段, ZephyrSail 转 Cascade 时会被丢弃
              signature: 'ErwCClsIDRABGAIqQG2z35XrW7y3r-test-signature-bytes-truncated'
            },
            { type: 'text', text: '质数是只能被 1 和自身整除的自然数.' }
          ]
        },
        { role: 'user', content: '那 1 是不是质数?' }
      ]
    }, { base, token })
    log(`status=${result.status} kind=${result.kind}`)
    if (result.kind === 'stream-error') log(`err=${result.text?.slice(0, 300)}`)
    assertHttp200(result, 'thinking-multiturn.response')
    const blocks = result.collected?.message?.content ?? []
    const textBlock = blocks.find((b) => b.type === 'text')
    assertTrue(textBlock && textBlock.text.length > 0, '响应应包含 text 回答')
    log(`assistant text=${textBlock.text.slice(0, 120)}...`)
  }
}
