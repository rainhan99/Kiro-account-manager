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
