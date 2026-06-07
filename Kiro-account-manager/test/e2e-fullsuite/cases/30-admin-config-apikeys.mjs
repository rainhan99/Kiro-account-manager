/**
 * CASE 30: admin/config 应返回 apiKeys 配置, 验证 API Key 管理 endpoint 可用.
 *
 * 验证点:
 *   - admin/config 端点鉴权通过
 *   - 返回结构包含 apiKeys 数组 (即使为空)
 *   - 当前使用的 token 能调通 (说明 apiKey 路由正确)
 */
import { assertTrue } from '../lib/assert.mjs'

export default {
  id: 'CASE-30-admin-config-apikeys',
  title: 'admin/config apiKeys 字段可读',
  tags: ['admin', 'apikey', 'config'],
  run: async ({ base, token, log }) => {
    const url = `${base.replace(/\/$/, '')}/admin/config`
    const r = await fetch(url, { headers: { 'authorization': `Bearer ${token}` } })
    log(`status=${r.status}`)
    assertTrue(r.status === 200, `admin/config 应 200, 实际 ${r.status}`)
    const json = await r.json()
    assertTrue(typeof json === 'object' && json !== null, '响应应是对象')
    // apiKeys 字段存在 (可能为空数组)
    assertTrue('apiKeys' in json || 'apiKey' in json, '配置应含 apiKeys 或 apiKey 字段')
    if (Array.isArray(json.apiKeys)) {
      log(`apiKeys count=${json.apiKeys.length}`)
    }
    if (json.apiKey) {
      log(`legacy apiKey: ${typeof json.apiKey === 'string' ? '*'.repeat(3) : '(non-string)'}`)
    }
  }
}
