import { describe, expect, it } from 'vitest'
import { generatePlan } from '../src/lib/engine'
import {
  buildStudentWeekReport,
  cumulativeStat,
  neighborsOf,
  pickStudent,
  searchStudents,
} from '../src/lib/query'
import { makeClass, makeStudent } from './helpers'

function planClass(overrides: Parameters<typeof makeClass>[0] = {}) {
  const cls = makeClass({ rows: 4, cols: 6, aisles: [2], weeks: 8, seed: 7, ...overrides })
  cls.assignments = generatePlan(cls)
  return cls
}

function seatOf(cls: ReturnType<typeof makeClass>, week: number, sid: string) {
  const asg = cls.assignments.find((a) => a.week === week)!
  const seatId = Object.entries(asg.map).find(([, id]) => id === sid)![0]
  return cls.seats.find((s) => s.id === seatId)!
}

describe('家长查询 · 检索（姓名 / 学号 / 重名）', () => {
  it('按完整姓名、部分姓名与学号都能命中', () => {
    const cls = makeClass({ students: [] })
    cls.students = [
      makeStudent({ name: '张伟', studentNo: '01' }),
      makeStudent({ name: '张伟', studentNo: '02', note: '转学生' }),
      makeStudent({ name: '李娜', studentNo: '03' }),
    ]
    expect(searchStudents(cls, '张伟').map((s) => s.studentNo)).toEqual(['01', '02'])
    expect(searchStudents(cls, '张').map((s) => s.studentNo)).toEqual(['01', '02'])
    expect(searchStudents(cls, '02').map((s) => s.name)).toEqual(['张伟'])
    expect(searchStudents(cls, '0')).toHaveLength(3)
    expect(searchStudents(cls, '王')).toHaveLength(0)
    expect(searchStudents(cls, '  ')).toHaveLength(0)
  })

  it('学号精确优先；重名且无法区分时返回 null 由界面二次选择', () => {
    const cls = makeClass({ students: [] })
    const a = makeStudent({ name: '张伟', studentNo: '01' })
    const b = makeStudent({ name: '张伟', studentNo: '02' })
    cls.students = [a, b]
    expect(pickStudent(searchStudents(cls, '张伟'), '张伟')).toBeNull()
    expect(pickStudent(searchStudents(cls, '01'), '01')).toBe(a)
    expect(pickStudent(searchStudents(cls, '张伟'), '02')).toBe(b)
    const single = makeClass({ students: [] })
    single.students = [makeStudent({ name: '王小明', studentNo: '09' })]
    expect(pickStudent(searchStudents(single, '王小'), '王小')).toBe(single.students[0])
  })
})

