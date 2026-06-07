/**
 * CASE 29: admin/stats 应反映请求增量, 验证账号路由统计正确.
 *
 * 步骤:
 *   1. 拉 admin/stats baseline (totalRequests = N0)
 *   2. 发一次正常请求
 *   3. 拉 admin/stats 应 (totalRequests >= N0+1)
 */
import { postAnthropic } from '../lib/http.mjs'
import { DEFAULT_ANTHROPIC_MODEL, SMALL_MAX_TOKENS } from '../lib/fixtures.mjs'
import { assertHttp200, assertTrue } from '../lib/assert.mjs'

async function fetchStats(base, token) {
  const url = `${base.replace(/\/$/, '')}/admin/stats`
  const r = await fetch(url, { headers: { 'authorization': `Bearer ${token}` } })
  if (!r.ok) throw new Error(`admin/stats failed: ${r.status}`)
  return await r.json()
}

export default {
  id: 'CASE-29-admin-stats-tracking',
  title: 'admin/stats 请求计数随调用增加',
  tags: ['admin', 'stats', 'tracking'],
  run: async ({ base, token, log }) => {
    const before = await fetchStats(base, token)
    const beforeTotal = before?.totalRequests ?? before?.stats?.totalRequests ?? 0
    log(`baseline totalRequests=${beforeTotal}`)

    const result = await postAnthropic({
      model: DEFAULT_ANTHROPIC_MODEL,
      max_tokens: SMALL_MAX_TOKENS,
      stream: true,
      messages: [{ role: 'user', content: '一句话回答.' }]
    }, { base, token })
    assertHttp200(result, 'admin-stats.response')

    // 等 200ms 让统计落库
    await new Promise(r => setTimeout(r, 300))
    const after = await fetchStats(base, token)
    const afterTotal = after?.totalRequests ?? after?.stats?.totalRequests ?? 0
    log(`after totalRequests=${afterTotal}`)
    assertTrue(afterTotal >= beforeTotal + 1, `stats 应至少 +1, before=${beforeTotal} after=${afterTotal}`)
  }
}
