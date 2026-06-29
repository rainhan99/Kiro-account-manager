import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { 
  Key, Plus, Trash2, Copy, Check, RefreshCw, Eye, EyeOff, 
  BarChart3, Clock, Zap, MessageSquare, ExternalLink
} from 'lucide-react'
import { Select } from '@/components/ui'
import { cn } from '@/lib/utils'
import { useAccountsStore } from '@/store/accounts'
import { ApiKeyUsageDialog } from './ApiKeyUsageDialog'

type ApiKeyFormat = 'sk' | 'simple' | 'token'

interface UsageRecord {
  timestamp: number
  model: string
  inputTokens: number
  outputTokens: number
  credits: number
  path: string
}

interface ApiKey {
  id: string
  name: string
  key: string
  format?: ApiKeyFormat
  enabled: boolean
  createdAt: number
  lastUsedAt?: number
  creditsLimit?: number
  usageAlertThreshold?: number
  allowedModels?: string[]
  qpmLimit?: number
  tpmLimit?: number
  usage: {
    totalRequests: number
    totalCredits: number
    totalInputTokens: number
    totalOutputTokens: number
    daily: Record<string, {
      requests: number
      credits: number
      inputTokens: number
      outputTokens: number
    }>
    byModel?: Record<string, {
      requests: number
      credits: number
      inputTokens: number
      outputTokens: number
    }>
  }
  usageHistory?: UsageRecord[]
}

