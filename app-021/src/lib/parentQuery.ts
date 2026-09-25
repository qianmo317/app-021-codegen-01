import type { ClassEntity, Seat, Student, StudentId } from '../types'
import { positionScore, specialLabel, visionLabel } from './layout'
import { seatViolationFor } from './fairness'

// ================= 家长只读查询：纯函数，不读取/写入任何存储 =================
// 供「家长查询页」与「查询小图（PNG）」共用；所有数据都来自调用方传入的班级实体。

export type Direction = '前排' | '后排' | '左' | '右' | '左前' | '右前' | '左后' | '右后' | '同组'

export interface NeighborInfo {
  student: Student
  seat: Seat
  direction: Direction
  acrossAisle: boolean // 与该生之间隔着过道
}

export interface WeekSeatInfo {
  week: number
  seat: Seat
  row: number // 1-based 排
  col: number // 1-based 列
  zoneLabel: string // 前排 / 中排 / 后排
  seatTags: string[] // 座位本身的特殊标记（靠窗 / 靠门 / 靠过道 / 讲台侧）
  careBadges: string[] // 学生本人的特殊标记（近视·需前排 / 听力 / 行动不便 / T 分层）
  violations: string[] // 本周硬约束未满足项（正常情况为空；手工改动历史数据时可能出现）
  neighbors: NeighborInfo[]
}

export interface StudentProgress {
  seatedWeeks: number // 已排周次中该生有座位的周数（统计口径）
  frontRowsCount: number // 前 N 排次数（N = constraints.frontRows）
  frontCount: number // 前 1/3 行次数
  middleCount: number
  backCount: number
  avgScore: number // 平均位置分（越低越好）
  totalScore: number
  rank: number // 平均位置分班级排名（1 = 位置最好；并列同名次）
  tieCount: number // 与该生并列的人数（含自己）
  classSize: number // 参与统计的人数
}

export interface StudentSummary {
  student: Student
  weekSeat: Map<number, Seat>
  totalScore: number
  seatedWeeks: number
  frontRowsCount: number
  frontCount: number
  middleCount: number
  backCount: number
}

// ---------- 姓名/学号检索 ----------

export function searchStudents(cls: ClassEntity, keyword: string): Student[] {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return []
  return cls.students.filter(
    (s) =>
      s.name.toLowerCase().includes(kw) ||
      (s.studentNo != null && s.studentNo.trim().toLowerCase().includes(kw)),
  )
}

// 该班是否存在重名
export function duplicateNameSet(students: Student[]): Set<string> {
  const counter = new Map<string, number>()
  for (const s of students) counter.set(s.name, (counter.get(s.name) ?? 0) + 1)
  return new Set([...counter].filter(([, n]) => n > 1).map(([name]) => name))
}

// 重名学生的区分标签：优先学号，其次备注
export function disambiguationText(s: Student): string {
  if (s.studentNo?.trim()) return `学号 ${s.studentNo.trim()}`
  if (s.note?.trim()) return `备注：${s.note.trim()}`
  return '（未登记学号/备注）'
}

// ---------- 预统计 ----------

export function buildSummaries(cls: ClassEntity): Map<StudentId, StudentSummary> {
  const frontThird = Math.max(1, Math.ceil(cls.layout.rows / 3))
  const seatById = new Map(cls.seats.map((s) => [s.id, s]))
  const map = new Map<StudentId, StudentSummary>(
    cls.students.map((s) => [
      s.id,
      {
        student: s,
        weekSeat: new Map(),
        totalScore: 0,
        seatedWeeks: 0,
        frontRowsCount: 0,
        frontCount: 0,
        middleCount: 0,
        backCount: 0,
      },
    ]),
  )
  for (const asg of [...cls.assignments].sort((a, b) => a.week - b.week)) {
    for (const [seatId, studentId] of Object.entries(asg.map)) {
      const seat = seatById.get(seatId)
      const sum = map.get(studentId)
      if (!seat || !sum) continue
      sum.weekSeat.set(asg.week, seat)
      sum.seatedWeeks += 1
      sum.totalScore += positionScore(seat, cls.layout)
      if (seat.row < cls.constraints.frontRows) sum.frontRowsCount += 1
      if (seat.row < frontThird) sum.frontCount += 1
      else if (seat.row >= cls.layout.rows - frontThird) sum.backCount += 1
      else sum.middleCount += 1
    }
  }
  return map
}

// ---------- 学生个体统计（含班级排名） ----------

export function getProgress(summaries: Map<StudentId, StudentSummary>, studentId: StudentId): StudentProgress | null {
  const cur = summaries.get(studentId)
  if (!cur || cur.seatedWeeks === 0) return null
  // 平均位置分相同 = 并列（dense ranking，同名次）
  const ranked = [...summaries.values()]
    .filter((s) => s.seatedWeeks > 0)
    .map((s) => ({ s, avg: s.totalScore / s.seatedWeeks }))
    .sort((a, b) => a.avg - b.avg)
  const avg = cur.totalScore / cur.seatedWeeks
  const EPS = 1e-9
  const rank = ranked.filter((r) => r.avg < avg - EPS).length + 1
  const tieCount = ranked.filter((r) => Math.abs(r.avg - avg) <= EPS).length
  return {
    seatedWeeks: cur.seatedWeeks,
    frontRowsCount: cur.frontRowsCount,
    frontCount: cur.frontCount,
    middleCount: cur.middleCount,
    backCount: cur.backCount,
    avgScore: avg,
    totalScore: cur.totalScore,
    rank,
    tieCount,
    classSize: ranked.length,
  }
}

