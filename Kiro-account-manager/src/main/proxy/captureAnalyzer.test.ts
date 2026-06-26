import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeCaptures, type CaptureEntry } from './captureAnalyzer.ts'

function mk(seq: number, sessionKey: string, usage: Partial<CaptureEntry['meta']['usage']> = {}, body: unknown = {}): CaptureEntry {
  return {
    meta: {
      seq, ts: 1000 + seq, path: '/v1/messages', model: 'claude-sonnet-4-6', status: 200, sessionKey,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, credits: 0, ...usage }
    },
    body
  }
}

test('groups requests by sessionKey', () => {
  const r = analyzeCaptures(
    [mk(1, 'S1'), mk(2, 'S1'), mk(3, 'S2')],
    { captureId: 'c1', apiKeyId: 'k1', startedAt: 0, endedAt: 100, stoppedReason: 'manual' }
  )
  assert.equal(r.sessions.length, 2)
  const s1 = r.sessions.find(s => s.sessionKey === 'S1')!
  assert.equal(s1.requests, 2)
  assert.deepEqual(s1.requestSeqs, [1, 2])
})

test('totals: cache hit rate and byModel', () => {
  const r = analyzeCaptures([
    mk(1, 'S1', { inputTokens: 9000, cacheWriteTokens: 4000, credits: 0.04 }),       // 创建
    mk(2, 'S1', { inputTokens: 9000, cacheReadTokens: 4000, credits: 0.02 }),        // 命中
  ], { captureId: 'c1', apiKeyId: 'k1', startedAt: 0, endedAt: 100, stoppedReason: 'manual' })
  assert.equal(r.totals.requests, 2)
  assert.equal(r.totals.cacheReadTokens, 4000)
  assert.equal(r.totals.cacheCreateTokens, 4000)
  // inputTokens 为含缓存全量，freshInput = sum(inputTokens) - cacheRead - cacheCreate = 18000 - 4000 - 4000 = 10000
  assert.equal(r.totals.freshInputTokens, 10000)
  // hitRate = read / (read + create + fresh) = 4000 / (4000+4000+10000) = 4000/18000
  assert.ok(Math.abs(r.totals.cacheHitRate - 4000 / 18000) < 1e-9)
  assert.equal(r.totals.byModel['claude-sonnet-4-6'].requests, 2)
  assert.equal(r.totals.byModel['claude-sonnet-4-6'].cacheReadTokens, 4000)
})

function sysBody(blocks: string[], tools: unknown[] = []): unknown {
  return { system: blocks.map(t => ({ type: 'text', text: t, cache_control: { type: 'ephemeral' } })), tools, messages: [{ role: 'user', content: 'hi' }] }
}

test('breaker: system block changed between consecutive misses', () => {
  const prev = sysBody(['AAA', 'BBB', 'CCC'])
  const cur = sysBody(['AAA', 'BBB', 'CCX']) // 第 3 块变了
  const r = analyzeCaptures([
    mk(1, 'S1', { cacheWriteTokens: 100 }, prev),
    mk(2, 'S1', { cacheReadTokens: 0 }, cur),   // 未命中
  ], { captureId: 'c1', apiKeyId: 'k1', startedAt: 0, endedAt: 100, stoppedReason: 'manual' })
  assert.equal(r.breakers.length, 1)
  const b = r.breakers[0]
  assert.equal(b.reason, 'system_block_changed')
  assert.equal(b.detail.changedBlockIndex, 2)
  assert.equal(b.prevSeq, 1)
  assert.equal(b.curSeq, 2)
  assert.notEqual(b.detail.prevSha, b.detail.curSha)
})

test('breaker: system blocks count changed uses dedicated count fields', () => {
  const prev = sysBody(['AAA', 'BBB', 'CCC']) // 3 块
  const cur = sysBody(['AAA', 'BBB'])          // 2 块
  const r = analyzeCaptures([
    mk(1, 'S1', { cacheWriteTokens: 100 }, prev),
    mk(2, 'S1', { cacheReadTokens: 0 }, cur),   // 未命中
  ], { captureId: 'c1', apiKeyId: 'k1', startedAt: 0, endedAt: 100, stoppedReason: 'manual' })
  assert.equal(r.breakers.length, 1)
  const b = r.breakers[0]
  assert.equal(b.reason, 'system_blocks_count_changed')
  assert.equal(b.detail.prevBlockCount, 3)
  assert.equal(b.detail.curBlockCount, 2)
  // SHA 字段在块数变化场景下不应被借用
  assert.equal(b.detail.prevSha, undefined)
  assert.equal(b.detail.curSha, undefined)
})

test('breaker: tools changed', () => {
  const prev = sysBody(['AAA'], [{ name: 't1' }])
  const cur = sysBody(['AAA'], [{ name: 't2' }])
  const r = analyzeCaptures([
    mk(1, 'S1', { cacheWriteTokens: 100 }, prev),
    mk(2, 'S1', { cacheReadTokens: 0 }, cur),
  ], { captureId: 'c1', apiKeyId: 'k1', startedAt: 0, endedAt: 100, stoppedReason: 'manual' })
  assert.equal(r.breakers[0].reason, 'tools_changed')
})

test('configWarnings: cache_control on a block whose content keeps changing', () => {
  // 同会话 system[0] 内容每次变，却带 cache_control
  const r = analyzeCaptures([
    mk(1, 'S1', { cacheWriteTokens: 1 }, sysBody(['v1-AAAAAAAAAAAAAAAAAAAA'])),
    mk(2, 'S1', { cacheReadTokens: 0 }, sysBody(['v2-BBBBBBBBBBBBBBBBBBBB'])),
  ], { captureId: 'c1', apiKeyId: 'k1', startedAt: 0, endedAt: 100, stoppedReason: 'manual' })
  assert.ok(r.configWarnings.some(w => w.includes('cache_control') && w.includes('S1')))
})

test('configWarnings: large system without cache_control', () => {
  const big = 'x'.repeat(6000) // 远超 cacheable 阈值的字符量
  const body = { system: [{ type: 'text', text: big }], messages: [{ role: 'user', content: 'hi' }] }
  const r = analyzeCaptures([mk(1, 'S2', {}, body)],
    { captureId: 'c1', apiKeyId: 'k1', startedAt: 0, endedAt: 100, stoppedReason: 'manual' })
  assert.ok(r.configWarnings.some(w => w.includes('未启用') || w.includes('cache_control')))
})
