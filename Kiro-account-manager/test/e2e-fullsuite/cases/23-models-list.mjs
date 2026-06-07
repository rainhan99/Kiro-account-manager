/**
 * CASE 23: GET /v1/models 模型列表端点.
 *
 * 验证反代返回符合 Anthropic/OpenAI 标准的模型列表.
 */
import { assertTrue, assertHasField } from '../lib/assert.mjs'

export default {
  id: 'CASE-23-models-list',
  title: 'GET /v1/models 端点',
  tags: ['endpoint', 'models'],
  run: async ({ base, token, log }) => {
    const url = `${base.replace(/\/$/, '')}/v1/models`
    const r = await fetch(url, {
      method: 'GET',
      headers: { 'authorization': `Bearer ${token}` }
    })
    const text = await r.text()
    log(`status=${r.status} bytes=${text.length}`)
    assertTrue(r.status === 200, `models 列表应 200, 实际 ${r.status}`)
    const json = JSON.parse(text)
    assertHasField(json, 'data', 'models.json')
    assertTrue(Array.isArray(json.data), 'data 应是数组')
    assertTrue(json.data.length > 0, '模型列表不应为空')
    const sonnet = json.data.find(m => m.id?.includes('sonnet'))
    assertTrue(sonnet !== undefined, '应至少含一个 sonnet 模型')
    log(`models=${json.data.length}, first=${json.data[0].id}`)
  }
}
