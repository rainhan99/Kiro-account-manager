# 代理抓包 + 缓存命中分析 — 设计文档

- 日期: 2026-06-26
- 状态: 已评审待实现
- 范围: Kiro Proxy（`src/main/proxy/`）后端 + Electron 主进程 IPC + 渲染端 UI

## 1. 背景与目标

排查「Claude Code 等客户端经代理后 prompt cache 命中率低」的问题，目前要靠外挂 Python 抓包脚本（把 `ANTHROPIC_BASE_URL` 指到一个本地透传代理，dump 每个请求 body 再人工 diff）。痛点：

- 外挂脚本只对**非流式**响应能读到 usage；Claude Code 默认流式，看不到 cache 数据。
- 需要改客户端 base url、手动 diff，门槛高。

**关键洞察**：本代理在流式处理里**已经算出**每条请求的 `usage.cacheReadTokens / cacheWriteTokens / inputTokens`（`proxyServer.ts` stream handler 内），所以命中/未命中根本不用解析 SSE——服务端直接就知道。因此把抓包+分析**集成进代理**，比外挂脚本更准、更省事。

### 目标
- 在代理 UI 点按钮，针对**某个 API key** 抓**一段时间**的全量请求，自动停，出**缓存命中分析报告**。
- 报告核心：缓存命中率 + **定位"打掉缓存前缀的那个变化"**（哪条会话、哪一块 system / tools 变了）。

### 非目标（YAGNI）
- 请求重放。
- 通过 `/admin/*` 远程触发抓包（全量 body 远程暴露有隐私风险）。
- 同时抓多个 / 全部 key（已确认只做单 key）。
- 缓存以外的通用流量分析。

## 2. 决策（已与用户确认）

| 决策点 | 选择 |
|---|---|
| 抓取深度 | **全量 body + 分析**（能做字节级 diff、定位具体块） |
| 抓包控制 | **选 key + 设时长（5/15/30/自定义），自动停**；可手动提前停 |
| 落盘位置 | **`userData/captures/`**，本地桌面，不走 admin API、不远程暴露 |
| 主要用途 | **缓存命中分析** |

## 3. 架构与组件

```
渲染端 ProxyPanel ──按钮──▶ CaptureDialog（选 key + 时长）
        │  IPC: proxyCaptureStart / Stop / Status / GetReport / ListCaptures / Delete
        ▼
主进程 index.ts ── 持有自动停 timer，转发 IPC
        │
        ├─▶ ProxyServer.CaptureController   （状态机 + 落盘挂钩）
        │        ▲ 复用现有 AsyncLocalStorage 携带 rawBody / apiKeyId
        │
        └─▶ CaptureAnalyzer（独立模块，纯函数）── 读取会话目录 → 报告 JSON
```

### 3.1 CaptureController（`src/main/proxy/proxyServer.ts`）
一个进程内只允许一个 active 抓包会话。状态：
```ts
interface CaptureState {
  active: boolean
  captureId: string        // 例如 cap-<timestamp>
  apiKeyId: string         // 目标 key（matchedApiKey.id）
  dir: string              // userData/captures/<captureId>
  startedAt: number
  expiresAt: number        // startedAt + durationMs
  count: number            // 已抓条数
  bytes: number            // 已抓字节
  maxCount: number         // 上限保护（默认 2000）
  maxBytes: number         // 上限保护（默认 500MB）
  stoppedReason?: 'manual' | 'timeout' | 'limit'
}
```
方法：`startCapture(opts)` / `stopCapture(reason)` / `getCaptureStatus()` / `private captureIfActive(meta)`。

### 3.2 捕获挂钩（复用 AsyncLocalStorage）
现有 `requestContext: AsyncLocalStorage<{ clientIP: string }>` 扩成：
```ts
private requestContext: AsyncLocalStorage<{ clientIP: string; apiKeyId?: string; rawBody?: string }>
```
- `handleRequest` 进 `run()` 时写入 `clientIP` + `apiKeyId`（来自 `validateApiKey` 结果）。
- `readBody()` 读到 body 后写 `store.rawBody = body`（唯一一处，覆盖所有 handler）。
- `emitResponse(info)`（已含 usage:cacheRead/cacheCreate/input + clientIP）末尾调用 `captureIfActive`：
  - 若 `capture.active && store.apiKeyId === capture.apiKeyId && 未超上限`：
    - 写 `<dir>/req-NNN.json` = `store.rawBody`
    - 写 `<dir>/req-NNN.meta.json` = `{ seq, ts, path, model, clientIP, status, usage:{inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, credits} }`
    - `count++`，`bytes += len`；超上限 → `stopCapture('limit')`
  - 写盘失败只 `proxyLogger.warn`，**绝不阻塞主请求链路**。