describe('家长查询 · 座位与周围同学', () => {
  it('报告给出第几排第几列、前/中/后排与靠门窗过道标记', () => {
    const cls = planClass()
    const s = cls.students[0]
    const seat = seatOf(cls, 1, s.id)
    const rep = buildStudentWeekReport(cls, s, 1)
    expect(rep.seated).toBe(true)
    expect(rep.seat).toEqual(seat)
    expect(rep).toHaveProperty('week', 1)
    // 第 1 排必为前排
    if (seat.row === 0) expect(rep.zoneLabel).toBe('前排')
  })

  it('周围同学 = 左右同桌（隔过道不算）+ 前后同列', () => {
    const cls = planClass()
    const s = cls.students[0]
    const seat = seatOf(cls, 1, s.id)
    const nbs = neighborsOf(cls, 1, seat)
    const asg = cls.assignments.find((a) => a.week === 1)!
    // 手动枚举期望
    const expected = new Set<string>()
    const { cols, aisles } = cls.layout
    const trySeat = (r: number, c: number, rel: string) => {
      if (r < 0 || c < 0 || r >= cls.layout.rows || c >= cols) return
      // 隔过道不算同桌
      if (rel === '同桌') {
        if (c === seat.col - 1 && aisles.includes(seat.col - 1)) return
        if (c === seat.col + 1 && aisles.includes(seat.col)) return
      }
      const id = asg.map[`r${r}c${c}`]
      if (id && id !== s.id) expected.add(id)
    }
    trySeat(seat.row - 1, seat.col, '前')
    trySeat(seat.row + 1, seat.col, '后')
    trySeat(seat.row, seat.col - 1, '同桌')
    trySeat(seat.row, seat.col + 1, '同桌')
    const got = new Set(nbs.map((n) => n.student.id))
    expect(got).toEqual(expected)
    for (const n of nbs) {
      if (n.seat.row < seat.row) expect(n.rel).toBe('前排')
      if (n.seat.row > seat.row) expect(n.rel).toBe('后排')
      if (n.seat.row === seat.row) {
        expect(n.rel).toBe('同桌')
        expect(n.side).toBe(n.seat.col < seat.col ? '左' : '右')
      }
    }
  })

  it('小组围坐模式下同组 2×2 成员互为周围同学', () => {
    const cls = planClass({ mode: 'groups', aisles: [] })
    const s = cls.students[0]
    const seat = seatOf(cls, 1, s.id)
    const nbs = neighborsOf(cls, 1, seat)
    expect(nbs.length).toBeGreaterThan(0)
    for (const n of nbs) {
      expect(Math.abs(n.seat.row - seat.row)).toBeLessThanOrEqual(1)
      expect(Math.abs(n.seat.col - seat.col)).toBeLessThanOrEqual(1)
    }
  })

  it('本周标记含固定座位与照顾类型；与必须分开者同桌时给出警告', () => {
    const cls = planClass()
    // 固定座位：取第 1 周坐在其 fixedSeatId 上的学生，构造一个固定座位标记
    const asg1 = cls.assignments.find((a) => a.week === 1)!
    const stFixed = cls.students[0]
    const fixedSeat = cls.seats.find((x) => asg1.map[x.id] === stFixed.id)!
    stFixed.fixedSeatId = fixedSeat.id
    const repFixed = buildStudentWeekReport(cls, stFixed, 1)
    expect(repFixed.seat!.id).toBe(fixedSeat.id)
    expect(repFixed.marks.map((m) => m.text)).toContain('固定座位')

    // 构造一对必须分开、且第 2 周恰好同桌的学生
    const asg = cls.assignments.find((a) => a.week === 2)!
    let warned = false
    for (const st of cls.students) {
      const seat = cls.seats.find((x) => asg.map[x.id] === st.id)
      if (!seat) continue
      const right = cls.seats.find(
        (x) => x.row === seat.row && x.col === seat.col + 1 && !cls.layout.aisles.includes(seat.col),
      )
      const otherId = right ? asg.map[right.id] : undefined
      if (otherId) {
        st.mustApartFrom = [otherId]
        const rep2 = buildStudentWeekReport(cls, st, 2)
        expect(rep2.warnings.some((w) => w.text.includes('需分开'))).toBe(true)
        warned = true
        break
      }
    }
    expect(warned).toBe(true)
  })
})

describe('家长查询 · 累计统计与全班名次', () => {
  it('前排次数随周次累计，平均位置分非负且可排序', () => {
    const cls = planClass()
    const s = cls.students[0]
    const r1 = cumulativeStat(cls, s, 1)
    const rAll = cumulativeStat(cls, s, 8)
    expect(r1.weeksSeated).toBe(1)
    expect(rAll.weeksSeated).toBe(8)
    expect(rAll.frontRowsCount).toBeGreaterThanOrEqual(r1.frontRowsCount)
    expect(rAll.avgScore).toBeGreaterThanOrEqual(0)
    expect(rAll.rank).not.toBeNull()
    expect(rAll.rankTotal).toBe(cls.students.length)
  })

  it('全班名次：平均位置分越低名次越靠前，同分并列（竞赛排名 1,2,2,4）', () => {
    const cls = planClass()
    const stats = cls.students.map((s) => ({ s, st: cumulativeStat(cls, s, 8) }))
    const byRank = [...stats].sort((a, b) => a.st.rank! - b.st.rank!)
    // 名次按四舍五入到两位后的平均位置分排序
    for (let i = 1; i < byRank.length; i++) {
      expect(Math.round(byRank[i - 1].st.avgScore * 100)).toBeLessThanOrEqual(
        Math.round(byRank[i].st.avgScore * 100),
      )
    }
    // 平均位置分四舍五入相同的人，名次必须一致（并列）
    const rounded = new Map<number, number[]>()
    for (const { st } of stats) {
      const key = Math.round(st.avgScore * 100)
      rounded.set(key, [...(rounded.get(key) ?? []), st.rank!])
    }
    for (const ranks of rounded.values()) {
      expect(new Set(ranks).size).toBe(1)
    }
    // 第 1 名存在
    expect(byRank[0].st.rank).toBe(1)
  })

  it('截至周与排名人数随选择周次变化（只统计该周及以前）', () => {
    const cls = planClass()
    const s = cls.students[0]
    const r3 = cumulativeStat(cls, s, 3)
    expect(r3.throughWeek).toBe(3)
    expect(r3.rankTotal).toBe(cls.students.length)
  })
})
