import { useEffect, useState, useRef } from 'react'
import { X } from 'lucide-react'
import { Button, Card, CardContent, CardHeader, CardTitle, Badge } from '../ui'

interface ApiKeyOpt { id: string; name?: string }

interface CaptureReport {
  captureId: string
  apiKeyId: string
  window: { startedAt: number; endedAt: number; stoppedReason: string }
  totals: {
    requests: number; cacheReadTokens: number; cacheCreateTokens: number
    freshInputTokens: number; cacheHitRate: number; credits: number
    byModel: Record<string, { requests: number; cacheReadTokens: number; cacheCreateTokens: number }>
  }
  sessions: { sessionKey: string; requests: number; hits: number; hitRate: number; requestSeqs: number[] }[]
  breakers: { sessionKey: string; prevSeq: number; curSeq: number; reason: string; detail: { changedBlockIndex?: number; prevSha?: string; curSha?: string; snippet?: string; prevAccountId?: string; curAccountId?: string } }[]
  configWarnings: string[]
}

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  apiKeys: ApiKeyOpt[]
  isEn: boolean
}

export function ProxyCaptureDialog({ open, onOpenChange, apiKeys, isEn }: Props) {
  const [keyId, setKeyId] = useState('')
  const [minutes, setMinutes] = useState(15)
  const [status, setStatus] = useState<{ active: boolean; captureId: string; count: number; bytes: number; expiresAt: number } | null>(null)
  const [report, setReport] = useState<CaptureReport | null>(null)
  const [busy, setBusy] = useState(false)
  const poll = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!open) return
    if (apiKeys.length && !keyId) setKeyId(apiKeys[0].id)
    refreshStatus()
    const off = window.api.onProxyCaptureStopped(({ captureId }) => { loadReport(captureId) })
    return () => { off?.(); if (poll.current) clearInterval(poll.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const refreshStatus = async () => {
    const s = (await window.api.proxyCaptureStatus()) as typeof status
    setStatus(s)
    if (s?.active) startPoll()
  }
  const startPoll = () => {
    if (poll.current) clearInterval(poll.current)
    poll.current = setInterval(async () => {
      const s = (await window.api.proxyCaptureStatus()) as typeof status
      setStatus(s)
      if (!s?.active) { if (poll.current) clearInterval(poll.current); if (s) loadReport(s.captureId) }
    }, 2000)
  }
  const loadReport = async (captureId: string) => {
    const r = (await window.api.proxyCaptureReport(captureId)) as CaptureReport
    setReport(r); setStatus(null)
  }
  const start = async () => {
    setBusy(true); setReport(null)
    const r = await window.api.proxyCaptureStart({ apiKeyId: keyId, durationMs: minutes * 60_000 })
    setBusy(false)
    if (r.success) { await refreshStatus(); startPoll() }
    else alert(r.error || 'failed')
  }
  const stop = async () => { await window.api.proxyCaptureStop(); await refreshStatus() }

  if (!open) return null
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <Card className="relative w-[860px] max-h-[82vh] overflow-hidden glass-card-strong">
        <CardHeader className="pb-3 border-b">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">{isEn ? 'Capture & Cache Analysis' : '抓包 + 缓存命中分析'}</CardTitle>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onOpenChange(false)}><X className="h-4 w-4" /></Button>
          </div>
        </CardHeader>
        <CardContent className="p-4 overflow-y-auto max-h-[calc(82vh-70px)] space-y-4">
          {!status?.active && !report && (
            <div className="flex items-end gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">{isEn ? 'API Key' : '目标 Key'}</label>
                <select className="border rounded px-2 py-1 bg-background" value={keyId} onChange={e => setKeyId(e.target.value)}>
                  {apiKeys.map(k => <option key={k.id} value={k.id}>{k.name || k.id}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">{isEn ? 'Duration (min)' : '时长(分钟)'}</label>
                <select className="border rounded px-2 py-1 bg-background" value={minutes} onChange={e => setMinutes(Number(e.target.value))}>
                  {[5, 15, 30, 60].map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <Button onClick={start} disabled={busy || !keyId}>{isEn ? 'Start' : '开始抓包'}</Button>
            </div>
          )}

          {status?.active && (
            <div className="flex items-center justify-between rounded border p-3">
              <div className="text-sm">
                <div>{isEn ? 'Capturing' : '抓包中'}: <Badge variant="secondary">{status.captureId}</Badge></div>
                <div className="text-muted-foreground mt-1">{isEn ? 'Captured' : '已抓'}: {status.count} · {((status.bytes || 0) / 1024 / 1024).toFixed(1)}MB · {isEn ? 'ends in' : '剩余'} {Math.max(0, Math.round((status.expiresAt - Date.now()) / 1000))}s</div>
              </div>
              <Button variant="outline" onClick={stop}>{isEn ? 'Stop' : '停止'}</Button>
            </div>
          )}

          {report && (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-2 text-sm">
                <Stat label={isEn ? 'Requests' : '请求数'} value={String(report.totals.requests)} />
                <Stat label={isEn ? 'Cache Hit' : '命中率'} value={pct(report.totals.cacheHitRate)} highlight />
                <Stat label="cacheRead" value={report.totals.cacheReadTokens.toLocaleString()} />
                <Stat label="cacheCreate" value={report.totals.cacheCreateTokens.toLocaleString()} />
              </div>

              {report.breakers.length > 0 && (
                <div>
                  <div className="font-medium mb-2">{isEn ? 'Cache Breakers' : '缓存断裂点'} ({report.breakers.length})</div>
                  <div className="space-y-1 text-sm font-mono">
                    {report.breakers.map((b, i) => (
                      <div key={i} className="rounded border border-destructive/30 p-2">
                        <div>{isEn ? 'session' : '会话'} {b.sessionKey.slice(0, 24)} · req#{b.prevSeq}→#{b.curSeq} · <span className="text-destructive">{b.reason}</span>{b.detail.changedBlockIndex !== undefined ? ` system[${b.detail.changedBlockIndex}]` : ''}{b.reason === 'account_switched' ? ` ${b.detail.prevAccountId?.slice(0, 8)}→${b.detail.curAccountId?.slice(0, 8)}` : ''}</div>
                        {b.detail.snippet && <pre className="whitespace-pre-wrap break-all bg-muted/40 p-1 mt-1 text-xs max-h-24 overflow-y-auto">{b.detail.snippet}</pre>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="font-medium mb-2">{isEn ? 'Sessions' : '会话'} ({report.sessions.length})</div>
                <div className="space-y-1 text-sm font-mono">
                  {report.sessions.map((s, i) => (
                    <div key={i} className="flex justify-between border-b border-muted/30 py-1">
                      <span className="truncate max-w-[60%]" title={s.sessionKey}>{s.sessionKey.slice(0, 36)}</span>
                      <span>{s.hits}/{s.requests} · {pct(s.hitRate)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {report.configWarnings.length > 0 && (
                <div>
                  <div className="font-medium mb-2">{isEn ? 'Warnings' : '配置告警'}</div>
                  <ul className="list-disc pl-5 text-sm text-amber-600 space-y-1">
                    {report.configWarnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { setReport(null); }}>{isEn ? 'New Capture' : '新抓包'}</Button>
                <Button variant="outline" onClick={async () => { await window.api.proxyCaptureDeleteBodies(report.captureId); alert(isEn ? 'Bodies deleted' : '原始 body 已删除'); }}>{isEn ? 'Delete bodies' : '删除原始 body'}</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded border p-2 ${highlight ? 'border-success/40' : ''}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-mono ${highlight ? 'text-success' : ''}`}>{value}</div>
    </div>
  )
}
