# 代理抓包 + 缓存命中分析 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在代理 UI 点按钮，针对单个 API key 抓一段时间的全量请求，自动停后输出缓存命中分析报告（含"打掉缓存前缀的具体块"定位）。

**Architecture:** 复用现有 `AsyncLocalStorage` 携带 rawBody/apiKeyId/sessionKey，在统一响应出口 `emitResponse`（已含 usage）做唯一一处落盘；分析交给纯函数模块 `captureAnalyzer.ts`；主进程 `index.ts` 管自动停 timer + IPC + 生成报告；渲染端新增 `ProxyCaptureDialog`。

**Tech Stack:** Electron + TypeScript，Node 24 内置 `node:test`（type-stripping 直跑 `.ts`），React + 现有 `../ui` 组件库。

---

## 测试约定

- 纯函数单测：`node --test <file>`（Node 24 默认 strip-types；若报语法错用 `node --experimental-strip-types --test <file>`）。仅用可擦除 TS 语法（interface/类型注解 OK；禁用 enum/namespace/参数属性）。
- 新增 npm script（Task 0）：`test:unit`。
- 后端/前端任务：`npm run typecheck` 通过 + 手动验证。

## 规格细化（相对 spec）

- `meta.json` 增加 `sessionKey` 字段：抓包落盘时由 proxyServer 用现有 `ProxyServer.extractSessionHint(req, body)` 解析后写入。**分析器只读 meta.sessionKey + body**，不 import proxyServer。
- 分析器对缺失 `sessionKey` 的条目用纯 body 兜底键 `bodySessionKey(body)`。

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/main/proxy/captureAnalyzer.ts` | 纯函数：分析报告（类型、命中率、断裂定位、告警） | 新建 |
| `src/main/proxy/captureAnalyzer.test.ts` | 分析器单测 | 新建 |
| `src/main/proxy/proxyServer.ts` | ALS store 扩字段、readBody 写 rawBody、CaptureController、captureIfActive 接入 emitResponse | 改 |
| `src/main/index.ts` | IPC handlers、自动停 timer、生成报告、事件推送 | 改 |
| `src/preload/index.ts` / `index.d.ts` | IPC 类型桥 | 改 |
| `src/renderer/src/components/proxy/ProxyCaptureDialog.tsx` | 抓包对话框（开始/进行中/报告） | 新建 |
| `src/renderer/src/components/proxy/ProxyPanel.tsx` | 入口按钮 + 挂载对话框 | 改 |

---

## Task 0: 新增单测脚本

**Files:**
- Modify: `package.json`（scripts 段）

- [ ] **Step 1: 加 test:unit 脚本**

在 `package.json` 的 `scripts` 中，`"test:e2e"` 行之前加入：

```json
    "test:unit": "node --test src/main/proxy/captureAnalyzer.test.ts",
```

- [ ] **Step 2: 验证 node 能跑空 test**

Run: `node --test --test-name-pattern=nonexistent src/main/proxy 2>/dev/null; echo "node-test ok"`
Expected: 打印 `node-test ok`（无需有用例，只验证 node --test 可用）

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(test): 加 test:unit (node --test) 脚本"
```

---

## Task 1: 分析器 — 类型与会话分组骨架

**Files:**
- Create: `src/main/proxy/captureAnalyzer.ts`
- Test: `src/main/proxy/captureAnalyzer.test.ts`

- [ ] **Step 1: 写失败测试（会话分组）**

