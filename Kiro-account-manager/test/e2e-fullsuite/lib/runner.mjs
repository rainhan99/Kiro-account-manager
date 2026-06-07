/**
 * E2E 测试 runner: 顺序执行 case, 收集结果, 输出控制台 + JSON 报告.
 *
 * Case 接口:
 *   export default {
 *     id: 'CASE-XX',
 *     title: '描述',
 *     tags: ['anthropic', 'tool', ...],     // 用于 --only <tag> 过滤
 *     run: async (ctx) => { ... }            // ctx = { base, token, log, http }
 *   }
 *
 *   run() 内部用 lib/assert.mjs 抛 AssertionError 即视为失败.
 *   抛非 AssertionError 异常视为 case 内部错误 (区别于断言失败).
 */
import { AssertionError } from './assert.mjs'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

export async function runCases(cases, { base, token, only, reportDir }) {
  const filtered = filterCases(cases, only)
  const total = filtered.length
  console.log(`\n${color('cyan', '═'.repeat(70))}`)
  console.log(`${color('cyan', ` Kiro 反代 E2E 测试 — 共 ${total} 个用例`)}`)
  console.log(`${color('cyan', ` base=${base}  token=${redactToken(token)}`)}`)
  if (only) console.log(`${color('cyan', ` filter: ${only}`)}`)
  console.log(`${color('cyan', '═'.repeat(70))}\n`)

  const results = []
  let pass = 0
  let fail = 0
  let error = 0
  const t0 = Date.now()

  for (let i = 0; i < total; i++) {
    const c = filtered[i]
    const idx = `[${i + 1}/${total}]`
    process.stdout.write(`${color('dim', idx)} ${color('bright', c.id)} ${c.title} ... `)
    const tCase = Date.now()
    const logs = []
    const ctx = {
      base,
      token,
      log: (msg) => logs.push(msg)
    }
    let status, error_, durationMs
    try {
      await c.run(ctx)
      status = 'pass'
      pass++
    } catch (e) {
      if (e instanceof AssertionError) {
        status = 'fail'
        fail++
      } else {
        status = 'error'
        error++
      }
      error_ = {
        type: e?.constructor?.name ?? 'Error',
        message: e?.message ?? String(e),
        path: e?.path,
        expected: e?.expected,
        actual: e?.actual,
        hint: e?.hint,
        stack: e?.stack?.split('\n').slice(0, 6).join('\n')
      }
    }
    durationMs = Date.now() - tCase
    const tag = status === 'pass' ? color('green', 'PASS') : status === 'fail' ? color('red', 'FAIL') : color('magenta', 'ERROR')
    console.log(`${tag} ${color('dim', `(${durationMs}ms)`)}`)
    if (error_) {
      console.log(color('red', `   ✗ ${error_.message}`))
      if (error_.path) console.log(color('dim', `     path: ${error_.path}`))
      if (error_.expected !== undefined) console.log(color('dim', `     expected: ${pretty(error_.expected, 200)}`))
      if (error_.actual !== undefined) console.log(color('dim', `     actual:   ${pretty(error_.actual, 200)}`))
      if (error_.hint) console.log(color('dim', `     hint:     ${pretty(error_.hint, 400)}`))
      if (status === 'error' && error_.stack) console.log(color('dim', `     stack:\n${indentStack(error_.stack)}`))
    }
    if (logs.length > 0 && (status !== 'pass' || process.env.ZS_VERBOSE === '1')) {
      for (const line of logs) console.log(color('dim', `   · ${line}`))
    }
    results.push({
      id: c.id,
      title: c.title,
      tags: c.tags ?? [],
      status,
      durationMs,
      error: error_,
      logs
    })
  }

  const totalMs = Date.now() - t0
  console.log(`\n${color('cyan', '─'.repeat(70))}`)
  console.log(
    ` ${color('green', `${pass} 通过`)}  ` +
    ` ${color(fail > 0 ? 'red' : 'dim', `${fail} 失败`)}  ` +
    ` ${color(error > 0 ? 'magenta' : 'dim', `${error} 错误`)}  ` +
    ` ${color('dim', `总耗时 ${totalMs}ms`)}`
  )
  console.log(`${color('cyan', '─'.repeat(70))}\n`)

  if (reportDir) {
    const reportPath = join(reportDir, 'last-report.json')
    try {
      mkdirSync(dirname(reportPath), { recursive: true })
      writeFileSync(reportPath, JSON.stringify({
        capturedAt: new Date().toISOString(),
        base,
        only: only ?? null,
        summary: { total, pass, fail, error, durationMs: totalMs },
        results
      }, null, 2), 'utf-8')
      console.log(color('dim', ` 详细报告: ${reportPath}\n`))
    } catch (e) {
      console.log(color('red', ` 写报告失败: ${e?.message ?? e}\n`))
    }
  }

  return { pass, fail, error, total, results }
}

function filterCases(cases, only) {
  if (!only || only.length === 0) return cases
  const tokens = only.split(',').map((s) => s.trim()).filter(Boolean)
  return cases.filter((c) => {
    return tokens.some((t) => {
      if (c.id === t) return true
      if (c.id.toLowerCase().includes(t.toLowerCase())) return true
      if ((c.tags ?? []).some((tag) => tag.toLowerCase() === t.toLowerCase())) return true
      return false
    })
  })
}

function pretty(v, max = 200) {
  if (typeof v === 'string') {
    return v.length > max ? `${v.slice(0, max)}...(+${v.length - max}b)` : v
  }
  try {
    const s = JSON.stringify(v)
    return s.length > max ? `${s.slice(0, max)}...(+${s.length - max}b)` : s
  } catch {
    return String(v)
  }
}

function indentStack(s) {
  return s.split('\n').map((l) => `       ${l}`).join('\n')
}

function redactToken(t) {
  if (!t || t.length < 8) return t ?? '(none)'
  return `${t.slice(0, 4)}…${t.slice(-4)}`
}

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
}
function color(name, s) {
  if (process.env.NO_COLOR || !process.stdout.isTTY) return s
  const code = COLORS[name]
  if (!code) return s
  return `${code}${s}${COLORS.reset}`
}
