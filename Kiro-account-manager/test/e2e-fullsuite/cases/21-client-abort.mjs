/**
 * CASE 21: 客户端启动 stream 后中途 abort, 反代不应挂死.
 *
 * 验证 AbortController 链路: 反代取消 upstream, 释放账号回池, 后续请求仍正常.
 */
import { postAnthropic } from '../lib/http.mjs'
import { DEFAULT_ANTHROPIC_MODEL, SMALL_MAX_TOKENS } from '../lib/fixtures.mjs'
import { assertHttp200, assertTrue } from '../lib/assert.mjs'

export default {
  id: 'CASE-21-client-abort',
  title: '客户端 abort 中途断流, 反代不挂死',
  tags: ['anthropic', 'abort', 'robustness'],
  run: async ({ base, token, log }) => {
    const url = `${base.replace(/\/$/, '')}/v1/messages`
    const ctl = new AbortController()
    setTimeout(() => ctl.abort('client-abort-test'), 200)
    let aborted = false
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
          'authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          model: DEFAULT_ANTHROPIC_MODEL,
          max_tokens: 1024,
          stream: true,
          messages: [{ role: 'user', content: '请详细列出 1 到 100 的所有质数, 每个加详细解释.' }]
        }),
        signal: ctl.signal
      })
      try { await r.text() } catch { aborted = true }
    } catch { aborted = true }
    log(`first request aborted=${aborted}`)

    await new Promise(r => setTimeout(r, 1000))
    const result = await postAnthropic({
      model: DEFAULT_ANTHROPIC_MODEL,
      max_tokens: SMALL_MAX_TOKENS,
      stream: true,
      messages: [{ role: 'user', content: '简单回答, 反代是否仍正常工作?' }]
    }, { base, token })
    log(`second request status=${result.status} kind=${result.kind}`)
    assertHttp200(result, 'post-abort.response')
    const textBlock = (result.collected?.message?.content ?? []).find(b => b.type === 'text')
    assertTrue(textBlock !== undefined, 'abort 后反代应仍能正常处理新请求')
  }
}
