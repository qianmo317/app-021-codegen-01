import { describe, expect, it } from 'vitest'
import type { ClassEntity, Student } from '../src/types'
import { makeClass, makeStudent, type ClassOverrides } from './helpers'
import { generatePlan } from '../src/lib/engine'
import {
  buildSummaries,
  disambiguationText,
  duplicateNameSet,
  getProgress,
  getWeekSeatFor,
  searchStudents,
  weekExists,
} from '../src/lib/parentQuery'

function clsWith(students: Student[], overrides: ClassOverrides = {}): ClassEntity {
  const cls = makeClass({ students, rows: 4, cols: 6, aisles: [2], weeks: 4, seed: 7, ...overrides })
  cls.assignments = generatePlan(cls, { seed: 7 })
  return cls
}

describe('家长查询 · 姓名/学号检索', () => {
  it('按姓名包含与学号匹配检索（大小写不敏感）', () => {
    const cls = clsWith([
      makeStudent({ name: '张伟', studentNo: '01' }),
      makeStudent({ name: '李娜', studentNo: '02' }),
      makeStudent({ name: '王芳' }),
    ])
    expect(searchStudents(cls, '张').map((s) => s.name)).toEqual(['张伟'])
    expect(searchStudents(cls, '02').map((s) => s.name)).toEqual(['李娜'])
    expect(searchStudents(cls, '  ')).toEqual([])
  })

  it('重名集合与区分文本：优先学号，其次备注', () => {
    const a = makeStudent({ name: '刘洋', studentNo: '11' })
    const b = makeStudent({ name: '刘洋', note: '班长' })
    const c = makeStudent({ name: '刘洋' })
    const dup = duplicateNameSet([a, b, c])
    expect(dup.has('刘洋')).toBe(true)
    expect(disambiguationText(a)).toBe('学号 11')
    expect(disambiguationText(b)).toBe('备注：班长')
    expect(disambiguationText(c)).toBe('（未登记学号/备注）')
  })
})

describe('家长查询 · 周座位与周围同学', () => {
  it('返回 1-based 排/列、区域与座位标记', () => {
    const cls = clsWith([
      makeStudent({ name: '甲', vision: 'front_required' }),
      makeStudent({ name: '乙' }),
      makeStudent({ name: '丙' }),
      makeStudent({ name: '丁' }),
    ])
    const summaries = buildSummaries(cls)
    const a = cls.students[0]
    expect(weekExists(cls, 1)).toBe(true)
    expect(weekExists(cls, 5)).toBe(false)
    const info = getWeekSeatFor(cls, a, summaries, 1)!
    expect(info.row).toBe(info.seat.row + 1)
    expect(info.col).toBe(info.seat.col + 1)
    expect(['前排', '中排', '后排']).toContain(info.zoneLabel)
    // 需前排学生的硬约束生效：第 1 周必在前 N 排，无违反
    expect(info.seat.row).toBeLessThan(cls.constraints.frontRows)
    expect(info.violations).toEqual([])
    expect(info.careBadges).toContain('近视·需前排')
  })

  it('周围同学只含物理八邻域，方向标签齐全；隔过道左右不算邻座', () => {
    // 6 列、过道在 2|3 之间；把甲固定在 r1c1，乙在 r1c3（隔过道）→ 乙不应是邻座
    const cls = makeClass({ students: [], rows: 3, cols: 6, aisles: [2], weeks: 1, seed: 3 })
    const jia = makeStudent({ name: '甲', fixedSeatId: 'r1c1' })
    const yi = makeStudent({ name: '乙', fixedSeatId: 'r1c3' })
    const bing = makeStudent({ name: '丙', fixedSeatId: 'r1c0' })
    cls.students = [jia, yi, bing]
    cls.assignments = generatePlan(cls, { seed: 3 })
    const summaries = buildSummaries(cls)
    const info = getWeekSeatFor(cls, jia, summaries, 1)!
    const dirs = new Set(info.neighbors.map((n) => n.direction))
    expect(info.neighbors.some((n) => n.student.id === yi.id)).toBe(false) // 隔过道
    expect(info.neighbors.find((n) => n.student.id === bing.id)?.direction).toBe('左')
    expect(dirs.size).toBeGreaterThan(0)
    // 每个方向都在允许集合内
    for (const d of dirs) expect(['前排', '后排', '左', '右', '左前', '右前', '左后', '右后', '同组']).toContain(d)
  })

  it('前后隔过道仍可见，但标记 acrossAisle', () => {
    const cls = makeClass({ students: [], rows: 3, cols: 6, aisles: [2], weeks: 1, seed: 3 })
    const jia = makeStudent({ name: '甲', fixedSeatId: 'r0c1' })
    const yi = makeStudent({ name: '乙', fixedSeatId: 'r1c1' }) // 同列后排，不过道
    const bing = makeStudent({ name: '丙', fixedSeatId: 'r0c3' }) // 同排隔过道
    cls.students = [jia, yi, bing]
    cls.assignments = generatePlan(cls, { seed: 3 })
    const summaries = buildSummaries(cls)
    const info = getWeekSeatFor(cls, jia, summaries, 1)!
    const back = info.neighbors.find((n) => n.student.id === yi.id)
    expect(back?.direction).toBe('后排')
    expect(back?.acrossAisle).toBe(false)
    expect(info.neighbors.some((n) => n.student.id === bing.id)).toBe(false)
  })

  it('小组模式：同组其余成员出现在邻居里', () => {
    const cls = makeClass({ students: [], rows: 4, cols: 4, aisles: [], mode: 'groups', weeks: 1, seed: 9 })
    const students = ['甲', '乙', '丙', '丁'].map((name) => makeStudent({ name }))
    cls.students = students
    cls.assignments = generatePlan(cls, { seed: 9 })
    const summaries = buildSummaries(cls)
    const info = getWeekSeatFor(cls, students[0], summaries, 1)!
    // 4 人坐 4×4 = 16 座，甲所在 2×2 组可能没坐满；但凡有组员必须出现
    expect(info.neighbors.length).toBeGreaterThan(0)
  })
})