> 为什么放 `emitResponse`：它是所有响应（成功/失败/流式/非流式）的统一出口，且此刻 usage 已知；body 通过 ALS 从 `readBody` 携带过来，无需重复读流、无需逐 handler 穿参、并发安全（`fetch`+await 链上 ALS 可靠传播，已在缓存测试中验证）。

### 3.3 自动停 timer
抓包的 duration 计时放在**主进程 index.ts**（`setTimeout(expiresAt-now)`），到点调 `proxyServer.stopCapture('timeout')` 并通知渲染端。理由：proxyServer 不持有 UI/通知通道；且代理重启则 active 失效（state 不持久化），符合预期。

### 3.4 CaptureAnalyzer（`src/main/proxy/captureAnalyzer.ts`，新文件，纯函数）
输入：会话目录（或已读入的 `{body, meta}[]`）。输出：报告对象。可单测。

## 4. 数据模型 — 分析报告

```ts
interface CaptureReport {
  captureId: string
  apiKeyId: string
  window: { startedAt: number; endedAt: number; stoppedReason: string }
  totals: {
    requests: number
    cacheReadTokens: number
    cacheCreateTokens: number      // = cacheWriteTokens 之和
    freshInputTokens: number       // 未命中缓存的 input
    cacheHitRate: number           // cacheRead / (cacheRead + cacheCreate + freshInput)
    credits: number
    byModel: Record<string, { requests: number; cacheReadTokens: number; cacheCreateTokens: number }>
  }
  sessions: SessionAnalysis[]
  breakers: CacheBreaker[]          // 跨全部会话汇总的"缓存断裂点"
  configWarnings: string[]          // 配置类告警
}

interface SessionAnalysis {
  sessionKey: string                // extractSessionHint 结果（或 history 指纹）
  requestSeqs: number[]             // 该会话内的 req 序号，按时间排序
  requests: number
  hits: number                      // cacheRead>0 的条数
  hitRate: number
}

interface CacheBreaker {            // 同一会话内相邻两条、本该命中却未命中
  sessionKey: string
  prevSeq: number
  curSeq: number
  reason: 'system_block_changed' | 'system_blocks_count_changed' | 'tools_changed' | 'cache_control_moved' | 'unknown'
  detail: {
    changedBlockIndex?: number      // system[] 第几块变了
    prevSha?: string
    curSha?: string
    snippet?: string                // 变化片段（截断，最多 ~200 字符）
  }
}
```

### 4.1 分析算法
1. **解析**：读 `req-*.json` + `.meta.json`，按 `meta.ts` 排序。
2. **会话分组**：对每个 body 复用 `extractSessionHint`（同 proxyServer 的取值优先级：`x-claude-code-session-id` 等 header → body 的 `conversation_id`/`prompt_cache_key` 等 → history 前两轮指纹兜底）。归入 `SessionAnalysis`。
3. **总览**：累加 `meta.usage`，算命中率与 byModel。
4. **断裂定位**：每个会话内相邻 `(prev, cur)`，若 `cur.usage.cacheReadTokens === 0` 且 prev 存在（即理应能复用前缀却没命中）：
   - 对 `system[]` 逐块算 `sha256(text)`，与 prev 对比 → 找第一块 sha 不同的，记 `changedBlockIndex/prevSha/curSha/snippet`，`reason='system_block_changed'`。
   - 块数不同 → `system_blocks_count_changed`。
   - system 全同但 `tools` 序列化不同 → `tools_changed`。
   - `cache_control` 标记块位置/数量变化 → `cache_control_moved`。
   - 都没差异 → `unknown`（可能是 TTL 过期或路由到不同账号，报告里注明）。
