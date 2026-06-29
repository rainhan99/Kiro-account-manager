import { useState, useMemo } from 'react'
import { X, BarChart3, KeyRound, Globe, Cpu, Database } from 'lucide-react'
import { Button, Card, CardContent, CardHeader, CardTitle, Badge } from '../ui'

// 与 main/proxy/types.ts 的 DimensionCell / DimensionStats 保持一致
export interface DimensionCell {
  apiKeyId: string
  apiKeyLabel?: string
  clientIP: string
  model: string
  requests: number
  successRequests: number
  failedRequests: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  credits: number
  lastUsed: number
}

export interface DimensionStats {
  cells: DimensionCell[]
}

type Dimension = 'apiKey' | 'clientIP' | 'model'

interface DimensionStatsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  dimensionStats?: DimensionStats
  isEn: boolean
}

// 聚合后的分组行
interface GroupRow {
  key: string
  label: string
  requests: number
  successRequests: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  credits: number
}

const ALL = '__all__'

function cacheHitRate(r: { inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }): number {
  const denom = r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens
  if (denom <= 0) return 0
  return r.cacheReadTokens / denom
}

function formatModel(model: string): string {
  return model.replace('anthropic.', '').replace('-v1:0', '')
}

function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

// 取某个 cell 在指定维度上的「键」与「展示名」
function cellKey(cell: DimensionCell, dim: Dimension): string {
  if (dim === 'apiKey') return cell.apiKeyId
  if (dim === 'clientIP') return cell.clientIP
  return cell.model
}
function cellLabel(cell: DimensionCell, dim: Dimension): string {
  if (dim === 'apiKey') return cell.apiKeyLabel || cell.apiKeyId
  if (dim === 'clientIP') return cell.clientIP
  return formatModel(cell.model)
}