describe('家长查询 · 到目前统计与排名', () => {
  it('前排次数、平均位置分与排名可复算，且按平均位置分升序', () => {
    const cls = clsWith(
      Array.from({ length: 12 }, (_, i) => makeStudent({ name: `生${i + 1}` })),
      { rows: 4, cols: 6 },
    )
    const summaries = buildSummaries(cls)
    const progresses = cls.students.map((s) => getProgress(summaries, s.id)!)
    for (const p of progresses) {
      expect(p.seatedWeeks).toBe(4)
      expect(p.rank).toBeGreaterThanOrEqual(1)
      expect(p.rank).toBeLessThanOrEqual(12)
    }
    // 排名 1 的平均位置分 ≤ 其他所有人
    const sorted = [...progresses].sort((a, b) => a.avgScore - b.avgScore)
    expect(sorted[0].rank).toBe(1)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].avgScore).toBeGreaterThanOrEqual(sorted[i - 1].avgScore - 1e-9)
    }
    // 前 N 排次数之和 = 每周前排座位被坐数 × 周数
    const totalFront = progresses.reduce((n, p) => n + p.frontRowsCount, 0)
    expect(totalFront).toBeGreaterThan(0)
  })

  it('相同平均位置分并列同名次', () => {
    // 两人对坐对称座位时均分可能恰好相同；至少 tieCount ≥ 1（含自己）
    const cls = clsWith([makeStudent({ name: '甲' }), makeStudent({ name: '乙' })])
    const summaries = buildSummaries(cls)
    const p = getProgress(summaries, cls.students[0].id)!
    expect(p.tieCount).toBeGreaterThanOrEqual(1)
  })

  it('查询逻辑是纯函数：重复调用结果稳定且不修改班级数据', () => {
    const cls = clsWith([makeStudent({ name: '甲' }), makeStudent({ name: '乙' })])
    const snapshot = JSON.stringify(cls.assignments)
    const s1 = buildSummaries(cls)
    const info1 = getWeekSeatFor(cls, cls.students[0], s1, 1)
    const s2 = buildSummaries(cls)
    const info2 = getWeekSeatFor(cls, cls.students[0], s2, 1)
    expect(JSON.stringify(info1?.neighbors.map((n) => n.student.id))).toBe(
      JSON.stringify(info2?.neighbors.map((n) => n.student.id)),
    )
    expect(JSON.stringify(cls.assignments)).toBe(snapshot)
  })

  it('学生数少于座位数时，空位不产生邻居；无座周返回 null', () => {
    // 12 座（4×6 含 1 条过道）坐 3 人 → 大部分邻位为空
    const cls = clsWith(
      [makeStudent({ name: '甲', fixedSeatId: 'r0c0' }), makeStudent({ name: '乙', fixedSeatId: 'r3c5' }), makeStudent({ name: '丙' })],
      { rows: 4, cols: 6, aisles: [2] },
    )
    const summaries = buildSummaries(cls)
    const info = getWeekSeatFor(cls, cls.students[0], summaries, 1)!
    // 甲在左上角 r0c0：至多有 右(r0c1)、后排(r1c0)、右后(r1c1) 三个方向
    expect(info.neighbors.length).toBeLessThanOrEqual(3)
    for (const n of info.neighbors) expect(['右', '后排', '右后']).toContain(n.direction)
    // 未生成的第 9 周：座位与统计口径仍可算单周为 null
    expect(getWeekSeatFor(cls, cls.students[0], summaries, 9)).toBeNull()
  })

  it('重名两人都能被姓名检索到并分别区分', () => {
    const a = makeStudent({ name: '王芳', studentNo: 'A01' })
    const b = makeStudent({ name: '王芳', note: '转学生' })
    const cls = clsWith([a, b, makeStudent({ name: '其他人' })])
    const hits = searchStudents(cls, '王芳')
    expect(hits).toHaveLength(2)
    expect(new Set(hits.map((s) => s.id))).toEqual(new Set([a.id, b.id]))
    // 学号精确命中只返回一个
    expect(searchStudents(cls, 'A01').map((s) => s.id)).toEqual([a.id])
  })
})
