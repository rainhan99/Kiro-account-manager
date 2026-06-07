/**
 * CASE 25: 多模态 image (base64 编码 1x1 PNG).
 *
 * 验证 image content block 正确转换为 Kiro userInputMessage.images 字段.
 */
import { postAnthropic } from '../lib/http.mjs'
import { DEFAULT_ANTHROPIC_MODEL, SMALL_MAX_TOKENS } from '../lib/fixtures.mjs'
import { assertHttp200, assertTrue } from '../lib/assert.mjs'

// 1x1 透明 PNG (base64), 用于测试图像传输, 不需要实际识别内容
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

export default {
  id: 'CASE-25-image-base64',
  title: '多模态 image base64 输入',
  tags: ['anthropic', 'multimodal', 'image', 'stream'],
  run: async ({ base, token, log }) => {
    const result = await postAnthropic({
      model: DEFAULT_ANTHROPIC_MODEL,
      max_tokens: SMALL_MAX_TOKENS,
      stream: true,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: TINY_PNG } },
          { type: 'text', text: '一句话描述你看到了什么 (即使图片为空也描述).' }
        ]
      }]
    }, { base, token })
    log(`status=${result.status} kind=${result.kind}`)
    if (result.kind === 'stream-error') log(`err=${result.text?.slice(0, 300)}`)
    assertHttp200(result, 'image-base64.response')
    const blocks = result.collected?.message?.content ?? []
    const textBlock = blocks.find(b => b.type === 'text')
    assertTrue(textBlock && textBlock.text.length > 0, '应返回文本响应')
  }
}