// ---------- 某周座位详情（含周围同学） ----------

// dr = -1 讲台方向（前排），dc = -1 左（靠窗侧）
const DIR_OF: Record<number, Direction> = {
  [-11]: '左前',
  [-10]: '前排',
  [-9]: '右前',
  [-1]: '左',
  [1]: '右',
  [9]: '左后',
  [10]: '后排',
  [11]: '右后',
}

const NEIGHBOR_ORDER: Record<Direction, number> = {
  前排: 1,
  后排: 2,
  左: 3,
  右: 4,
  左前: 5,
  右前: 6,
  左后: 7,
  右后: 8,
  同组: 9,
}

function seatAt(cls: ClassEntity, row: number, col: number): Seat | undefined {
  if (row < 0 || col < 0 || row >= cls.layout.rows || col >= cls.layout.cols) return undefined
  return cls.seats.find((s) => s.row === row && s.col === col)
}

// 两列之间是否隔着过道
function aisleBetween(cls: ClassEntity, colA: number, colB: number): boolean {
  const lo = Math.min(colA, colB)
  const hi = Math.max(colA, colB)
  for (let c = lo; c < hi; c++) if (cls.layout.aisles.includes(c)) return true
  return false
}

export function zoneLabelOf(seat: Seat): string {
  if (seat.tags.includes('front')) return '前排'
  if (seat.tags.includes('back')) return '后排'
  return '中排'
}

export function careBadgesOf(student: Student): string[] {
  const out: string[] = []
  const v = visionLabel(student.vision)
  if (v) out.push(v)
  const sp = specialLabel(student.special)
  if (sp) out.push(sp)
  if (student.tier) out.push(`学习分层 T${student.tier}`)
  if (student.fixedSeatId) out.push('固定座位')
  return out
}

function seatTagsOf(seat: Seat): string[] {
  const out: string[] = []
  if (seat.tags.includes('window')) out.push('靠窗')
  if (seat.tags.includes('door')) out.push('靠门')
  if (seat.tags.includes('aisle')) out.push('靠过道')
  if (seat.tags.includes('stage_side')) out.push('讲台侧')
  return out
}

export function getWeekSeatFor(
  cls: ClassEntity,
  student: Student,
  summaries: Map<StudentId, StudentSummary>,
  week: number,
): WeekSeatInfo | null {
  const sum = summaries.get(student.id)
  const seat = sum?.weekSeat.get(week)
  if (!sum || !seat) return null

  const asg = cls.assignments.find((a) => a.week === week)
  if (!asg) return null

  const studentById = new Map(cls.students.map((s) => [s.id, s]))
  // studentId → 邻居（同组标签优先于物理方位标签，故用 Map 去重）
  const found = new Map<StudentId, NeighborInfo>()
  const groupTag = seat.tags.find((t) => t.startsWith('group:'))

  const pushNeighbor = (otherId: StudentId | undefined, otherSeat: Seat, direction: Direction) => {
    if (!otherId || otherId === student.id) return
    const other = studentById.get(otherId)
    if (!other) return
    const info: NeighborInfo = {
      student: other,
      seat: otherSeat,
      direction,
      acrossAisle: aisleBetween(cls, seat.col, otherSeat.col),
    }
    const existing = found.get(otherId)
    // 同组关系优先；否则保留先加入的物理方位
    if (!existing || (direction === '同组' && existing.direction !== '同组')) found.set(otherId, info)
  }

  // 小组围坐：同组其余成员互为「同桌」，物理相邻给出方位，其余记「同组」
  if (cls.layout.mode === 'groups' && groupTag) {
    for (const otherSeat of cls.seats) {
      if (!otherSeat.tags.some((t) => t === groupTag)) continue
      if (otherSeat.id === seat.id) continue
      const code = (otherSeat.row - seat.row) * 10 + (otherSeat.col - seat.col)
      pushNeighbor(asg.map[otherSeat.id], otherSeat, DIR_OF[code] ?? '同组')
    }
  }

  // 八邻域
  const offsets: Array<[number, number]> = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ]
  for (const [dr, dc] of offsets) {
    const otherSeat = seatAt(cls, seat.row + dr, seat.col + dc)
    if (!otherSeat) continue
    // 行列模式下左右隔过道不算邻座；前后、斜向即使隔过道也仍能看到，标记 acrossAisle
    if (cls.layout.mode === 'rows' && dr === 0 && aisleBetween(cls, seat.col, otherSeat.col)) continue
    const inSameGroup = !!groupTag && otherSeat.tags.some((t) => t === groupTag)
    pushNeighbor(asg.map[otherSeat.id], otherSeat, inSameGroup ? '同组' : (DIR_OF[dr * 10 + dc] ?? '同组'))
  }

  const neighbors = [...found.values()].sort(
    (a, b) => NEIGHBOR_ORDER[a.direction] - NEIGHBOR_ORDER[b.direction] || a.seat.col - b.seat.col,
  )

  return {
    week,
    seat,
    row: seat.row + 1,
    col: seat.col + 1,
    zoneLabel: zoneLabelOf(seat),
    seatTags: seatTagsOf(seat),
    careBadges: careBadgesOf(student),
    violations: seatViolationFor(cls, student, seat),
    neighbors,
  }
}

// 该周全班是否已生成
export function weekExists(cls: ClassEntity, week: number): boolean {
  return cls.assignments.some((a) => a.week === week)
}
