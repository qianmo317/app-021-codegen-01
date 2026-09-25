import type { ClassEntity, Seat, Student } from '../types'
import { buildSeatIndex, positionScore, specialLabel, visionLabel } from './layout'
import { seatViolationFor } from './fairness'

// ================= 家长查询（只读）：纯逻辑，不做任何写入 =================
// 页面/卡片/导出共用同一份视图模型，保证「屏幕看到的」与「打印/存图的」一致。

export type NeighborRel = '同桌' | '前排' | '后排'
export type NeighborSide = '左' | '右'

export interface Neighbor {
  student: Student
  seat: Seat
  rel: NeighborRel
  side?: NeighborSide
}

export type MarkKind = 'care' | 'seat' | 'fixed' | 'warn'

export interface WeekMark {
  kind: MarkKind
  text: string
}

export interface CumulativeStat {
  throughWeek: number // 统计截至该周（含）
  weeksSeated: number // 实际有座位的周数
  frontRowsCount: number // 前 N 排次数（N = constraints.frontRows）
  avgScore: number // 平均位置分（越低越好）
  rank: number | null // 全班名次（同分并列），未入座则为 null
  rankTotal: number // 参与排名的人数
  tiedWith: number // 并列人数（含自己）
}

export interface StudentWeekReport {
  student: Student
  week: number
  seated: boolean
  seat: Seat | null
  zoneLabel: string // 前/中/后排
  positionTags: string[] // 靠窗 / 靠门 / 靠过道
  neighbors: Neighbor[]
  marks: WeekMark[]
  warnings: WeekMark[]
  stat: CumulativeStat
}

function norm(kw: string): string {
  return kw.trim().toLowerCase()
}

// 按姓名或学号检索；姓名支持包含匹配，重名会返回多条
export function searchStudents(cls: ClassEntity, keyword: string): Student[] {
  const kw = norm(keyword)
  if (!kw) return []
  return cls.students.filter((s) => {
    const name = s.name.trim().toLowerCase()
    const no = (s.studentNo ?? '').trim().toLowerCase()
    return name === kw || no === kw || name.includes(kw) || (no !== '' && no.includes(kw))
  })
}

// 在候选中唯一确定一名学生：学号精确匹配优先，其次姓名精确唯一；
// 重名（且没有可用学号区分）时返回 null，由界面让家长按备注/学号二次选择
export function pickStudent(candidates: Student[], keyword: string): Student | null {
  const kw = norm(keyword)
  if (!kw) return candidates.length === 1 ? candidates[0] : null
  const byNo = candidates.filter((s) => (s.studentNo ?? '').trim().toLowerCase() === kw)
  if (byNo.length === 1) return byNo[0]
  const byName = candidates.filter((s) => s.name.trim().toLowerCase() === kw)
  if (byName.length === 1) return byName[0]
  if (candidates.length === 1 && kw.length > 0) {
    const only = candidates[0]
    const name = only.name.trim().toLowerCase()
    const no = (only.studentNo ?? '').trim().toLowerCase()
    if (name.includes(kw) || no.includes(kw)) return only
  }
  return null
}

function zoneLabelOf(seat: Seat): string {
  if (seat.tags.includes('front')) return '前排'
  if (seat.tags.includes('back')) return '后排'
  return '中排'
}

function positionTagsOf(seat: Seat): string[] {
  const out: string[] = []
  if (seat.tags.includes('window')) out.push('靠窗')
  if (seat.tags.includes('door')) out.push('靠门')
  if (seat.tags.includes('aisle')) out.push('靠过道')
  return out
}

// 周围同学：行列模式 = 左/右同桌 + 前一排/后一排同列；小组模式 = 同组（2×2）成员
export function neighborsOf(cls: ClassEntity, week: number, seat: Seat): Neighbor[] {
  const asg = cls.assignments.find((a) => a.week === week)
  if (!asg) return []
  const idx = buildSeatIndex(cls.seats, cls.layout)
  const studentById = new Map(cls.students.map((s) => [s.id, s]))
  const si = seat.row * cls.layout.cols + seat.col
  const around = new Set<number>(idx.deskmates[si])
  const v = idx.vertical[si]
  if (v.up >= 0) around.add(v.up)
  if (v.down >= 0) around.add(v.down)

  const out: Neighbor[] = []
  for (const ni of around) {
    const otherSeat = cls.seats[ni]
    if (otherSeat.id === seat.id) continue
    const studentId = asg.map[otherSeat.id]
    if (!studentId) continue
    const student = studentById.get(studentId)
    if (!student) continue
    let rel: NeighborRel
    let side: NeighborSide | undefined
    if (otherSeat.row < seat.row) rel = '前排'
    else if (otherSeat.row > seat.row) rel = '后排'
    else {
      rel = '同桌'
      side = otherSeat.col < seat.col ? '左' : '右'
    }
    out.push({ student, seat: otherSeat, rel, side })
  }
  // 稳定顺序：先前后（讲台方向）再左右
  const order: Record<NeighborRel, number> = { 前排: 0, 同桌: 1, 后排: 2 }
  return out.sort((a, b) => order[a.rel] - order[b.rel] || a.seat.row - b.seat.row || a.seat.col - b.seat.col)
}