创建 `src/main/proxy/captureAnalyzer.test.ts`：

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test src/main/proxy/captureAnalyzer.test.ts`
Expected: FAIL（`Cannot find module './captureAnalyzer.ts'`）

- [ ] **Step 3: 写最小实现**

创建 `src/main/proxy/captureAnalyzer.ts`：

```ts
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

  return {
    captureId: win.captureId,
    apiKeyId: win.apiKeyId,
    window: { startedAt: win.startedAt, endedAt: win.endedAt, stoppedReason: win.stoppedReason },
    totals: {
      requests: sorted.length,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      freshInputTokens: 0,
      cacheHitRate: 0,
      credits: 0,
      byModel: {}
    },
    sessions,
    breakers: [],
    configWarnings: []
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test src/main/proxy/captureAnalyzer.test.ts`
Expected: PASS（1 test）

- [ ] **Step 5: Commit**

```bash
git add src/main/proxy/captureAnalyzer.ts src/main/proxy/captureAnalyzer.test.ts
git commit -m "feat(analyzer): 抓包分析骨架 + 会话分组"
```

---

## Task 2: 分析器 — 总览与缓存命中率

**Files:**
- Modify: `src/main/proxy/captureAnalyzer.ts`
- Test: `src/main/proxy/captureAnalyzer.test.ts`

- [ ] **Step 1: 写失败测试**

在 `captureAnalyzer.test.ts` 末尾追加：

```ts
test('totals: cache hit rate and byModel', () => {
  const r = analyzeCaptures([
    mk(1, 'S1', { inputTokens: 9000, cacheWriteTokens: 4000, credits: 0.04 }),       // 创建
    mk(2, 'S1', { inputTokens: 9000, cacheReadTokens: 4000, credits: 0.02 }),        // 命中
  ], { captureId: 'c1', apiKeyId: 'k1', startedAt: 0, endedAt: 100, stoppedReason: 'manual' })
  assert.equal(r.totals.requests, 2)
  assert.equal(r.totals.cacheReadTokens, 4000)
  assert.equal(r.totals.cacheCreateTokens, 4000)
  // freshInput = sum(inputTokens) - cacheRead = 18000 - 4000 = 14000
  assert.equal(r.totals.freshInputTokens, 14000)
  // hitRate = read / (read + create + fresh) = 4000 / (4000+4000+14000) = 0.1818...
  assert.ok(Math.abs(r.totals.cacheHitRate - 4000 / 22000) < 1e-9)
  assert.equal(r.totals.byModel['claude-sonnet-4-6'].requests, 2)
  assert.equal(r.totals.byModel['claude-sonnet-4-6'].cacheReadTokens, 4000)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test src/main/proxy/captureAnalyzer.test.ts`
Expected: FAIL（totals.cacheReadTokens 为 0）

- [ ] **Step 3: 实现 totals**

在 `analyzeCaptures` 里，把构造 `return` 前替换 totals 计算。将原先 `return { ... totals: { requests: sorted.length, cacheReadTokens: 0, ... byModel: {} }, ...}` 改为先计算：

```ts
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
```

然后把 `return` 里的 `totals` 改为：

```ts
    totals: { requests: sorted.length, cacheReadTokens, cacheCreateTokens, freshInputTokens, cacheHitRate, credits, byModel },
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test src/main/proxy/captureAnalyzer.test.ts`
Expected: PASS（2 tests）

- [ ] **Step 5: Commit**

```bash
git add src/main/proxy/captureAnalyzer.ts src/main/proxy/captureAnalyzer.test.ts
git commit -m "feat(analyzer): 总览与缓存命中率"
```

---

## Task 3: 分析器 — 缓存断裂定位（system 块 diff）

**Files:**
- Modify: `src/main/proxy/captureAnalyzer.ts`
- Test: `src/main/proxy/captureAnalyzer.test.ts`

- [ ] **Step 1: 写失败测试**

追加到测试文件：

```ts
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

test('breaker: tools changed', () => {
  const prev = sysBody(['AAA'], [{ name: 't1' }])
  const cur = sysBody(['AAA'], [{ name: 't2' }])
  const r = analyzeCaptures([
    mk(1, 'S1', { cacheWriteTokens: 100 }, prev),
    mk(2, 'S1', { cacheReadTokens: 0 }, cur),
  ], { captureId: 'c1', apiKeyId: 'k1', startedAt: 0, endedAt: 100, stoppedReason: 'manual' })
  assert.equal(r.breakers[0].reason, 'tools_changed')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test src/main/proxy/captureAnalyzer.test.ts`
Expected: FAIL（breakers 为空）

- [ ] **Step 3: 实现断裂检测**

在 `captureAnalyzer.ts` 顶部 import 区域下方加 helpers：

```ts
import { createHash } from 'node:crypto'

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
    return { ...base, reason: 'system_blocks_count_changed', detail: { prevSha: String(pb.length), curSha: String(cb.length) } }
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
  return { ...base, reason: 'unknown', detail: {} }
}
```

在 `analyzeCaptures` 里，分组循环之后、构造 `sessions` 时（或之后）补 breakers。在 `return` 前加：

```ts
  const breakers: CacheBreaker[] = []
  for (const list of groups.values()) {
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1], cur = list[i]
      if (cur.meta.usage.cacheReadTokens === 0) {
        breakers.push(detectBreaker(keyOf(cur), prev, cur))
      }
    }
  }
```

并把 `return` 里的 `breakers: []` 改为 `breakers,`。

> 注意：`groups` 内列表已按 ts 排序（来自 sorted 的插入顺序）。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test src/main/proxy/captureAnalyzer.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add src/main/proxy/captureAnalyzer.ts src/main/proxy/captureAnalyzer.test.ts
git commit -m "feat(analyzer): 缓存断裂定位 system块/ tools diff"
```

---

## Task 4: 分析器 — 配置告警

**Files:**
- Modify: `src/main/proxy/captureAnalyzer.ts`
- Test: `src/main/proxy/captureAnalyzer.test.ts`

- [ ] **Step 1: 写失败测试**

追加：

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test src/main/proxy/captureAnalyzer.test.ts`
Expected: FAIL（configWarnings 为空）

- [ ] **Step 3: 实现告警**

在 `analyzeCaptures` 的 `return` 前加：

```ts
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
```

并把 `return` 里的 `configWarnings: []` 改为 `configWarnings,`。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test src/main/proxy/captureAnalyzer.test.ts`
Expected: PASS（6 tests）

- [ ] **Step 5: Commit**

```bash
git add src/main/proxy/captureAnalyzer.ts src/main/proxy/captureAnalyzer.test.ts
git commit -m "feat(analyzer): 配置告警 (cache_control 误用 / 大system未缓存)"
```

---

## Task 5: 后端 — ALS store 扩字段 + readBody 写 rawBody + run() 注入 apiKeyId/sessionKey

**Files:**
- Modify: `src/main/proxy/proxyServer.ts`

- [ ] **Step 1: 扩 ALS store 类型**

找到（在「来源IP」feature 加的）字段：

```ts
  private requestContext: AsyncLocalStorage<{ clientIP: string }> = new AsyncLocalStorage()
```

替换为：

```ts
  private requestContext: AsyncLocalStorage<{ clientIP: string; apiKeyId?: string; rawBody?: string }> = new AsyncLocalStorage()
```

- [ ] **Step 2: run() 注入 apiKeyId + sessionKey**

找到 `handleRequest` 里的：

```ts
      const normalizedClientIP = clientIP.startsWith('::ffff:') ? clientIP.slice(7) : clientIP
      await this.requestContext.run({ clientIP: normalizedClientIP }, async () => {
```

替换为（apiKeyId 来自前面 `validateApiKey` 写到 req 上的 matchedApiKey）：

```ts
      const normalizedClientIP = clientIP.startsWith('::ffff:') ? clientIP.slice(7) : clientIP
      const ctxApiKeyId = (req as unknown as { matchedApiKey?: import('./types').ApiKey }).matchedApiKey?.id
      await this.requestContext.run({ clientIP: normalizedClientIP, apiKeyId: ctxApiKeyId }, async () => {
```

- [ ] **Step 3: readBody 写 rawBody 到 store**

找到 `readBody` 方法（`private async readBody(`）。在它 `return` 拼好的 body 字符串之前，把最终字符串写入 store。定位 readBody 末尾 `return` 语句（返回完整 body 字符串的那行），改为先存再返回，例如：

```ts
    const store = this.requestContext.getStore()
    if (store) store.rawBody = bodyStr
    return bodyStr
```

> 注：`bodyStr` 用 readBody 中实际的最终字符串变量名（读取后拼接完成的那个）。若变量名不同，按实际改；目的是把"交给 JSON.parse 的同一份字符串"存进 store。

- [ ] **Step 4: typecheck**

Run: `npm run typecheck:node`
Expected: 无报错

- [ ] **Step 5: Commit**

```bash
git add src/main/proxy/proxyServer.ts
git commit -m "feat(proxy): ALS 携带 apiKeyId/rawBody，为抓包做准备"
```

---

## Task 6: 后端 — CaptureController + 接入 emitResponse

**Files:**
- Modify: `src/main/proxy/proxyServer.ts`

- [ ] **Step 1: 加 import 与状态字段**

文件顶部 import 区加：

```ts
import path from 'path'
```

（若已存在 `import path` 跳过。）在 `requestContext` 字段下方加：

```ts
  /** 抓包会话状态（进程内单例；不持久化，重启失效） */
  private capture: {
    active: boolean
    captureId: string
    apiKeyId: string
    dir: string
    startedAt: number
    expiresAt: number
    count: number
    bytes: number
    maxCount: number
    maxBytes: number
    stoppedReason?: 'manual' | 'timeout' | 'limit'
  } | null = null
```

- [ ] **Step 2: 加 CaptureController 方法**

在 `emitResponse` 方法上方插入：

```ts
  /** 开始抓包：针对单个 apiKeyId，落盘到 dir。返回 captureId。 */
  startCapture(opts: { apiKeyId: string; durationMs: number; dir: string; maxCount?: number; maxBytes?: number }): { captureId: string } {
    if (this.capture?.active) throw new Error('已有抓包进行中')
    const captureId = `cap-${opts.dir.split(/[\\/]/).pop()}`
    const now = Date.now()
    this.capture = {
      active: true, captureId, apiKeyId: opts.apiKeyId, dir: opts.dir,
      startedAt: now, expiresAt: now + opts.durationMs, count: 0, bytes: 0,
      maxCount: opts.maxCount ?? 2000, maxBytes: opts.maxBytes ?? 500 * 1024 * 1024
    }
    try { fs.mkdirSync(opts.dir, { recursive: true }) } catch { /* ignore */ }
    return { captureId }
  }

  stopCapture(reason: 'manual' | 'timeout' | 'limit'): { captureId: string; count: number } | null {
    if (!this.capture) return null
    this.capture.active = false
    this.capture.stoppedReason = reason
    const out = { captureId: this.capture.captureId, count: this.capture.count }
    return out
  }

  getCaptureStatus(): typeof this.capture {
    return this.capture
  }

  /** 在 emitResponse 内调用：命中目标 key 则落盘 body + meta。绝不抛错。 */
  private captureIfActive(info: Parameters<NonNullable<ProxyServerEvents['onResponse']>>[0]): void {
    const c = this.capture
    if (!c || !c.active) return
    try {
      const store = this.requestContext.getStore()
      const apiKeyId = store?.apiKeyId
      if (apiKeyId !== c.apiKeyId) return
      if (Date.now() > c.expiresAt) return // 到点未停时兜底跳过；实际停由 index.ts timer
      if (c.count >= c.maxCount || c.bytes >= c.maxBytes) { this.stopCapture('limit'); return }
      const body = store?.rawBody ?? ''
      const seq = c.count + 1
      const sessionKey = ProxyServer.extractSessionHint(
        { headers: {} } as unknown as http.IncomingMessage, // header 已无法回取，用 body 兜底
        body ? safeJson(body) : {}
      )
      const meta = {
        seq, ts: Date.now(), path: info.path, model: info.model, clientIP: info.clientIP, status: info.status,
        sessionKey,
        usage: {
          inputTokens: info.inputTokens || 0,
          outputTokens: info.outputTokens || 0,
          cacheReadTokens: info.cacheReadTokens || 0,
          cacheWriteTokens: info.cacheWriteTokens || 0,
          credits: info.credits || 0
        }
      }
      const base = path.join(c.dir, `req-${String(seq).padStart(4, '0')}`)
      fs.writeFileSync(`${base}.json`, body)
      fs.writeFileSync(`${base}.meta.json`, JSON.stringify(meta))
      c.count = seq
      c.bytes += Buffer.byteLength(body)
    } catch (e) {
      proxyLogger.warn('ProxyServer', `capture write failed: ${(e as Error).message}`)
    }
  }
```

> 说明：抓包时 `captureIfActive` 在响应阶段执行，原始请求 header 已不可回取，故 `extractSessionHint` 只传 body（header 维度的 session id 抓不到时由 body/指纹兜底；对 Claude Code 而言 body 里通常有 conversation_id/系统块可指纹）。如需 header 级 session，可在 Task 5 的 run() 里把 `extractSessionHint(req, ...)` 结果一并存入 store——本计划采用 body 兜底以降耦合。

- [ ] **Step 3: 加 safeJson 辅助（文件内顶层函数或私有方法）**

在文件顶部（import 之后、class 之前）加：

```ts
function safeJson(s: string): unknown {
  try { return JSON.parse(s) } catch { return {} }
}
```

- [ ] **Step 4: 在 emitResponse 末尾接入**

找到：

```ts
  private emitResponse(info: Parameters<NonNullable<ProxyServerEvents['onResponse']>>[0]): void {
    this.events.onResponse?.({ ...info, clientIP: info.clientIP ?? this.requestContext.getStore()?.clientIP })
  }
```

替换为：

```ts
  private emitResponse(info: Parameters<NonNullable<ProxyServerEvents['onResponse']>>[0]): void {
    const withIp = { ...info, clientIP: info.clientIP ?? this.requestContext.getStore()?.clientIP }
    this.events.onResponse?.(withIp)
    this.captureIfActive(withIp)
  }
```

- [ ] **Step 5: typecheck**

Run: `npm run typecheck:node`
Expected: 无报错

- [ ] **Step 6: Commit**

```bash
git add src/main/proxy/proxyServer.ts
git commit -m "feat(proxy): CaptureController + emitResponse 落盘抓包"
```

---

## Task 7: 主进程 — IPC + 自动停 timer + 生成报告

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: 顶部 import 分析器 + 路径**

在 `src/main/index.ts` 已有 import 区加：

```ts
import { analyzeCaptures, type CaptureEntry } from './proxy/captureAnalyzer'
import { promises as fsp } from 'fs'
```

（若 `path`/`app` 已 import 则复用。captures 根目录用 `path.join(app.getPath('userData'), 'captures')`。）

- [ ] **Step 2: 加自动停 timer 变量**

在 `index.ts` 顶层（模块作用域，靠近其它 `let xxx` 状态变量处）加：

```ts
let captureTimer: NodeJS.Timeout | null = null
```

- [ ] **Step 3: 加报告读取/生成辅助函数**

在 `index.ts` 合适位置（其它辅助函数附近）加：

```ts
async function buildCaptureReport(captureId: string): Promise<unknown> {
  const dir = path.join(app.getPath('userData'), 'captures', captureId)
  const files = await fsp.readdir(dir).catch(() => [] as string[])
  const metaFiles = files.filter(f => f.endsWith('.meta.json')).sort()
  const entries: CaptureEntry[] = []
  for (const mf of metaFiles) {
    const meta = JSON.parse(await fsp.readFile(path.join(dir, mf), 'utf8'))
    const bodyFile = mf.replace('.meta.json', '.json')
    let body: unknown = {}
    try { body = JSON.parse(await fsp.readFile(path.join(dir, bodyFile), 'utf8')) } catch { body = {} }
    entries.push({ meta, body })
  }
  const st = proxyServer?.getCaptureStatus?.()
  return analyzeCaptures(entries, {
    captureId,
    apiKeyId: st?.apiKeyId || '',
    startedAt: st?.startedAt || 0,
    endedAt: Date.now(),
    stoppedReason: st?.stoppedReason || 'manual'
  })
}

function clearCaptureTimer(): void {
  if (captureTimer) { clearTimeout(captureTimer); captureTimer = null }
}
```

> `proxyServer` 为 index.ts 中已有的 ProxyServer 实例变量名；若实际命名不同（如 `proxy`），按实际替换。

- [ ] **Step 4: 注册 IPC handlers**

在 IPC 注册区（其它 `ipcMain.handle('proxy...')` 附近）加：

```ts
ipcMain.handle('proxy-capture-start', async (_e, opts: { apiKeyId: string; durationMs: number }) => {
  try {
    if (!proxyServer) return { success: false, error: '代理未运行' }
    const captureId = `cap-${Date.now()}`
    const dir = path.join(app.getPath('userData'), 'captures', captureId)
    const r = proxyServer.startCapture({ apiKeyId: opts.apiKeyId, durationMs: opts.durationMs, dir })
    clearCaptureTimer()
    captureTimer = setTimeout(() => {
      proxyServer?.stopCapture('timeout')
      clearCaptureTimer()
      mainWindow?.webContents.send('proxy-capture-stopped', { captureId: r.captureId, reason: 'timeout' })
    }, opts.durationMs)
    return { success: true, captureId: r.captureId }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
})

ipcMain.handle('proxy-capture-stop', async () => {
  const r = proxyServer?.stopCapture('manual')
  clearCaptureTimer()
  return { success: true, ...r }
})

ipcMain.handle('proxy-capture-status', async () => {
  return proxyServer?.getCaptureStatus?.() || null
})

ipcMain.handle('proxy-capture-report', async (_e, { captureId }: { captureId: string }) => {
  return await buildCaptureReport(captureId)
})

ipcMain.handle('proxy-capture-list', async () => {
  const root = path.join(app.getPath('userData'), 'captures')
  const dirs = await fsp.readdir(root).catch(() => [] as string[])
  const out: { captureId: string; requests: number }[] = []
  for (const d of dirs.sort().reverse().slice(0, 10)) {
    const files = await fsp.readdir(path.join(root, d)).catch(() => [] as string[])
    out.push({ captureId: d, requests: files.filter(f => f.endsWith('.meta.json')).length })
  }
  return out
})

ipcMain.handle('proxy-capture-delete-bodies', async (_e, { captureId }: { captureId: string }) => {
  const dir = path.join(app.getPath('userData'), 'captures', captureId)
  const files = await fsp.readdir(dir).catch(() => [] as string[])
  for (const f of files) {
    if (f.endsWith('.json') && !f.endsWith('.meta.json')) {
      await fsp.unlink(path.join(dir, f)).catch(() => {})
    }
  }
  return { success: true }
})
```

> `mainWindow` 为 index.ts 已有的 BrowserWindow 变量名；按实际替换。

- [ ] **Step 5: typecheck**

Run: `npm run typecheck:node`
Expected: 无报错

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(main): 抓包 IPC + 自动停 timer + 报告生成"
```

---

## Task 8: preload — IPC 类型桥

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

- [ ] **Step 1: preload/index.ts 加方法**

在 `src/preload/index.ts` 的 api 对象里（`onProxyResponse` 附近）加：

```ts
  proxyCaptureStart: (opts: { apiKeyId: string; durationMs: number }): Promise<{ success: boolean; captureId?: string; error?: string }> =>
    ipcRenderer.invoke('proxy-capture-start', opts),
  proxyCaptureStop: (): Promise<{ success: boolean; captureId?: string; count?: number }> =>
    ipcRenderer.invoke('proxy-capture-stop'),
  proxyCaptureStatus: (): Promise<unknown> => ipcRenderer.invoke('proxy-capture-status'),
  proxyCaptureReport: (captureId: string): Promise<unknown> => ipcRenderer.invoke('proxy-capture-report', { captureId }),
  proxyCaptureList: (): Promise<{ captureId: string; requests: number }[]> => ipcRenderer.invoke('proxy-capture-list'),
  proxyCaptureDeleteBodies: (captureId: string): Promise<{ success: boolean }> => ipcRenderer.invoke('proxy-capture-delete-bodies', { captureId }),
  onProxyCaptureStopped: (callback: (info: { captureId: string; reason: string }) => void): (() => void) => {
    const handler = (_e: unknown, info: { captureId: string; reason: string }) => callback(info)
    ipcRenderer.on('proxy-capture-stopped', handler as never)
    return () => ipcRenderer.removeListener('proxy-capture-stopped', handler as never)
  },
```

- [ ] **Step 2: preload/index.d.ts 加类型**

在 `src/preload/index.d.ts` 对应 API 接口里（`onProxyResponse` 附近）加：

```ts
  proxyCaptureStart: (opts: { apiKeyId: string; durationMs: number }) => Promise<{ success: boolean; captureId?: string; error?: string }>
  proxyCaptureStop: () => Promise<{ success: boolean; captureId?: string; count?: number }>
  proxyCaptureStatus: () => Promise<unknown>
  proxyCaptureReport: (captureId: string) => Promise<unknown>
  proxyCaptureList: () => Promise<{ captureId: string; requests: number }[]>
  proxyCaptureDeleteBodies: (captureId: string) => Promise<{ success: boolean }>
  onProxyCaptureStopped: (callback: (info: { captureId: string; reason: string }) => void) => () => void
```

- [ ] **Step 3: typecheck**

Run: `npm run typecheck`
Expected: 无报错

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts src/preload/index.d.ts
git commit -m "feat(preload): 抓包 IPC 类型桥"
```

---

## Task 9: 渲染端 — ProxyCaptureDialog

**Files:**
- Create: `src/renderer/src/components/proxy/ProxyCaptureDialog.tsx`

- [ ] **Step 1: 写组件**

创建文件，完整内容：

```tsx
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
  breakers: { sessionKey: string; prevSeq: number; curSeq: number; reason: string; detail: { changedBlockIndex?: number; prevSha?: string; curSha?: string; snippet?: string } }[]
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
  const [status, setStatus] = useState<{ active: boolean; captureId: string; count: number; expiresAt: number } | null>(null)
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
                <div className="text-muted-foreground mt-1">{isEn ? 'Captured' : '已抓'}: {status.count} · {isEn ? 'ends in' : '剩余'} {Math.max(0, Math.round((status.expiresAt - Date.now()) / 1000))}s</div>
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
                        <div>{isEn ? 'session' : '会话'} {b.sessionKey.slice(0, 24)} · req#{b.prevSeq}→#{b.curSeq} · <span className="text-destructive">{b.reason}</span>{b.detail.changedBlockIndex !== undefined ? ` system[${b.detail.changedBlockIndex}]` : ''}</div>
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
```

- [ ] **Step 2: typecheck**

Run: `npm run typecheck:web`
Expected: 无报错（若 `../ui` 未导出 Badge/Card 等，按 `ProxyLogsDialog.tsx` 的同款 import 调整）

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/proxy/ProxyCaptureDialog.tsx
git commit -m "feat(ui): ProxyCaptureDialog 抓包+报告对话框"
```

---

## Task 10: 渲染端 — ProxyPanel 入口按钮 + 挂载

**Files:**
- Modify: `src/renderer/src/components/proxy/ProxyPanel.tsx`

- [ ] **Step 1: import 组件**

在文件顶部 import 区（`import { ProxyLogsDialog } from './ProxyLogsDialog'` 旁）加：

```tsx
import { ProxyCaptureDialog } from './ProxyCaptureDialog'
```

- [ ] **Step 2: 加显隐 state**

在其它 `const [showLogsDialog, setShowLogsDialog] = useState(false)` 附近加：

```tsx
  const [showCaptureDialog, setShowCaptureDialog] = useState(false)
```

- [ ] **Step 3: 加按钮**

在打开请求日志按钮（含 `setShowLogsDialog(true)` 的那个 Button）旁，加一个并列按钮：

```tsx
        <Button variant="outline" size="sm" onClick={() => setShowCaptureDialog(true)}>
          {isEn ? 'Capture' : '抓包分析'}
        </Button>
```

- [ ] **Step 4: 挂载对话框**

在已有 `<ProxyLogsDialog ... />` 之后加（`config.apiKeys` 为现有配置里的 key 列表，按实际字段名取；无名字段时回退 id）：

```tsx
      <ProxyCaptureDialog
        open={showCaptureDialog}
        onOpenChange={setShowCaptureDialog}
        apiKeys={(config.apiKeys || []).map(k => ({ id: k.id, name: k.name }))}
        isEn={isEn}
      />
```

- [ ] **Step 5: typecheck**

Run: `npm run typecheck:web`
Expected: 无报错（若 `config.apiKeys` 元素无 `name` 字段，去掉 `name: k.name` 仅用 id）

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/proxy/ProxyPanel.tsx
git commit -m "feat(ui): ProxyPanel 接入抓包分析入口"
```

---

## Task 11: 整体验证 + 构建

**Files:** 无（验证）

- [ ] **Step 1: 单测 + 全量 typecheck**

Run: `npm run test:unit && npm run typecheck`
Expected: 单测全 PASS；typecheck 无报错

- [ ] **Step 2: 手动验证（dev 跑）**

Run: `npm run dev`（mac 上若 `chcp` 报错，改用 `electron-vite dev`）
手动步骤：
1. 启动代理；
2. 点「抓包分析」→ 选一个 key + 5 分钟 → 开始；
3. 用 curl 经代理对该 key 发**两条相同**的大 system + cache_control 非流式请求（参照 spec 的缓存测试），再发一条把 system 改一字节的；
4. 手动停 → 报告应：命中率合理、出现 1 个 `system_block_changed` 断裂点、定位到正确 system 块。

Expected: 报告正确；`userData/captures/cap-*/` 下有 `req-0001.json/.meta.json` 等。

- [ ] **Step 3: 构建产物**

Run: `npm run build:mac`
Expected: EXIT 0，`dist/` 出新版安装包。

- [ ] **Step 4: 最终提交（如有 dev 期间小修）**

```bash
git add -A src/
git commit -m "chore: 抓包分析联调修正" || echo "无改动"
```

---

## Self-Review 记录

- **Spec 覆盖**：抓取深度(全量 body)=Task5/6；单 key+时长自动停=Task6/7；落盘 userData/captures=Task6/7；命中率=Task2；断裂定位=Task3；配置告警=Task4；UI 按钮+对话框=Task9/10；IPC=Task7/8；保留最近 K + 删 body=Task7。✅
- **类型一致**：`CaptureEntry`/`CaptureMeta`/`CaptureReport` 在 analyzer 定义，index.ts 与 dialog 复用同形（dialog 内 inline 重声明与之字段对齐）。`startCapture`/`stopCapture`/`getCaptureStatus`/`captureIfActive` 命名贯穿 Task6/7。✅
- **占位符**：无 TBD；每步含可执行代码/命令。需按实际变量名(proxyServer/mainWindow/config.apiKeys/readBody 内 body 变量)适配处已显式标注。
