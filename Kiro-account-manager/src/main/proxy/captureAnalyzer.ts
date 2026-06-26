// 代理抓包分析（纯函数，无副作用，可单测）

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
  reason: 'system_block_changed' | 'system_blocks_count_changed' | 'tools_changed' | 'cache_control_moved' | 'unknown'
  detail: { changedBlockIndex?: number; prevSha?: string; curSha?: string; snippet?: string }
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
  const freshInputTokens = Math.max(0, sumInput - cacheReadTokens)
  const denom = cacheReadTokens + cacheCreateTokens + freshInputTokens
  const cacheHitRate = denom ? cacheReadTokens / denom : 0

  return {
    captureId: win.captureId,
    apiKeyId: win.apiKeyId,
    window: { startedAt: win.startedAt, endedAt: win.endedAt, stoppedReason: win.stoppedReason },
    totals: { requests: sorted.length, cacheReadTokens, cacheCreateTokens, freshInputTokens, cacheHitRate, credits, byModel },
    sessions,
    breakers: [],
    configWarnings: []
  }
}
