/**
 * CASE 02: Anthropic 流式简单对话 (基线 SSE 事件序列).
 *
 * 验证最基础的路径: 单 user message → stream=true → 完整 SSE 序列.
 *
 * 通过条件:
 *   - HTTP 200
 *   - SSE 事件序列至少含 message_start / message_stop
 *   - 至少一个 content_block (text)
 *   - 收到的 message.content[0].text 非空
 *   - usage.input_tokens > 0
 */
import { postAnthropic } from '../lib/http.mjs'
import { DEFAULT_ANTHROPIC_MODEL, SMALL_MAX_TOKENS } from '../lib/fixtures.mjs'
import { assertHttp200, assertTrue, assertHasField } from '../lib/assert.mjs'

export default {
  id: 'CASE-02-anthropic-stream-simple',
  title: 'Anthropic 流式简单对话',
  tags: ['anthropic', 'stream', 'basic'],
  run: async ({ base, token, log }) => {
    const result = await postAnthropic({
      model: DEFAULT_ANTHROPIC_MODEL,
      max_tokens: SMALL_MAX_TOKENS,
      stream: true,
      messages: [{ role: 'user', content: '用一句话简单介绍一下你自己.' }]
    }, { base, token })
    log(`status=${result.status} kind=${result.kind} ttfb=${result.timing?.ttfb}ms total=${result.timing?.total}ms`)
    if (result.kind === 'stream-error') log(`upstream error body: ${result.text?.slice(0, 300) ?? ''}`)
    assertHttp200(result, 'stream.response')

    const c = result.collected
    assertHasField(c, 'message.id', 'stream.message.id')
    const eventNames = c.events.map((e) => e.event)
    log(`events=[${eventNames.join(',')}]`)
    assertTrue(eventNames.includes('message_start'), 'SSE 缺少 message_start 事件')
    assertTrue(eventNames.includes('message_stop'), 'SSE 缺少 message_stop 事件')

    const textBlock = (c.message?.content ?? []).find((b) => b.type === 'text')
    assertTrue(textBlock !== undefined, '响应应至少含一个 text content block')
    assertTrue(typeof textBlock.text === 'string' && textBlock.text.length > 0, 'text block 内容不应为空')
    assertTrue((c.usage?.input_tokens ?? 0) > 0, 'usage.input_tokens 应 > 0')
    log(`text=${textBlock.text.slice(0, 100)}...`)
  }
}
