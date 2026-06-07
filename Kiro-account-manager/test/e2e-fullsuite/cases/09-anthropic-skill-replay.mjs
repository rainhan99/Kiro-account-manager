/**
 * CASE 09: 完整复刻 Claude Code Skill 调用的真实结构.
 *
 * 这是上轮 invalid_argument 的最小可复现路径, 浓缩自 last-anthropic-request.json:
 *   - system 是 array (Claude Code 风格 + cache_control)
 *   - tools 中含 Skill 工具
 *   - messages 序列:
 *     [0] user (多 text block: system-reminder + 用户问题)
 *     [1] assistant (thinking + text + Skill tool_use)
 *     [2] user (tool_result + text:Base directory for this skill...)
 *
 * 通过条件:
 *   - HTTP 200 (不能是 502)
 *   - 不出现 invalid_argument
 *   - 至少有一个 text 或 tool_use block 在响应中
 */
import { postAnthropic } from '../lib/http.mjs'
import {
  DEFAULT_ANTHROPIC_MODEL,
  SMALL_MAX_TOKENS,
  SYSTEM_CLAUDECODE_STYLE,
  TOOL_SKILL
} from '../lib/fixtures.mjs'
import { assertHttp200, assertTrue, assertNotContains } from '../lib/assert.mjs'

export default {
  id: 'CASE-09-skill-replay',
  title: 'Claude Code Skill 工具调用真实结构复刻 (修复 502 后的回归测试)',
  tags: ['anthropic', 'skill', 'multi-turn', 'regression', 'stream'],
  run: async ({ base, token, log }) => {
    const toolUseId = 'toolu_e2e_test_skill1'
    const result = await postAnthropic({
      model: DEFAULT_ANTHROPIC_MODEL,
      max_tokens: SMALL_MAX_TOKENS,
      stream: true,
      system: SYSTEM_CLAUDECODE_STYLE,
      tools: [TOOL_SKILL],
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: '<system-reminder>\nThe following skills are available for use with the Skill tool:\n- find-skills: 帮助发现可用的 skills\n</system-reminder>\n'
            },
            { type: 'text', text: '使用 find-skills 查询有哪些技能' }
          ]
        },
        {
          role: 'assistant',
          content: [
            {
              type: 'thinking',
              thinking: '用户请求列出可用 skills, 我应该调用 find-skills.',
              signature: 'sig_e2e_test_truncated'
            },
            { type: 'text', text: '我来使用 `find-skills` 技能查询.' },
            {
              type: 'tool_use',
              id: toolUseId,
              name: 'Skill',
              input: { skill: 'find-skills', args: '列出所有可用的技能' }
            }
          ]
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: toolUseId,
              content: 'Launching skill: find-skills'
            },
            {
              type: 'text',
              text: 'Base directory for this skill: ~/.claude/skills/find-skills\n\n# Find Skills\nThis skill helps you discover skills.\n\nPlease summarize this skill in one sentence.'
            }
          ]
        }
      ]
    }, { base, token })
    log(`status=${result.status} kind=${result.kind} total=${result.timing?.total}ms`)
    if (result.kind === 'stream-error') {
      log(`upstream err body: ${result.text?.slice(0, 500)}`)
      assertNotContains(result.text ?? '', 'invalid_argument', 'response.error')
      assertNotContains(result.text ?? '', 'an internal error occurred', 'response.error')
    }
    assertHttp200(result, 'skill-replay.response')
    const blocks = result.collected?.message?.content ?? []
    const hasText = blocks.some((b) => b.type === 'text' && b.text?.length > 0)
    const hasTool = blocks.some((b) => b.type === 'tool_use')
    assertTrue(hasText || hasTool, '响应应至少包含 text 或 tool_use')
    log(`blocks=${blocks.map((b) => b.type).join(',')}`)
  }
}