// 截至 throughWeek（含）的累计统计与全班名次
export function cumulativeStat(cls: ClassEntity, student: Student, throughWeek: number): CumulativeStat {
  const weeks = cls.assignments
    .filter((a) => a.week <= throughWeek)
    .sort((a, b) => a.week - b.week)
  const seatById = new Map(cls.seats.map((s) => [s.id, s]))
  let total = 0
  let weeksSeated = 0
  let frontRowsCount = 0
  for (const asg of weeks) {
    const seatId = Object.entries(asg.map).find(([, sid]) => sid === student.id)?.[0]
    const seat = seatId ? seatById.get(seatId) : undefined
    if (!seat) continue
    weeksSeated += 1
    total += positionScore(seat, cls.layout)
    if (seat.row < cls.constraints.frontRows) frontRowsCount += 1
  }
  const avg = weeksSeated ? total / weeksSeated : 0

  // 全班平均位置分排名（越低越好；保留两位小数后同分并列，竞赛排名 1,2,2,4）
  const peerAvgs = cls.students.map((s) => {
    let t = 0
    let n = 0
    for (const asg of weeks) {
      const sid = Object.entries(asg.map).find(([, id]) => id === s.id)?.[0]
      const seat = sid ? seatById.get(sid) : undefined
      if (!seat) continue
      n += 1
      t += positionScore(seat, cls.layout)
    }
    return { id: s.id, avg: n ? t / n : 0, seated: n > 0 }
  })
  const ranked = peerAvgs
    .filter((p) => p.seated)
    .sort((a, b) => Math.round(a.avg * 100) - Math.round(b.avg * 100) || a.id.localeCompare(b.id))
  let rank: number | null = null
  let tiedWith = 0
  const myKey = Math.round(avg * 100)
  const firstAt = new Map<number, number>() // 分值 → 该分值首次出现的位置（竞赛排名）
  ranked.forEach((p, i) => {
    const key = Math.round(p.avg * 100)
    if (!firstAt.has(key)) firstAt.set(key, i + 1)
    if (key === myKey) {
      tiedWith += 1
      if (p.id === student.id) rank = firstAt.get(key) ?? null
    }
  })
  // 名次应为同分组的首个位置（上面 i+1 在首次遇到同分时即最小，正确）
  return {
    throughWeek: weeks.length ? weeks[weeks.length - 1].week : throughWeek,
    weeksSeated,
    frontRowsCount,
    avgScore: avg,
    rank: weeksSeated ? rank : null,
    rankTotal: ranked.length,
    tiedWith,
  }
}

function careMarks(student: Student): WeekMark[] {
  const out: WeekMark[] = []
  const v = visionLabel(student.vision)
  if (v) out.push({ kind: 'care', text: v })
  const sp = specialLabel(student.special)
  if (sp) out.push({ kind: 'care', text: sp })
  return out
}

export function buildStudentWeekReport(cls: ClassEntity, student: Student, week: number): StudentWeekReport {
  const asg = cls.assignments.find((a) => a.week === week)
  const seatId = asg ? Object.entries(asg.map).find(([, sid]) => sid === student.id)?.[0] : undefined
  const seat = seatId ? cls.seats.find((s) => s.id === seatId) ?? null : null
  const seated = !!seat
  const neighbors = seat ? neighborsOf(cls, week, seat) : []

  const marks: WeekMark[] = []
  const warnings: WeekMark[] = []

  if (seat) {
    marks.push({ kind: 'seat', text: zoneLabelOf(seat) })
    for (const t of positionTagsOf(seat)) marks.push({ kind: 'seat', text: t })
    if (student.fixedSeatId === seat.id) marks.push({ kind: 'fixed', text: '固定座位' })
    for (const m of careMarks(student)) marks.push(m)
    // 与「必须分开」的同学相邻（同桌）→ 醒目标记
    for (const nb of neighbors) {
      if (nb.rel === '同桌' && student.mustApartFrom.includes(nb.student.id)) {
        warnings.push({ kind: 'warn', text: `本周与需分开的「${nb.student.name}」同桌，请向老师核对` })
      }
    }
    // 硬约束未被满足（理论上引擎保证为 0，手工数据异常时兜底提示）
    for (const v of seatViolationFor(cls, student, seat)) {
      warnings.push({ kind: 'warn', text: `${v}（请向老师核对）` })
    }
  }

  return {
    student,
    week,
    seated,
    seat,
    zoneLabel: seat ? zoneLabelOf(seat) : '',
    positionTags: seat ? positionTagsOf(seat) : [],
    neighbors,
    marks,
    warnings,
    stat: cumulativeStat(cls, student, week),
  }
}

export function formatAvg(v: number): string {
  return v.toFixed(2)
}

// 给家长看的名次短语
export function rankPhrase(stat: CumulativeStat): string {
  if (stat.rank == null) return '暂无排名（本周尚未入座）'
  const tie = stat.tiedWith > 1 ? `（与另外 ${stat.tiedWith - 1} 人并列）` : ''
  return `第 ${stat.rank} / ${stat.rankTotal} 名${tie}`
}
