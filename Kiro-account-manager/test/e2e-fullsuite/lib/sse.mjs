/**
 * SSE 流增量解析器 (零依赖, Node 20+ ReadableStream).
 *
 * 同时支持两种事件流:
 *   - Anthropic 风格: `event: <name>\ndata: <json>\n\n` (双换行分帧)
 *   - OpenAI 风格:    `data: <json>\n\n` 或终止符 `data: [DONE]\n\n`
 *
 * 给上层暴露一个统一的 async iterator, 产出 { event, data } 对象:
 *   - event: 字符串 (Anthropic event 名) 或 'message' (OpenAI 默认)
 *   - data:  原始 data 段字符串. 上层自行 JSON.parse / 特殊处理 [DONE]
 *
 * 边界处理:
 *   - 跨 chunk 分帧: 内部 buffer 累积, 找到 `\n\n` 才 yield
 *   - 心跳/注释行 `:keepalive` 直接跳过 (Anthropic ping 走 event:ping 路径)
 *   - 多行 data: 按 SSE 规范用 `\n` 拼接 (实际此项目几乎不会出现, 防御性保留)
 */
export async function* parseSseStream(response) {
  if (!response.body) throw new Error('response.body is null (SSE 解析需要 ReadableStream)')
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // 以 \n\n 切分完整 event
      let sep
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        const parsed = parseSingleEvent(rawEvent)
        if (parsed) yield parsed
      }
    }
    // flush 尾巴
    buffer += decoder.decode()
    const tail = buffer.trim()
    if (tail.length > 0) {
      const parsed = parseSingleEvent(tail)
      if (parsed) yield parsed
    }
  } finally {
    reader.releaseLock()
  }
}

function parseSingleEvent(rawEvent) {
  let event = 'message'
  const dataLines = []
  for (const line of rawEvent.split('\n')) {
    if (line.length === 0) continue
    if (line.startsWith(':')) continue // 注释行 (心跳)
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
      continue
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
      continue
    }
    // 其它 SSE 字段 (id:, retry:) 忽略
  }
  if (dataLines.length === 0) return null
  return { event, data: dataLines.join('\n') }
}

/**
 * 把 Anthropic SSE 流收集成一个聚合对象, 方便断言.
 * 不阻塞: 收完整流后返回, 中间任何 error event 会立即抛出错误并附带原始 payload.
 *
 * 返回结构:
 * {
 *   events: [{ event, data: parsedJsonOrString }, ...]   // 原始事件序列
 *   message: { id, model, content: [...] }                // 复刻一个 Anthropic non-streaming 风格 message
 *   usage: { input_tokens, output_tokens, cache_read_input_tokens, ... }
 *   stopReason: string | null
 *   raw: string                                            // 完整 SSE raw (调试用)
 * }
 */
export async function collectAnthropicStream(response) {
  const events = []
  const contentBlocks = []     // index -> block 累积
  const blocksOrder = []       // 按 index 顺序
  let message = null
  let usage = null
  let stopReason = null
  let raw = ''

  for await (const ev of parseSseStream(response)) {
    raw += `event: ${ev.event}\ndata: ${ev.data}\n\n`
    let data
    try {
      data = JSON.parse(ev.data)
    } catch {
      events.push({ event: ev.event, data: ev.data })
      continue
    }
    events.push({ event: ev.event, data })

    if (ev.event === 'error') {
      const errMsg = data?.error?.message ?? JSON.stringify(data)
      throw new Error(`Anthropic stream error: ${errMsg}`)
    }
    if (ev.event === 'message_start') {
      message = { ...data.message, content: [] }
      usage = data.message?.usage ?? null
      continue
    }
    if (ev.event === 'content_block_start') {
      const idx = data.index
      contentBlocks[idx] = { ...data.content_block }
      // tool_use.input 起手是 {} 等 input_json_delta 累积
      if (contentBlocks[idx]?.type === 'tool_use') {
        contentBlocks[idx]._partial_json = ''
      }
      // text / thinking 起手都是空字符串待 delta 累积
      if (contentBlocks[idx]?.type === 'text') contentBlocks[idx].text = ''
      if (contentBlocks[idx]?.type === 'thinking') contentBlocks[idx].thinking = ''
      if (!blocksOrder.includes(idx)) blocksOrder.push(idx)
      continue
    }
    if (ev.event === 'content_block_delta') {
      const idx = data.index
      const block = contentBlocks[idx]
      if (!block) continue
      const d = data.delta
      if (d?.type === 'text_delta' && typeof d.text === 'string') block.text += d.text
      else if (d?.type === 'thinking_delta' && typeof d.thinking === 'string') block.thinking += d.thinking
      else if (d?.type === 'signature_delta' && typeof d.signature === 'string') block.signature = (block.signature ?? '') + d.signature
      else if (d?.type === 'input_json_delta' && typeof d.partial_json === 'string') block._partial_json += d.partial_json
      continue
    }
    if (ev.event === 'content_block_stop') {
      const idx = data.index
      const block = contentBlocks[idx]
      if (block?.type === 'tool_use') {
        try {
          block.input = block._partial_json && block._partial_json.length > 0 ? JSON.parse(block._partial_json) : {}
        } catch {
          block.input = {}
        }
        delete block._partial_json
      }
      continue
    }
    if (ev.event === 'message_delta') {
      if (data.delta?.stop_reason) stopReason = data.delta.stop_reason
      if (data.usage) usage = { ...(usage ?? {}), ...data.usage }
      continue
    }
    if (ev.event === 'message_stop') {
      // 终止
      continue
    }
    // ping / 其它 — 忽略
  }

  if (message) {
    for (const idx of blocksOrder) {
      const b = contentBlocks[idx]
      if (b) message.content.push(b)
    }
    if (stopReason) message.stop_reason = stopReason
    if (usage) message.usage = usage
  }

  return { events, message, usage, stopReason, raw }
}

