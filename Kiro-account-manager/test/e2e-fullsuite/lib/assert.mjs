/**
 * E2E 测试断言库 (零依赖).
 *
 * 每个断言抛 AssertionError, runner 捕获后标记 case 失败但继续跑剩余 case.
 * AssertionError.path 是失败位置标签 (e.g. "response.status"), 用于报告定位.
 */

export class AssertionError extends Error {
  constructor(message, { path, expected, actual, hint } = {}) {
    super(message)
    this.name = 'AssertionError'
    this.path = path
    this.expected = expected
    this.actual = actual
    this.hint = hint
  }
}

export function assert(cond, message, ctx = {}) {
  if (!cond) throw new AssertionError(message, ctx)
}

export function assertEq(actual, expected, label) {
  if (!deepEq(actual, expected)) {
    throw new AssertionError(`${label} 不匹配`, {
      path: label,
      expected,
      actual
    })
  }
}

export function assertHttp200(result, label = 'response') {
  if (result.status !== 200) {
    throw new AssertionError(`${label}.status 期望 200`, {
      path: `${label}.status`,
      expected: 200,
      actual: result.status,
      hint: snippet(result.text ?? JSON.stringify(result.json ?? {}, null, 2))
    })
  }
}

export function assertStatusIn(result, allowed, label = 'response') {
  if (!allowed.includes(result.status)) {
    throw new AssertionError(`${label}.status 期望属于 ${JSON.stringify(allowed)}`, {
      path: `${label}.status`,
      expected: allowed,
      actual: result.status,
      hint: snippet(result.text ?? JSON.stringify(result.json ?? {}, null, 2))
    })
  }
}

export function assertHasField(obj, fieldPath, label) {
  const segs = fieldPath.split('.')
  let cur = obj
  for (const s of segs) {
    if (cur === null || cur === undefined) {
      throw new AssertionError(`${label}: ${fieldPath} 路径中断在 '${s}' 之前`, { path: fieldPath })
    }
    cur = cur[s]
  }
  if (cur === undefined || cur === null) {
    throw new AssertionError(`${label}: ${fieldPath} 缺失`, { path: fieldPath, actual: cur })
  }
}

export function assertTrue(cond, label) {
  if (!cond) throw new AssertionError(label)
}

export function assertContains(text, substr, label) {
  if (typeof text !== 'string' || !text.includes(substr)) {
    throw new AssertionError(`${label}: 应包含 "${substr}"`, {
      path: label,
      expected: substr,
      actual: snippet(text)
    })
  }
}

export function assertNotContains(text, substr, label) {
  if (typeof text === 'string' && text.includes(substr)) {
    throw new AssertionError(`${label}: 不应包含 "${substr}"`, {
      path: label,
      expected: `不含 ${substr}`,
      actual: snippet(text)
    })
  }
}

/** 简单深比较 (用于 schema 等小对象) */
function deepEq(a, b) {
  if (a === b) return true
  if (a === null || b === null || typeof a !== typeof b) return false
  if (typeof a !== 'object') return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => deepEq(x, b[i]))
  }
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  return ak.every((k) => deepEq(a[k], b[k]))
}

function snippet(s, max = 500) {
  if (typeof s !== 'string') return String(s)
  return s.length > max ? `${s.slice(0, max)}...(+${s.length - max}b)` : s
}
