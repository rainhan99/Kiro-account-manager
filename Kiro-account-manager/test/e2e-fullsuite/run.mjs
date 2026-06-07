#!/usr/bin/env node
/**
 * Kiro 反代 E2E 全套测试入口.
 *
 * 用法:
 *   node test/e2e-fullsuite/run.mjs                              # 跑全部
 *   node test/e2e-fullsuite/run.mjs --only CASE-07               # 跑指定 ID
 *   node test/e2e-fullsuite/run.mjs --only anthropic,tool        # 跑指定 tag (任意匹配)
 *   node test/e2e-fullsuite/run.mjs --base http://127.0.0.1:8787 # 自定义反代地址
 *   node test/e2e-fullsuite/run.mjs --token <token>              # 指定鉴权 token
 *
 * 环境变量:
 *   ZS_BASE   反代地址 (默认 http://127.0.0.1:8787)
 *   ZS_TOKEN  鉴权 token (Anthropic x-api-key / OpenAI Bearer)
 *   ZS_ONLY   case 过滤 (等价 --only)
 *   ZS_VERBOSE=1  打印通过 case 的 log
 *   NO_COLOR=1    禁用彩色输出
 *
 * 退出码:
 *   0 — 全部通过
 *   1 — 有 case 失败/错误
 *   2 — 启动参数错误 / 无法连接到反代
 */
import { readdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { runCases } from './lib/runner.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function main() {
  const argv = parseArgs(process.argv.slice(2))
  if (argv.help) {
    printHelp()
    process.exit(0)
  }
  const base = argv.base ?? process.env.ZS_BASE ?? 'http://127.0.0.1:8787'
  const token = argv.token ?? process.env.ZS_TOKEN ?? ''
  const only = argv.only ?? process.env.ZS_ONLY ?? ''

  // 预检: 反代是否在线
  try {
    const r = await fetch(`${stripTrailing(base)}/health`, {
      signal: AbortSignal.timeout(3000)
    })
    if (r.status !== 200) {
      console.error(`✗ 反代 health 检查失败: HTTP ${r.status} at ${base}/health`)
      process.exit(2)
    }
  } catch (e) {
    console.error(`✗ 无法连接反代 ${base}/health: ${e?.message ?? e}`)
    console.error(`  请先启动 Kiro Account Manager (开发模式: pnpm dev / npm run dev)`)
    process.exit(2)
  }

  // 加载所有 case
  const cases = await loadCases(join(__dirname, 'cases'))
  if (cases.length === 0) {
    console.error('✗ 未发现任何 case 文件 (test/e2e-fullsuite/cases/*.mjs)')
    process.exit(2)
  }

  const summary = await runCases(cases, {
    base,
    token,
    only,
    reportDir: __dirname
  })

  process.exit(summary.fail + summary.error > 0 ? 1 : 0)
}

async function loadCases(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith('.mjs') && !e.name.startsWith('_'))
    .map((e) => e.name)
    .sort()
  const cases = []
  for (const f of files) {
    const fileUrl = pathToFileURL(resolve(dir, f)).href
    const mod = await import(fileUrl)
    const c = mod.default
    if (!c || typeof c.run !== 'function' || !c.id) {
      console.error(`! 跳过格式不符的 case 文件: ${f}`)
      continue
    }
    cases.push(c)
  }
  return cases
}

function parseArgs(args) {
  const out = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--help' || a === '-h') {
      out.help = true
      continue
    }
    if (a === '--base') {
      out.base = args[++i]
      continue
    }
    if (a === '--token') {
      out.token = args[++i]
      continue
    }
    if (a === '--only') {
      out.only = args[++i]
      continue
    }
    if (a.startsWith('--base=')) {
      out.base = a.slice('--base='.length)
      continue
    }
    if (a.startsWith('--token=')) {
      out.token = a.slice('--token='.length)
      continue
    }
    if (a.startsWith('--only=')) {
      out.only = a.slice('--only='.length)
      continue
    }
    console.error(`! 未知参数: ${a} (用 --help 查看用法)`)
    process.exit(2)
  }
  return out
}

function printHelp() {
  console.log(`Kiro 反代 E2E 全套测试

用法:
  node test/e2e-fullsuite/run.mjs [选项]

选项:
  --base <url>     反代地址 (默认 http://127.0.0.1:8787, 也可用 ZS_BASE 环境变量)
  --token <token>  鉴权 token (也可用 ZS_TOKEN 环境变量)
  --only <filter>  只跑指定 case (按 ID 或 tag 匹配, 多个用逗号: --only anthropic,tool)
  --help           显示本帮助

示例:
  ZS_TOKEN=xxx node test/e2e-fullsuite/run.mjs
  node test/e2e-fullsuite/run.mjs --token xxx --only CASE-07-multi-turn-tool-result-and-text
  node test/e2e-fullsuite/run.mjs --only regression
`)
}

function stripTrailing(s) {
  return s.endsWith('/') ? s.slice(0, -1) : s
}

main().catch((e) => {
  console.error(`✗ runner 内部错误: ${e?.stack ?? e}`)
  process.exit(2)
})
