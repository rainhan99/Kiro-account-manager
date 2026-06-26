// 代理抓包分析（纯函数，无副作用，可单测）

import { createHash } from 'node:crypto'

export interface CaptureUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  credits: number
}

export interface CaptureMeta {
  seq: number
  ts: number
  path: string
  model?: string
  clientIP?: string
  status: number
  sessionKey?: string
  accountId?: string   // 服务该请求的上游账号；Bedrock 缓存按账号隔离，换账号必 miss
  betaHeader?: string  // anthropic-beta 请求头（如 prompt-caching-*）
  usage: CaptureUsage
}

export interface CaptureEntry {
  meta: CaptureMeta
  body: unknown
}

export interface SessionAnalysis {
  sessionKey: string
  requestSeqs: number[]
  requests: number
  hits: number
  hitRate: number
}

export interface CacheBreaker {
  sessionKey: string
  prevSeq: number
  curSeq: number
  reason: 'system_block_changed' | 'system_blocks_count_changed' | 'tools_changed' | 'cache_control_moved' | 'account_switched' | 'unknown'
  detail: { changedBlockIndex?: number; prevSha?: string; curSha?: string; prevBlockCount?: number; curBlockCount?: number; snippet?: string; prevAccountId?: string; curAccountId?: string }
}

export interface CaptureReport {
  captureId: string
  apiKeyId: string
  window: { startedAt: number; endedAt: number; stoppedReason: string }
  totals: {
    requests: number
    cacheReadTokens: number
    cacheCreateTokens: number
    freshInputTokens: number
    cacheHitRate: number
    credits: number
    byModel: Record<string, { requests: number; cacheReadTokens: number; cacheCreateTokens: number }>
  }
  sessions: SessionAnalysis[]
  breakers: CacheBreaker[]
  configWarnings: string[]
}

export interface AnalyzeWindow {
  captureId: string
  apiKeyId: string
  startedAt: number
  endedAt: number
  stoppedReason: string
}

function bodySessionKey(body: unknown): string {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const k = (b.conversation_id || b.conversationId || b.prompt_cache_key || b.promptCacheKey || b.session_id || b.sessionId) as string | undefined
  if (k) return String(k)
  const msgs = Array.isArray(b.messages) ? b.messages : []
  if (msgs.length > 0) return 'fp:' + JSON.stringify(msgs[0]).slice(0, 64)
  return 'unknown'
}

function keyOf(e: CaptureEntry): string {
  return e.meta.sessionKey || bodySessionKey(e.body)
}

function sha12(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 12)
}

interface SysBlock { text: string; hasCC: boolean }

function systemBlocks(body: unknown): SysBlock[] {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const sys = b.system
  if (typeof sys === 'string') return [{ text: sys, hasCC: false }]
  if (Array.isArray(sys)) {
    return sys.map(x => {
      const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
      return { text: typeof o.text === 'string' ? o.text : JSON.stringify(o), hasCC: !!o.cache_control }
    })
  }
  return []
}

function toolsSig(body: unknown): string {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  return b.tools ? JSON.stringify(b.tools) : ''
}

function ccPositions(blocks: SysBlock[]): string {
  return blocks.map((bk, i) => (bk.hasCC ? i : -1)).filter(i => i >= 0).join(',')
}

function detectBreaker(sessionKey: string, prev: CaptureEntry, cur: CaptureEntry): CacheBreaker {
  const pb = systemBlocks(prev.body)
  const cb = systemBlocks(cur.body)
  const base = { sessionKey, prevSeq: prev.meta.seq, curSeq: cur.meta.seq }
  if (pb.length !== cb.length) {
    return { ...base, reason: 'system_blocks_count_changed', detail: { prevBlockCount: pb.length, curBlockCount: cb.length } }
  }
  for (let i = 0; i < pb.length; i++) {
    const ps = sha12(pb[i].text), cs = sha12(cb[i].text)
    if (ps !== cs) {
      return { ...base, reason: 'system_block_changed', detail: { changedBlockIndex: i, prevSha: ps, curSha: cs, snippet: cb[i].text.slice(0, 200) } }
    }
  }
  if (toolsSig(prev.body) !== toolsSig(cur.body)) {
    return { ...base, reason: 'tools_changed', detail: {} }
  }
  if (ccPositions(pb) !== ccPositions(cb)) {
    return { ...base, reason: 'cache_control_moved', detail: {} }
  }
  // 内容前缀完全一致却未命中：先看是否换了上游账号（Bedrock 缓存按账号隔离，换账号必 miss）
  const pa = prev.meta.accountId, ca = cur.meta.accountId
  if (pa && ca && pa !== ca) {
    return { ...base, reason: 'account_switched', detail: { prevAccountId: pa, curAccountId: ca } }
  }
  // 内容同、账号同仍 miss → 多半是缓存 TTL 过期（>5min）或其它
  return { ...base, reason: 'unknown', detail: {} }
}