5. **配置告警**：
   - 某 system 块带 `cache_control` 但其 `sha` 在会话内反复变 → "缓存标记打在了会变的块上"。
   - 大 system（>~1024 token）但完全无 `cache_control` → "未启用缓存标记"。
   - 同会话前缀块顺序不稳。

## 5. UI（渲染端）

- **入口**：`ProxyPanel` 在请求日志区域附近加按钮「抓包分析」。
- **CaptureDialog**（新组件 `src/renderer/src/components/proxy/ProxyCaptureDialog.tsx`）：
  - 未抓包：选 API key（下拉，来自现有 key 列表）+ 时长（5/15/30 分钟 / 自定义分钟）→「开始抓包」。
  - 抓包中：显示目标 key、剩余时间倒计时、已抓条数/字节、「停止」按钮（手动提前停）。
  - 已完成：展示 `CaptureReport`——
    - 顶部卡片：命中率、请求数、cacheRead/create token、credits。
    - 会话列表：每会话命中率。
    - **断裂点列表**（最有用）：每条显示「会话 X，req#a→#b 未命中，原因：system[2] 变化」+ 变化片段，可展开看 prev/cur sha。
    - 配置告警。
    - 「删除本次原始 body」按钮（清理隐私数据，保留报告）。
  - 历史抓包：可列出最近 K 个 captureId，点开看旧报告。

## 6. IPC 接口（preload + index.ts）

| 通道 | 入参 | 出参 |
|---|---|---|
| `proxyCaptureStart` | `{ apiKeyId, durationMs }` | `{ success, captureId? , error? }` |
| `proxyCaptureStop` | `{}` | `{ success }` |
| `proxyCaptureStatus` | `{}` | `CaptureState \| null` |
| `proxyCaptureReport` | `{ captureId }` | `CaptureReport` |
| `proxyCaptureList` | `{}` | `{ captureId, apiKeyId, startedAt, requests }[]` |
| `proxyCaptureDeleteBodies` | `{ captureId }` | `{ success }` |
| 事件 `proxy-capture-stopped` | — | `{ captureId, reason }`（自动停时推送渲染端刷新） |

## 7. 错误处理与边界
- 写盘失败：warn 日志，不阻塞请求；连续失败可自动 `stopCapture('limit')`。
- 上限保护：`maxCount`/`maxBytes` 任一触发即停并在报告标注被截断。
- 代理重启：抓包 state 不持久化 → active 失效；已落盘的 body/report 仍可分析。
- 已有 active 时再点开始：拒绝并提示「已有抓包进行中」。
- key 选择：只列当前配置里的 key；抓包按 `matchedApiKey.id` 过滤（匿名/无 key 流量不计入单 key 抓包）。
- 保留策略：`captures/` 只保留最近 K（默认 10）个会话目录，超出删最旧；停后用户可一键删原始 body。

## 8. 测试
- **CaptureAnalyzer 纯函数单测**（无现成测试框架，新增最小用例或脚本式断言）：
  - 构造同会话两条 body：第二条 system[2] 改一字节 → 报告应出 `system_block_changed, changedBlockIndex=2`。
  - 构造命中场景（usage.cacheReadTokens>0）→ 命中率正确。
  - tools 顺序变 / cache_control 缺失 → 对应 reason / warning。
- **捕获挂钩**：`npm run typecheck` + 手动验证（起代理、抓包、发两条请求、看落盘与报告）。
- 复用本次已验证的事实：`fetch`+await 链上 ALS 可靠传播，流式请求也能拿到 usage 与 body。

## 9. 涉及文件
- 改：`src/main/proxy/proxyServer.ts`（ALS store 扩字段、readBody 写 rawBody、CaptureController、captureIfActive 接入 emitResponse）
- 新：`src/main/proxy/captureAnalyzer.ts`
- 改：`src/main/index.ts`（IPC handlers、自动停 timer、事件推送）
- 改：`src/preload/index.ts` + `index.d.ts`（IPC 类型）
- 新：`src/renderer/src/components/proxy/ProxyCaptureDialog.tsx`
- 改：`src/renderer/src/components/proxy/ProxyPanel.tsx`（入口按钮 + 挂载对话框）
