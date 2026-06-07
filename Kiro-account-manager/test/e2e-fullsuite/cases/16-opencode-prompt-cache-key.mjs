/**
 * CASE 16: opencode 的 promptCacheKey 字段 → ZephyrSail session 粘性入口.
 *
 * 背景:
 *   - opencode `transform.ts` `options()` 在 OpenAI / Azure / setCacheKey 路径下
 *     把 sessionID 写到 body.promptCacheKey
 *   - ZephyrSail SessionResolver 链路最高优先级是 body.prompt_cache_key / promptCacheKey
 *     → 同一 promptCacheKey 应该路由到同一 sessionKey, 复用 conversation/sessionUuid
 *
 * 验证:
 *   - body.promptCacheKey 字段不被 ZephyrSail 拒绝 (schema 接受)
 *   - 用同一 promptCacheKey 连发 2 次, 都 200 OK 且响应正常
 *   - (session 粘性的内部 sessionUuid 不在 SSE 暴露, 仅做 happy-path 校验)
 *
 * 通过条件:
 *   - 两次请求都 HTTP 200
 *   - 两次响应 message.content 非空
 */
import { postOpenAI } from '../lib/http.mjs'
import { DEFAULT_OPENAI_MODEL, SMALL_MAX_TOKENS } from '../lib/fixtures.mjs'
import { assertHttp200, assertTrue } from '../lib/assert.mjs'

export default {
  id: 'CASE-16-opencode-prompt-cache-key-sticky',
  title: 'opencode: promptCacheKey body 字段 → session 粘性入口不报错',
  tags: ['openai', 'opencode', 'session', 'stream'],
  run: async ({ base, token, log }) => {
    // 用一个稳定的 promptCacheKey, 模拟 opencode sessionID
    const cacheKey = `e2e-opencode-${Date.now().toString(36)}`
    log(`promptCacheKey=${cacheKey}`)

    const send = async (turn) => postOpenAI({
      model: DEFAULT_OPENAI_MODEL,
      max_tokens: SMALL_MAX_TOKENS,
      stream: true,
      promptCacheKey: cacheKey,
      messages: [
        { role: 'system', content: '你是简洁的助手, 一句话回答.' },
        { role: 'user', content: turn === 1 ? '请说一句问候语.' : '再用同样风格说一句感谢.' }
      ]
    }, { base, token })

    const r1 = await send(1)
    log(`turn1: status=${r1.status} kind=${r1.kind}`)
    if (r1.kind === 'stream-error') log(`turn1 err=${r1.text?.slice(0, 200)}`)
    assertHttp200(r1, 'opencode-cachekey.turn1')
    const c1 = r1.collected.completion.choices[0].message.content
    assertTrue(typeof c1 === 'string' && c1.length > 0, 'turn1 content 应非空')
    log(`turn1 content=${c1.slice(0, 60)}...`)

    const r2 = await send(2)
    log(`turn2: status=${r2.status} kind=${r2.kind}`)
    if (r2.kind === 'stream-error') log(`turn2 err=${r2.text?.slice(0, 200)}`)
    assertHttp200(r2, 'opencode-cachekey.turn2')
    const c2 = r2.collected.completion.choices[0].message.content
    assertTrue(typeof c2 === 'string' && c2.length > 0, 'turn2 content 应非空')
    log(`turn2 content=${c2.slice(0, 60)}...`)
  }
}