export function DimensionStatsDialog({ open, onOpenChange, dimensionStats, isEn }: DimensionStatsDialogProps): React.ReactNode {
  // 三个维度的过滤值（__all__ 表示不过滤）
  const [filterApiKey, setFilterApiKey] = useState<string>(ALL)
  const [filterClientIP, setFilterClientIP] = useState<string>(ALL)
  const [filterModel, setFilterModel] = useState<string>(ALL)
  // 分组依据
  const [groupBy, setGroupBy] = useState<Dimension>('apiKey')

  const cells = useMemo(() => dimensionStats?.cells ?? [], [dimensionStats])

  // 每个维度的可选项（用于下拉），含展示名
  const options = useMemo(() => {
    const build = (dim: Dimension): { value: string; label: string }[] => {
      const map = new Map<string, string>()
      for (const c of cells) map.set(cellKey(c, dim), cellLabel(c, dim))
      return Array.from(map.entries())
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label))
    }
    return { apiKey: build('apiKey'), clientIP: build('clientIP'), model: build('model') }
  }, [cells])

  // 按当前过滤条件筛选 cells
  const filteredCells = useMemo(() => {
    return cells.filter(c =>
      (filterApiKey === ALL || c.apiKeyId === filterApiKey) &&
      (filterClientIP === ALL || c.clientIP === filterClientIP) &&
      (filterModel === ALL || c.model === filterModel)
    )
  }, [cells, filterApiKey, filterClientIP, filterModel])

  // 按 groupBy 聚合
  const rows = useMemo<GroupRow[]>(() => {
    const map = new Map<string, GroupRow>()
    for (const c of filteredCells) {
      const key = cellKey(c, groupBy)
      let row = map.get(key)
      if (!row) {
        row = {
          key,
          label: cellLabel(c, groupBy),
          requests: 0,
          successRequests: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          credits: 0
        }
        map.set(key, row)
      }
      row.requests += c.requests
      row.successRequests += c.successRequests
      row.inputTokens += c.inputTokens
      row.outputTokens += c.outputTokens
      row.cacheReadTokens += c.cacheReadTokens
      row.cacheWriteTokens += c.cacheWriteTokens
      row.credits += c.credits
    }
    return Array.from(map.values()).sort((a, b) => b.requests - a.requests)
  }, [filteredCells, groupBy])

  // 汇总（当前过滤结果整体）
  const overall = useMemo(() => {
    let cacheRead = 0, input = 0, cacheWrite = 0, requests = 0
    for (const c of filteredCells) {
      cacheRead += c.cacheReadTokens
      input += c.inputTokens
      cacheWrite += c.cacheWriteTokens
      requests += c.requests
    }
    const denom = input + cacheRead + cacheWrite
    return { requests, hitRate: denom > 0 ? cacheRead / denom : 0, cacheRead }
  }, [filteredCells])

  if (!open) return null

  const dims: { value: Dimension; label: string; labelEn: string; icon: typeof KeyRound }[] = [
    { value: 'apiKey', label: 'API Key', labelEn: 'API Key', icon: KeyRound },
    { value: 'clientIP', label: '接入 IP', labelEn: 'Client IP', icon: Globe },
    { value: 'model', label: '模型', labelEn: 'Model', icon: Cpu }
  ]

  const groupHeader = groupBy === 'apiKey'
    ? 'API Key'
    : groupBy === 'clientIP'
      ? (isEn ? 'Client IP' : '接入 IP')
      : (isEn ? 'Model' : '模型')

  // 过滤下拉渲染
  const renderFilter = (dim: Dimension, value: string, setValue: (v: string) => void): React.ReactNode => {
    const meta = dims.find(d => d.value === dim)!
    const opts = options[dim]
    return (
      <div className="flex items-center gap-1.5">
        <meta.icon className="h-3.5 w-3.5 text-muted-foreground" />
        <select
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-8 px-2 text-xs rounded-md border border-input bg-background max-w-[160px]"
          title={isEn ? meta.labelEn : meta.label}
        >
          <option value={ALL}>{(isEn ? meta.labelEn : meta.label) + (isEn ? ': All' : '：全部')}</option>
          {opts.map(o => (
            <option key={o.value} value={o.value}>{dim === 'model' ? formatModel(o.label) : o.label}</option>
          ))}
        </select>
      </div>
    )
  }

  const hasFilter = filterApiKey !== ALL || filterClientIP !== ALL || filterModel !== ALL

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <Card className="relative w-[960px] max-h-[88vh] shadow-2xl border-0 overflow-hidden animate-in fade-in zoom-in-95 duration-200 glass-card-strong">
        <CardHeader className="pb-3 border-b sticky top-0 z-10">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              {isEn ? 'Dimensional Statistics' : '维度统计'}
            </CardTitle>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg hover:bg-red-500 hover:text-white transition-colors" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* 汇总卡片 */}
          <div className="grid grid-cols-3 gap-4 mt-4">
            <div className="bg-primary/10 rounded-lg p-3">
              <div className="text-xs text-muted-foreground mb-1">{isEn ? 'Requests' : '请求数'}</div>
              <div className="text-xl font-bold text-primary">{overall.requests.toLocaleString()}</div>
            </div>
            <div className="bg-success/10 rounded-lg p-3">
              <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <Database className="h-3 w-3" />
                {isEn ? 'Cache Hit Rate' : '缓存命中率'}
              </div>
              <div className="text-xl font-bold text-success">{(overall.hitRate * 100).toFixed(1)}%</div>
            </div>
            <div className="bg-[var(--gradient-to)]/10 rounded-lg p-3">
              <div className="text-xs text-muted-foreground mb-1">{isEn ? 'Cache Read Tokens' : '缓存读取 Tokens'}</div>
              <div className="text-xl font-bold text-[var(--gradient-to)]">{compactNumber(overall.cacheRead)}</div>
            </div>
          </div>

          {/* 过滤器 */}
          <div className="flex flex-wrap items-center gap-2 mt-4">
            <span className="text-xs text-muted-foreground">{isEn ? 'Filter:' : '过滤：'}</span>
            {renderFilter('apiKey', filterApiKey, setFilterApiKey)}
            {renderFilter('clientIP', filterClientIP, setFilterClientIP)}
            {renderFilter('model', filterModel, setFilterModel)}
            {hasFilter && (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setFilterApiKey(ALL); setFilterClientIP(ALL); setFilterModel(ALL) }}>
                {isEn ? 'Clear' : '清除'}
              </Button>
            )}
          </div>

          {/* 分组依据 */}
          <div className="flex items-center gap-2 mt-3">
            <span className="text-xs text-muted-foreground">{isEn ? 'Group by:' : '分组依据：'}</span>
            {dims.map(d => (
              <Button
                key={d.value}
                variant={groupBy === d.value ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setGroupBy(d.value)}
              >
                <d.icon className="h-3.5 w-3.5 mr-1" />
                {isEn ? d.labelEn : d.label}
              </Button>
            ))}
          </div>
        </CardHeader>

        <CardContent className="p-4 max-h-[calc(88vh-330px)] overflow-y-auto">
          {rows.length > 0 ? (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="text-left p-2 font-medium">{groupHeader}</th>
                  <th className="text-right p-2 font-medium">{isEn ? 'Requests' : '请求'}</th>
                  <th className="text-right p-2 font-medium">{isEn ? 'Success' : '成功率'}</th>
                  <th className="text-right p-2 font-medium">{isEn ? 'In' : '输入'}</th>
                  <th className="text-right p-2 font-medium">{isEn ? 'Out' : '输出'}</th>
                  <th className="text-right p-2 font-medium">{isEn ? 'Cache Read' : '缓存读'}</th>
                  <th className="text-right p-2 font-medium">{isEn ? 'Hit Rate' : '命中率'}</th>
                  <th className="text-right p-2 font-medium">Credits</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {rows.map((row) => {
                  const hr = cacheHitRate(row)
                  const successRate = row.requests > 0 ? (row.successRequests / row.requests) * 100 : 0
                  return (
                    <tr key={row.key} className="border-b border-muted/30 hover:bg-muted/30">
                      <td className="p-2 truncate max-w-[220px]" title={row.key}>
                        {row.label}
                        {groupBy === 'apiKey' && row.label !== row.key && (
                          <span className="ml-1 text-[10px] text-muted-foreground">({row.key.slice(0, 8)})</span>
                        )}
                      </td>
                      <td className="p-2 text-right">{row.requests.toLocaleString()}</td>
                      <td className="p-2 text-right">
                        <Badge variant="outline" className={successRate >= 99 ? 'text-success border-success/30' : successRate >= 90 ? '' : 'text-destructive border-destructive/30'}>
                          {successRate.toFixed(0)}%
                        </Badge>
                      </td>
                      <td className="p-2 text-right text-muted-foreground">{compactNumber(row.inputTokens)}</td>
                      <td className="p-2 text-right text-muted-foreground">{compactNumber(row.outputTokens)}</td>
                      <td className="p-2 text-right text-success">{compactNumber(row.cacheReadTokens)}</td>
                      <td className="p-2 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-success" style={{ width: `${Math.min(100, hr * 100)}%` }} />
                          </div>
                          <span className="text-xs w-10 text-right">{(hr * 100).toFixed(0)}%</span>
                        </div>
                      </td>
                      <td className="p-2 text-right text-muted-foreground">{row.credits.toFixed(4)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <div className="flex items-center justify-center h-32 text-muted-foreground">
              {hasFilter
                ? (isEn ? 'No data matches the current filter.' : '当前过滤条件下没有数据')
                : (isEn ? 'No statistics yet. Stats accumulate as requests are proxied.' : '暂无统计数据，反代请求后开始累计')}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
