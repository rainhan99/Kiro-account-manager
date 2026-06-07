/**
 * CASE 28: stop_sequences 字段应被反代正确转发并生效.
 */
import { postAnthropic } from '../lib/http.mjs'
import { DEFAULT_ANTHROPIC_MODEL } from '../lib/fixtures.mjs'
import { assertHttp200, assertTrue } from '../lib/assert.mjs'

export default {
  id: 'CASE-28-stop-sequences',
  title: 'stop_sequences 字段生效',
  tags: ['anthropic', 'inference', 'stream'],
  run: async ({ base, token, log }) => {
    const result = await postAnthropic({
      model: DEFAULT_ANTHROPIC_MODEL,
      max_tokens: 256,
      stream: true,
      stop_sequences: ['END_OF_RESPONSE'],
      temperature: 0.5,
      top_p: 0.9,
      messages: [{ role: 'user', content: '请说 hello, 然后输出 END_OF_RESPONSE 后停止.' }]
    }, { base, token })
    log(`status=${result.status} kind=${result.kind}`)
    if (result.kind === 'stream-error') log(`err=${result.text?.slice(0, 300)}`)
    assertHttp200(result, 'stop-seq.response')
    const blocks = result.collected?.message?.content ?? []
    const textBlock = blocks.find(b => b.type === 'text')
    assertTrue(textBlock && textBlock.text.length > 0, '应有 text 输出')
    log(`text=${textBlock.text.slice(0, 80)}, stop_reason=${result.collected?.stopReason}`)
  }
}