export function analyzeCaptures(entries: CaptureEntry[], win: AnalyzeWindow): CaptureReport {
  const sorted = [...entries].sort((a, b) => a.meta.ts - b.meta.ts || a.meta.seq - b.meta.seq)

  const groups = new Map<string, CaptureEntry[]>()
  for (const e of sorted) {
    const k = keyOf(e)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(e)
  }

  const sessions: SessionAnalysis[] = []
  for (const [sessionKey, list] of groups) {
    const hits = list.filter(e => e.meta.usage.cacheReadTokens > 0).length
    sessions.push({
      sessionKey,
      requestSeqs: list.map(e => e.meta.seq),
      requests: list.length,
      hits,
      hitRate: list.length ? hits / list.length : 0
    })
  }

  let cacheReadTokens = 0, cacheCreateTokens = 0, sumInput = 0, credits = 0
  const byModel: Record<string, { requests: number; cacheReadTokens: number; cacheCreateTokens: number }> = {}
  for (const e of sorted) {
    const u = e.meta.usage
    cacheReadTokens += u.cacheReadTokens
    cacheCreateTokens += u.cacheWriteTokens
    sumInput += u.inputTokens
    credits += u.credits
    const m = e.meta.model || 'unknown'
    if (!byModel[m]) byModel[m] = { requests: 0, cacheReadTokens: 0, cacheCreateTokens: 0 }
    byModel[m].requests += 1
    byModel[m].cacheReadTokens += u.cacheReadTokens
    byModel[m].cacheCreateTokens += u.cacheWriteTokens
  }
  // inputTokens 为 Kiro 的含缓存全量计数（已含 cacheRead + cacheCreate），
  // 故 fresh 需同时减去 cacheRead 与 cacheCreate；denom 此时等于 sumInput。
  const freshInputTokens = Math.max(0, sumInput - cacheReadTokens - cacheCreateTokens)
  const denom = cacheReadTokens + cacheCreateTokens + freshInputTokens
  const cacheHitRate = denom ? cacheReadTokens / denom : 0

  const breakers: CacheBreaker[] = []
  // 从每个会话的第二个请求开始两两相邻 diff：会话的首个请求（以及只有单个请求的会话）
  // 没有同会话的前序请求可对比，故有意不产出 breaker。
  for (const [sessionKey, list] of groups) {
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1], cur = list[i]
      if (cur.meta.usage.cacheReadTokens === 0) {
        breakers.push(detectBreaker(sessionKey, prev, cur))
      }
    }
  }

  const configWarnings: string[] = []
  // 1) cache_control 打在内容反复变的块上
  for (const [sk, list] of groups) {
    if (list.length < 2) continue
    const ccBlockShaSets = new Map<number, Set<string>>()
    for (const e of list) {
      systemBlocks(e.body).forEach((bk, i) => {
        if (!bk.hasCC) return
        if (!ccBlockShaSets.has(i)) ccBlockShaSets.set(i, new Set())
        ccBlockShaSets.get(i)!.add(sha12(bk.text))
      })
    }
    for (const [i, shas] of ccBlockShaSets) {
      if (shas.size > 1) configWarnings.push(`会话 ${sk}: system[${i}] 带 cache_control 但内容反复变化（${shas.size} 种），缓存标记打在了会变的块上`)
    }
  }
  // 2) 大 system 但完全无 cache_control
  for (const e of sorted) {
    const blocks = systemBlocks(e.body)
    const totalChars = blocks.reduce((n, b) => n + b.text.length, 0)
    const anyCC = blocks.some(b => b.hasCC)
    if (totalChars > 4000 && !anyCC) {
      configWarnings.push(`req#${e.meta.seq}: system 约 ${totalChars} 字符但未启用 cache_control，无法命中缓存`)
    }
  }

  return {
    captureId: win.captureId,
    apiKeyId: win.apiKeyId,
    window: { startedAt: win.startedAt, endedAt: win.endedAt, stoppedReason: win.stoppedReason },
    totals: { requests: sorted.length, cacheReadTokens, cacheCreateTokens, freshInputTokens, cacheHitRate, credits, byModel },
    sessions,
    breakers,
    configWarnings
  }
}
