/**
 * ZephyrSail E2E 测试 HTTP 客户端封装.
 *
 * 提供两个核心调用:
 *   - postAnthropic(body, opts)        → /v1/messages   (Anthropic schema)
 *   - postOpenAI(body, opts)           → /v1/chat/completions (OpenAI schema)
 *
 * 自动:
 *   - 注入 base URL + 鉴权头 (Anthropic 用 x-api-key, OpenAI 用 Authorization Bearer)
 *   - 流式时返回 Response (上层 sse.mjs 进一步消费)
 *   - 非流式时返回 { status, json, text, headers, timing }
 *
 * 不做的事:
 *   - 不做协议级断言 (交给 case 文件)
 *   - 不解析 SSE (交给 sse.mjs)
 */
import { collectAnthropicStream, collectOpenAIStream } from './sse.mjs'

const ANTHROPIC_HEADERS = (token) => {
  const h = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
    'user-agent': 'zephyrsail-e2e/1.0'
  }
  if (token) h['x-api-key'] = token
  return h
}

const OPENAI_HEADERS = (token) => {
  const h = {
    'content-type': 'application/json',
    'user-agent': 'zephyrsail-e2e/1.0'
  }
  if (token) h.authorization = `Bearer ${token}`
  return h
}

export async function postAnthropic(body, { base, token, timeoutMs = 120_000, extraHeaders = {} } = {}) {
  const url = `${stripTrailing(base)}/v1/messages`
  const headers = { ...ANTHROPIC_HEADERS(token), ...extraHeaders }
  const stream = body.stream === true
  const t0 = Date.now()
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort('client-timeout'), timeoutMs)
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctl.signal
    })
  } catch (e) {
    clearTimeout(timer)
    throw new Error(`fetch failed: ${e?.message ?? e}`)
  }

  const tHead = Date.now() - t0
  const respHeaders = collectResponseHeaders(response)

  if (!stream) {
    const text = await response.text().catch(() => '')
    clearTimeout(timer)
    let json
    try { json = text ? JSON.parse(text) : null } catch { json = null }
    return {
      kind: 'non-stream',
      status: response.status,
      headers: respHeaders,
      json,
      text,
      timing: { ttfb: tHead, total: Date.now() - t0 }
    }
  }

  if (response.status !== 200) {
    const text = await response.text().catch(() => '')
    clearTimeout(timer)
    return {
      kind: 'stream-error',
      status: response.status,
      headers: respHeaders,
      text,
      timing: { ttfb: tHead, total: Date.now() - t0 }
    }
  }

  let collected
  try {
    collected = await collectAnthropicStream(response)
  } catch (e) {
    clearTimeout(timer)
    return {
      kind: 'stream-aborted',
      status: response.status,
      headers: respHeaders,
      error: String(e?.message ?? e),
      timing: { ttfb: tHead, total: Date.now() - t0 }
    }
  }
  clearTimeout(timer)
  return {
    kind: 'stream',
    status: response.status,
    headers: respHeaders,
    collected,
    timing: { ttfb: tHead, total: Date.now() - t0 }
  }
}

export async function postOpenAI(body, { base, token, timeoutMs = 120_000, extraHeaders = {} } = {}) {
  const url = `${stripTrailing(base)}/v1/chat/completions`
  const headers = { ...OPENAI_HEADERS(token), ...extraHeaders }
  const stream = body.stream === true
  const t0 = Date.now()
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort('client-timeout'), timeoutMs)
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctl.signal
    })
  } catch (e) {
    clearTimeout(timer)
    throw new Error(`fetch failed: ${e?.message ?? e}`)
  }
  const tHead = Date.now() - t0
  const respHeaders = collectResponseHeaders(response)

  if (!stream) {
    const text = await response.text().catch(() => '')
    clearTimeout(timer)
    let json
    try { json = text ? JSON.parse(text) : null } catch { json = null }
    return {
      kind: 'non-stream',
      status: response.status,
      headers: respHeaders,
      json,
      text,
      timing: { ttfb: tHead, total: Date.now() - t0 }
    }
  }
  if (response.status !== 200) {
    const text = await response.text().catch(() => '')
    clearTimeout(timer)
    return {
      kind: 'stream-error',
      status: response.status,
      headers: respHeaders,
      text,
      timing: { ttfb: tHead, total: Date.now() - t0 }
    }
  }
  let collected
  try {
    collected = await collectOpenAIStream(response)
  } catch (e) {
    clearTimeout(timer)
    return {
      kind: 'stream-aborted',
      status: response.status,
      headers: respHeaders,
      error: String(e?.message ?? e),
      timing: { ttfb: tHead, total: Date.now() - t0 }
    }
  }
  clearTimeout(timer)
  return {
    kind: 'stream',
    status: response.status,
    headers: respHeaders,
    collected,
    timing: { ttfb: tHead, total: Date.now() - t0 }
  }
}

function collectResponseHeaders(response) {
  const out = {}
  for (const [k, v] of response.headers.entries()) out[k.toLowerCase()] = v
  return out
}

function stripTrailing(base) {
  if (!base) return 'http://127.0.0.1:8787'
  return base.endsWith('/') ? base.slice(0, -1) : base
}