export function ApiKeyManager() {
  const { language } = useAccountsStore()
  const isEn = language === 'en'
  
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyFormat, setNewKeyFormat] = useState<ApiKeyFormat>('sk')
  const [newKeyCreditsLimit, setNewKeyCreditsLimit] = useState<string>('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [showKeys, setShowKeys] = useState<Set<string>>(new Set())
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [showUsageDialog, setShowUsageDialog] = useState(false)
  // 可用模型列表（用于白名单填写提示）
  const [modelHints, setModelHints] = useState<string[]>([])
  // 模型白名单文本编辑缓冲（每行/逗号分隔一个 pattern）
  const [allowedModelsText, setAllowedModelsText] = useState('')

  const loadApiKeys = useCallback(async () => {
    try {
      const result = await window.api.proxyGetApiKeys()
      if (result.success) {
        setApiKeys(result.apiKeys)
      }
    } catch (error) {
      console.error('Failed to load API keys:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadApiKeys()
  }, [loadApiKeys])

  // 拉取可用模型列表，作为白名单填写提示
  useEffect(() => {
    window.api.proxyGetModels().then(r => {
      if (r.success && Array.isArray(r.models)) setModelHints(r.models.map(m => m.id))
    }).catch(() => { /* 忽略，提示非必需 */ })
  }, [])

  // 通用：更新选中 Key 的某个字段并本地同步
  const updateKeyField = useCallback(async (id: string, updates: Record<string, unknown>) => {
    const result = await window.api.proxyUpdateApiKey(id, updates)
    if (result.success) {
      setApiKeys(prev => prev.map(k => k.id === id ? { ...k, ...updates } as ApiKey : k))
    }
    return result
  }, [])

  const handleAddKey = async () => {
    if (!newKeyName.trim()) return
    
    try {
      const creditsLimit = newKeyCreditsLimit ? parseFloat(newKeyCreditsLimit) : undefined
      const result = await window.api.proxyAddApiKey({ 
        name: newKeyName.trim(),
        format: newKeyFormat,
        creditsLimit: creditsLimit && creditsLimit > 0 ? creditsLimit : undefined
      })
      if (result.success && result.apiKey) {
        setApiKeys(prev => [...prev, result.apiKey!])
        setNewKeyName('')
        setNewKeyCreditsLimit('')
      }
    } catch (error) {
      console.error('Failed to add API key:', error)
    }
  }

  const handleDeleteKey = async (id: string) => {
    if (!confirm(isEn ? 'Delete this API key?' : '确定删除此 API Key？')) return
    
    try {
      const result = await window.api.proxyDeleteApiKey(id)
      if (result.success) {
        setApiKeys(prev => prev.filter(k => k.id !== id))
        if (selectedKey === id) setSelectedKey(null)
      }
    } catch (error) {
      console.error('Failed to delete API key:', error)
    }
  }

  const handleToggleKey = async (id: string, enabled: boolean) => {
    try {
      const result = await window.api.proxyUpdateApiKey(id, { enabled })
      if (result.success) {
        setApiKeys(prev => prev.map(k => k.id === id ? { ...k, enabled } : k))
      }
    } catch (error) {
      console.error('Failed to toggle API key:', error)
    }
  }

  const handleResetUsage = async (id: string) => {
    if (!confirm(isEn ? 'Reset usage statistics?' : '确定重置用量统计？')) return
    
    try {
      const result = await window.api.proxyResetApiKeyUsage(id)
      if (result.success) {
        setApiKeys(prev => prev.map(k => k.id === id ? {
          ...k,
          usage: { totalRequests: 0, totalCredits: 0, totalInputTokens: 0, totalOutputTokens: 0, daily: {} }
        } : k))
      }
    } catch (error) {
      console.error('Failed to reset usage:', error)
    }
  }

  const copyToClipboard = (id: string, key: string) => {
    navigator.clipboard.writeText(key)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const toggleShowKey = (id: string) => {
    setShowKeys(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`
  }

  const maskKey = (key: string) => {
    return key.substring(0, 8) + '...' + key.substring(key.length - 4)
  }

  const selectedKeyData = apiKeys.find(k => k.id === selectedKey)

  // 选中 Key 变化时，把模型白名单同步到编辑缓冲
  useEffect(() => {
    setAllowedModelsText((selectedKeyData?.allowedModels || []).join('\n'))
  }, [selectedKey, selectedKeyData?.allowedModels])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Key className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">{isEn ? 'API Keys' : 'API 密钥'}</CardTitle>
            </div>
            <span className="text-sm text-muted-foreground">
              {apiKeys.length} {isEn ? 'keys' : '个'}
            </span>
          </div>
          <CardDescription>
            {isEn ? 'Manage API keys for authentication' : '管理用于身份验证的 API 密钥'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                placeholder={isEn ? 'Key name...' : '密钥名称...'}
                value={newKeyName}
                onChange={e => setNewKeyName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddKey()}
                className="flex-1"
              />
              <Select
                value={newKeyFormat}
                options={[
                  { value: 'sk', label: 'sk-xxx' },
                  { value: 'simple', label: 'PROXY_KEY' },
                  { value: 'token', label: 'KEY:TOKEN' }
                ]}
                onChange={v => setNewKeyFormat(v as ApiKeyFormat)}
                className="w-[120px]"
              />
              <Button onClick={handleAddKey} disabled={!newKeyName.trim()}>
                <Plus className="h-4 w-4 mr-1" />
                {isEn ? 'Add' : '添加'}
              </Button>
            </div>
            <div className="flex gap-2 items-center">
              <Input
                type="number"
                placeholder={isEn ? 'Credits limit (optional)' : 'Credits 额度限制（可选）'}
                value={newKeyCreditsLimit}
                onChange={e => setNewKeyCreditsLimit(e.target.value)}
                className="flex-1"
              />
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {isEn ? '0 = unlimited' : '0 = 无限制'}
              </span>
            </div>
          </div>

          {apiKeys.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {isEn ? 'No API keys yet' : '暂无 API 密钥'}
            </div>
          ) : (
            <div className="space-y-2">
              {apiKeys.map(apiKey => (
                <div
                  key={apiKey.id}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-lg border transition-colors cursor-pointer",
                    selectedKey === apiKey.id ? "bg-primary/5 border-primary" : "hover:bg-muted/50",
                    !apiKey.enabled && "opacity-50"
                  )}
                  onClick={() => setSelectedKey(selectedKey === apiKey.id ? null : apiKey.id)}
                >
                  <div onClick={e => e.stopPropagation()}>
                    <Switch
                      checked={apiKey.enabled}
                      onCheckedChange={enabled => handleToggleKey(apiKey.id, enabled)}
                    />
                  </div>
                  
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <div className="font-medium truncate">{apiKey.name}</div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <code className="bg-muted px-1 rounded">
                        {showKeys.has(apiKey.id) ? apiKey.key : maskKey(apiKey.key)}
                      </code>
                      <button
                        className="hover:text-foreground"
                        onClick={e => { e.stopPropagation(); toggleShowKey(apiKey.id) }}
                      >
                        {showKeys.has(apiKey.id) ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      </button>
                      <button
                        className="hover:text-foreground"
                        onClick={e => { e.stopPropagation(); copyToClipboard(apiKey.id, apiKey.key) }}
                      >
                        {copiedId === apiKey.id ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                      </button>
                    </div>
                  </div>

                  <div className="text-right text-xs text-muted-foreground">
                    <div>{apiKey.usage.totalRequests} {isEn ? 'requests' : '请求'}</div>
                    <div className={cn(
                      apiKey.creditsLimit && apiKey.usage.totalCredits >= apiKey.creditsLimit && "text-destructive font-medium"
                    )}>
                      {apiKey.usage.totalCredits.toFixed(2)}{apiKey.creditsLimit ? `/${apiKey.creditsLimit}` : ''} credits
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={e => { e.stopPropagation(); handleDeleteKey(apiKey.id) }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedKeyData && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">
                  {isEn ? 'Usage Details' : '用量详情'}: {selectedKeyData.name}
                </CardTitle>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowUsageDialog(true)}>
                  <ExternalLink className="h-3 w-3 mr-1" />
                  {isEn ? 'View Details' : '查看详情'}
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleResetUsage(selectedKeyData.id)}>
                  <RefreshCw className="h-3 w-3 mr-1" />
                  {isEn ? 'Reset Usage' : '重置用量'}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <MessageSquare className="h-4 w-4" />
                  <span className="text-xs">{isEn ? 'Total Requests' : '总请求数'}</span>
                </div>
                <div className="text-2xl font-bold">{selectedKeyData.usage.totalRequests}</div>
              </div>
              
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Zap className="h-4 w-4" />
                  <span className="text-xs">{isEn ? 'Total Credits' : '总 Credits'}</span>
                </div>
                <div className="text-2xl font-bold">{selectedKeyData.usage.totalCredits.toFixed(2)}</div>
              </div>
              
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <span className="text-xs">{isEn ? 'Input Tokens' : '输入 Tokens'}</span>
                </div>
                <div className="text-2xl font-bold">{selectedKeyData.usage.totalInputTokens.toLocaleString()}</div>
              </div>
              
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <span className="text-xs">{isEn ? 'Output Tokens' : '输出 Tokens'}</span>
                </div>
                <div className="text-2xl font-bold">{selectedKeyData.usage.totalOutputTokens.toLocaleString()}</div>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{isEn ? 'Credits Limit:' : 'Credits 额度限制:'}</span>
                <Input
                  type="number"
                  placeholder={isEn ? 'Unlimited' : '无限制'}
                  value={selectedKeyData.creditsLimit || ''}
                  onChange={async (e) => {
                    const limit = e.target.value ? parseFloat(e.target.value) : null
                    const result = await window.api.proxyUpdateApiKey(selectedKeyData.id, { 
                      creditsLimit: limit && limit > 0 ? limit : null 
                    })
                    if (result.success) {
                      setApiKeys(prev => prev.map(k => k.id === selectedKeyData.id ? { ...k, creditsLimit: limit && limit > 0 ? limit : undefined } : k))
                    }
                  }}
                  className="w-32 h-8"
                />
                <span className="text-xs text-muted-foreground">{isEn ? '(0 = unlimited)' : '(0 = 无限制)'}</span>
              </div>

              {/* 用量报警阈值（针对本 key 的 Credits 额度） */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{isEn ? 'Usage Alert:' : '用量报警阈值:'}</span>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  placeholder="90"
                  value={selectedKeyData.usageAlertThreshold != null ? Math.round(selectedKeyData.usageAlertThreshold * 100) : ''}
                  onChange={async (e) => {
                    const pct = e.target.value ? Math.max(0, Math.min(100, parseInt(e.target.value))) : null
                    await updateKeyField(selectedKeyData.id, { usageAlertThreshold: pct != null ? pct / 100 : null })
                  }}
                  className="w-24 h-8"
                />
                <span className="text-xs text-muted-foreground">{isEn ? '% of credits limit (0 = off). Needs credits limit set.' : '% 额度（0 = 关闭）。需先设额度限制'}</span>
              </div>

              {/* QPM / TPM 限制 */}
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">{isEn ? 'QPM Limit:' : 'QPM 限制:'}</span>
                  <Input
                    type="number"
                    min={0}
                    placeholder={isEn ? 'Unlimited' : '无限制'}
                    value={selectedKeyData.qpmLimit || ''}
                    onChange={async (e) => {
                      const v = e.target.value ? parseInt(e.target.value) : 0
                      await updateKeyField(selectedKeyData.id, { qpmLimit: v > 0 ? v : null })
                    }}
                    className="w-28 h-8"
                  />
                  <span className="text-xs text-muted-foreground">{isEn ? 'req/min' : '次/分'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">{isEn ? 'TPM Limit:' : 'TPM 限制:'}</span>
                  <Input
                    type="number"
                    min={0}
                    step={1000}
                    placeholder={isEn ? 'Unlimited' : '无限制'}
                    value={selectedKeyData.tpmLimit || ''}
                    onChange={async (e) => {
                      const v = e.target.value ? parseInt(e.target.value) : 0
                      await updateKeyField(selectedKeyData.id, { tpmLimit: v > 0 ? v : null })
                    }}
                    className="w-32 h-8"
                  />
                  <span className="text-xs text-muted-foreground">{isEn ? 'tokens/min (in+out)' : 'token/分（入+出）'}</span>
                </div>
              </div>

              {/* 模型白名单 */}
              <div className="space-y-1">
                <span className="text-sm text-muted-foreground">{isEn ? 'Allowed Models (whitelist)' : '允许使用的模型（白名单）'}</span>
                <textarea
                  value={allowedModelsText}
                  onChange={(e) => setAllowedModelsText(e.target.value)}
                  onBlur={async () => {
                    const list = allowedModelsText.split(/[\n,]/).map(s => s.trim()).filter(Boolean)
                    await updateKeyField(selectedKeyData.id, { allowedModels: list.length > 0 ? list : null })
                  }}
                  placeholder={isEn
                    ? 'One pattern per line, supports * wildcard (e.g. claude-*). Empty = all models allowed.'
                    : '每行一个，支持 * 通配符（如 claude-*）。留空 = 允许所有模型'}
                  className="w-full h-20 px-3 py-2 text-xs font-mono rounded-md border border-input bg-background"
                />
                {modelHints.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {modelHints.slice(0, 12).map(m => (
                      <button
                        key={m}
                        type="button"
                        className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20"
                        onClick={() => {
                          const cur = allowedModelsText.split(/[\n,]/).map(s => s.trim()).filter(Boolean)
                          if (cur.includes(m)) return
                          setAllowedModelsText([...cur, m].join('\n'))
                        }}
                        title={isEn ? 'Click to add' : '点击添加'}
                      >
                        + {m}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <div className="flex items-center gap-2">
                  <Clock className="h-3 w-3" />
                  <span>{isEn ? 'Created:' : '创建时间:'} {formatDate(selectedKeyData.createdAt)}</span>
                </div>
                {selectedKeyData.lastUsedAt && (
                  <div className="flex items-center gap-2">
                    <Clock className="h-3 w-3" />
                    <span>{isEn ? 'Last used:' : '最后使用:'} {formatDate(selectedKeyData.lastUsedAt)}</span>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 用量详情对话框 */}
      <ApiKeyUsageDialog
        open={showUsageDialog}
        onOpenChange={setShowUsageDialog}
        apiKey={selectedKeyData || null}
      />
    </div>
  )
}
