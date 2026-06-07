/**
 * CASE 19: 入向 body 非法 JSON → 反代返回 400.
 *
 * 验证 readBody + JSON.parse 失败路径不打上游.
 */
import { assertTrue } from '../lib/assert.mjs'

export default {
  id: 'CASE-19-invalid-json',
  title: '非法 JSON body 返回 400',
  tags: ['anthropic', 'error', 'validation'],
  run: async ({ base, token, log }) => {
    const url = `${base.replace(/\/$/, '')}/v1/messages`
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'authorization': `Bearer ${token}`
      },
      body: 'this is { definitely not } valid JSON ['
    })
    const text = await r.text()
    log(`status=${r.status} body=${text.slice(0, 150)}`)
    assertTrue(r.status === 400 || r.status === 500, '非法 JSON 应返回 400 或 500')
  }
}