/**
 * 把 OpenAI SSE 流收集成 chat.completion 风格对象.
 *
 * 累积:
 *   - choices[0].message.content      ← delta.content
 *   - choices[0].message.reasoning_content ← delta.reasoning_content (DeepSeek/Qwen3 风格)
 *   - choices[0].message.reasoning_text    ← delta.reasoning_text (Vercel AI SDK / opencode)
 *   - choices[0].message.reasoning_opaque  ← delta.reasoning_opaque (Anthropic thinking signature)
 *   - choices[0].message.providerMetadata.openaiCompatible.{signature,thinking,provider}
 *   - choices[0].message.tool_calls[i].id / function.{name,arguments} ← delta.tool_calls[i]
 *   - choices[0].finish_reason
 *   - usage (最终帧)
 */
export async function collectOpenAIStream(response) {
  const events = []
  let id = ''
  let model = ''
  let created = 0
  let content = ''
  let reasoningContent = ''
  let reasoningText = ''
  let reasoningOpaque = ''
  let providerMetadata = null
  const toolCalls = []       // index -> { id, type, function:{ name, arguments } }
  let finishReason = null
  let usage = null
  let role = null
  let raw = ''
  let done = false

  for await (const ev of parseSseStream(response)) {
    raw += `data: ${ev.data}\n\n`
    if (ev.data === '[DONE]') {
      done = true
      break
    }
    let data
    try {
      data = JSON.parse(ev.data)
    } catch {
      events.push({ raw: ev.data })
      continue
    }
    events.push(data)
    if (data.id && !id) id = data.id
    if (data.model && !model) model = data.model
    if (typeof data.created === 'number' && created === 0) created = data.created
    if (data.usage) usage = data.usage
    const choice = data.choices?.[0]
    if (!choice) continue
    const delta = choice.delta ?? {}
    if (delta.role && !role) role = delta.role
    if (typeof delta.content === 'string') content += delta.content
    if (typeof delta.reasoning_content === 'string') reasoningContent += delta.reasoning_content
    if (typeof delta.reasoning_text === 'string') reasoningText += delta.reasoning_text
    if (typeof delta.reasoning_opaque === 'string') reasoningOpaque += delta.reasoning_opaque
    if (delta.providerMetadata && typeof delta.providerMetadata === 'object') {
      // 深合并 — Anthropic thinking signature 在 reasoning-end 一次性发出, 但防御性支持多帧累积
      providerMetadata = providerMetadata ?? {}
      for (const [provider, fields] of Object.entries(delta.providerMetadata)) {
        if (!fields || typeof fields !== 'object') continue
        providerMetadata[provider] = { ...(providerMetadata[provider] ?? {}), ...fields }
      }
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0
        const slot = toolCalls[idx] ?? { id: '', type: 'function', function: { name: '', arguments: '' } }
        if (tc.id) slot.id = tc.id
        if (tc.type) slot.type = tc.type
        if (tc.function?.name) slot.function.name = tc.function.name
        if (typeof tc.function?.arguments === 'string') slot.function.arguments += tc.function.arguments
        toolCalls[idx] = slot
      }
    }
    if (choice.finish_reason) finishReason = choice.finish_reason
  }

  const message = { role: role ?? 'assistant', content: content.length > 0 ? content : null }
  if (reasoningContent.length > 0) message.reasoning_content = reasoningContent
  if (reasoningText.length > 0) message.reasoning_text = reasoningText
  if (reasoningOpaque.length > 0) message.reasoning_opaque = reasoningOpaque
  if (providerMetadata) message.providerMetadata = providerMetadata
  const compactToolCalls = toolCalls.filter(Boolean)
  if (compactToolCalls.length > 0) message.tool_calls = compactToolCalls

  return {
    completion: {
      id,
      object: 'chat.completion',
      created,
      model,
      choices: [{ index: 0, message, finish_reason: finishReason }],
      usage
    },
    events,
    raw,
    done
  }
}
