/**
 * CASE 20: 不存在的 model 名称应被反代兜底映射, 仍返回 200.
 *
 * 验证 mapModelId 兜底逻辑:
 *   - 未在 MODEL_ID_MAP 中的 model 名应映射到 default (claude-sonnet-4.5)
 */
import { postAnthropic } from '../lib/http.mjs'
import { SMALL_MAX_TOKENS } from '../lib/fixtures.mjs'
import { assertHttp200, assertTrue } from '../lib/assert.mjs'

export default {
  id: 'CASE-20-unknown-model',
  title: '不存在 model 兜底映射',
  tags: ['anthropic', 'model-mapping', 'fallback', 'stream'],
  run: async ({ base, token, log }) => {
    const result = await postAnthropic({
      model: 'claude-foo-bar-99-totally-unknown',
      max_tokens: SMALL_MAX_TOKENS,
      stream: true,
      messages: [{ role: 'user', content: '一句话回答即可.' }]
    }, { base, token })
    log(`status=${result.status} kind=${result.kind}`)
    assertHttp200(result, 'unknown-model.response')
    const blocks = result.collected?.message?.content ?? []
    const textBlock = blocks.find(b => b.type === 'text')
    assertTrue(textBlock !== undefined, '未知模型应被兜底, 返回正常 text 内容')
  }
}
