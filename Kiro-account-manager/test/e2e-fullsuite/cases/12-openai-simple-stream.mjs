/**
 * CASE 12: OpenAI /v1/chat/completions 流式简单对话 (基线).
 *
 * 这是双端点验证的基础: ZephyrSail OpenAI 端点和 Anthropic 端点走同一个上游 GetChatMessage,
 * 但入向 schema 不同, 因此独立测.
 *
 * 通过条件:
 *   - HTTP 200
 *   - SSE 流以 [DONE] 终止 (collected.done=true)
 *   - choices[0].message.content 非空
 *   - usage.prompt_tokens > 0 / completion_tokens > 0
 */
import { postOpenAI } from '../lib/http.mjs'
import { DEFAULT_OPENAI_MODEL, SMALL_MAX_TOKENS } from '../lib/fixtures.mjs'
import { assertHttp200, assertTrue } from '../lib/assert.mjs'

export default {
  id: 'CASE-12-openai-stream-simple',
  title: 'OpenAI /v1/chat/completions 流式简单对话',
  tags: ['openai', 'stream', 'basic'],
  run: async ({ base, token, log }) => {
    const result = await postOpenAI({
      model: DEFAULT_OPENAI_MODEL,
      max_tokens: SMALL_MAX_TOKENS,
      stream: true,
      messages: [
        { role: 'system', content: '你是一个简洁的助手, 用一句话回答.' },
        { role: 'user', content: '简单介绍一下你自己.' }
      ]
    }, { base, token })
    log(`status=${result.status} kind=${result.kind} ttfb=${result.timing?.ttfb}ms`)
    if (result.kind === 'stream-error') log(`err=${result.text?.slice(0, 300)}`)
    assertHttp200(result, 'openai-stream.response')
    assertTrue(result.collected.done === true, 'SSE 应以 [DONE] 终止')
    const msg = result.collected.completion.choices[0].message
    assertTrue(typeof msg.content === 'string' && msg.content.length > 0, 'message.content 应非空')
    const usage = result.collected.completion.usage ?? {}
    assertTrue((usage.prompt_tokens ?? 0) > 0, 'usage.prompt_tokens 应 > 0')
    assertTrue((usage.completion_tokens ?? 0) > 0, 'usage.completion_tokens 应 > 0')
    log(`content=${msg.content.slice(0, 100)}...`)
  }
}
