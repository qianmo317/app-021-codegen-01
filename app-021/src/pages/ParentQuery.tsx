import { useMemo, useState } from 'react'
import { Link } from '../router'
import { useStore } from '../store'
import type { ClassEntity, Seat, Student } from '../types'
import {
  buildSummaries,
  disambiguationText,
  duplicateNameSet,
  getProgress,
  getWeekSeatFor,
  searchStudents,
  weekExists,
} from '../lib/parentQuery'
import { downloadParentCard } from '../lib/parentCard'
import { ArrowLeft, Lock, Printer, Search, ShieldCheck, UserSearch, ImageDown } from 'lucide-react'

// ============ 家长查询页（严格只读） ============
// 本页只从 store 读取 getClass，不调用任何 update/swap/regenerate 接口，
// 因此无论怎么操作都改不了座位数据（打印/存图也只是本地输出）。

export function ParentQuery({ classId: initialClassId }: { classId?: string }) {
  const { classes, getClass } = useStore()
  const [classId, setClassId] = useState(initialClassId ?? '')
  const [keyword, setKeyword] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // 周次按班级记忆；未记忆时默认最新已生成周
  const [weekByClass, setWeekByClass] = useState<Record<string, number>>({})

  const cls = getClass(classId)
  const generatedWeeks = cls ? cls.assignments.map((a) => a.week).sort((a, b) => a - b) : []
  const latestWeek = generatedWeeks[generatedWeeks.length - 1] ?? 1
  const week = classId ? (weekByClass[classId] ?? latestWeek) : 1
  const setWeek = (w: number) => {
    if (classId) setWeekByClass((m) => ({ ...m, [classId]: w }))
  }

  // 切换班级时重置查询条件（周次自动落到新班的默认周）
  const pickClass = (id: string) => {
    setClassId(id)
    setKeyword('')
    setSelectedId(null)
  }

  const summaries = useMemo(() => (cls ? buildSummaries(cls) : null), [cls])
  const dupNames = useMemo(() => (cls ? duplicateNameSet(cls.students) : new Set<string>()), [cls])
  const candidates = useMemo(() => (cls ? searchStudents(cls, keyword) : []), [cls, keyword])
  const selected = cls && selectedId ? cls.students.find((s) => s.id === selectedId) ?? null : null
  const progress = useMemo(
    () => (summaries && selected ? getProgress(summaries, selected.id) : null),
    [summaries, selected],
  )
  const weekInfo = useMemo(() => {
    if (!cls || !selected || !summaries || !weekExists(cls, week)) return null
    return getWeekSeatFor(cls, selected, summaries, week)
  }, [cls, selected, summaries, week])

  // 展示名：重名学生附加区分信息（优先学号，其次备注），避免家长拿错座位图
  const displayName = (s: Student): string => {
    if (!dupNames.has(s.name)) return s.name
    if (s.studentNo?.trim()) return `${s.name}（${s.studentNo.trim()}）`
    if (s.note?.trim()) return `${s.name}（${s.note.trim()}）`
    return s.name
  }

  return (
    <div className="page page-parent-query">
      <div className="page-head">
        <Link className="back" to={classId ? `/class/${classId}/rotations` : '/'}>
          <ArrowLeft size={14} /> {classId ? '返回轮换结果' : '班级列表'}
        </Link>
        <h1>家长座位查询（只读）</h1>
        {classId && cls && (
          <nav className="tabs">
            <Link className="tab" to={`/class/${cls.id}/setup`}>
              座位与学生
            </Link>
            <Link className="tab" to={`/class/${cls.id}/rotations`}>
              轮换结果
            </Link>
            <Link className="tab" to={`/class/${cls.id}/fairness`}>
              公平性报告
            </Link>
            <Link className="tab" to={`/class/${cls.id}/print`}>
              打印
            </Link>
            <span className="tab tab-active">家长查询</span>
          </nav>
        )}
      </div>

      <div className="card privacy-banner" data-testid="pq-privacy">
        <ShieldCheck size={18} />
        <p>
          本页为<b>只读查询</b>，任何点击都不会改动座位数据。所有学生信息只保存在<b>本机浏览器</b>（IndexedDB）中，
          <b>不会上传</b>到任何服务器，也没有后端账号；打印件与导出的小图请由老师核对后自行发给家长。
        </p>
      </div>

      {classes.length === 0 ? (
        <div className="empty-hint">
          <UserSearch size={40} />
          <p>还没有班级数据。请先在本机创建班级、录入学生并生成轮换。</p>
          <Link className="btn btn-primary" to="/">
            去班级列表
          </Link>
        </div>
      ) : (
        <>
          <section className="card query-panel" data-testid="pq-panel">
            <div className="row-flex wrap">
              <label className="inline-label">
                班级
                <select
                  className="input input-sm"
                  value={classId}
                  data-testid="pq-class"
                  onChange={(e) => pickClass(e.target.value)}
                >
                  <option value="">请选择班级…</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}（{c.students.length} 人）
                    </option>
                  ))}
                </select>
              </label>
              <label className="inline-label">
                周次
                <select
                  className="input input-sm"
                  value={week}
                  disabled={!cls || generatedWeeks.length === 0}
                  data-testid="pq-week"
                  onChange={(e) => setWeek(Number(e.target.value))}
                >
                  {generatedWeeks.map((w) => (
                    <option key={w} value={w}>
                      第 {w} 周
                    </option>
                  ))}
                </select>
              </label>
              <label className="inline-label pq-search-label">
                学生姓名或学号
                <input
                  className="input"
                  placeholder="例如：王梓涵 或 20240315"
                  value={keyword}
                  disabled={!cls}
                  data-testid="pq-keyword"
                  onChange={(e) => {
                    setKeyword(e.target.value)
                    setSelectedId(null)
                  }}
                />
                <Search size={14} className="pq-search-icon" />
              </label>
            </div>
            {cls && cls.assignments.length === 0 && (
              <p className="muted small" data-testid="pq-no-plan">
                该班还没有生成轮换结果，暂无可查周次。
                <Link to={`/class/${cls.id}/rotations`}>先去生成 →</Link>
              </p>
            )}
            {cls && cls.assignments.length > 0 && cls.assignments.length < cls.weeks && (
              <p className="muted small">目前只生成了前 {generatedWeeks.length} 周（计划共 {cls.weeks} 周）。</p>
            )}

            {/* 候选学生列表（重名时在此用学号/备注区分） */}
            {cls && keyword.trim() && (
              <div className="pq-candidates" data-testid="pq-candidates">
                {candidates.length === 0 ? (
                  <p className="muted small">没有匹配的学生，请检查姓名或学号。</p>
                ) : (
                  candidates.map((s) => {
                    const dup = dupNames.has(s.name)
                    return (
                      <button
                        key={s.id}
                        className={`card pq-candidate ${selectedId === s.id ? 'pq-candidate-active' : ''}`}
                        data-testid="pq-candidate"
                        data-student-id={s.id}
                        onClick={() => setSelectedId(s.id)}
                      >
                        <b>{s.name}</b>
                        {(dup || s.studentNo?.trim()) && (
                          <span className="pq-candidate-sub">{s.studentNo?.trim() ? `学号 ${s.studentNo.trim()}` : ''}</span>
                        )}
                        {dup && <span className="pq-candidate-sub">{disambiguationText(s)}</span>}
                        {!dup && s.note?.trim() && <span className="pq-candidate-sub">备注：{s.note.trim()}</span>}
                      </button>
                    )
                  })
                )}
              </div>
            )}
          </section>

          {cls && selected && (
            <QueryResult
              cls={cls}
              student={selected}
              week={week}
              onWeekChange={setWeek}
              generatedWeeks={generatedWeeks}
              weekInfo={weekInfo}
              progress={progress}
              displayName={displayName}
              isDup={dupNames.has(selected.name)}
            />
          )}
        </>
      )}
    </div>
  )
}

// ---------- 查询结果（屏幕展示 + 打印/导出共用同一块内容） ----------

function QueryResult({
  cls,
  student,
  week,
  onWeekChange,
  generatedWeeks,
  weekInfo,
  progress,
  displayName,
  isDup,
}: {
  cls: ClassEntity
  student: Student
  week: number
  onWeekChange: (w: number) => void
  generatedWeeks: number[]
  weekInfo: ReturnType<typeof getWeekSeatFor>
  progress: ReturnType<typeof getProgress>
  displayName: (s: Student) => string
  isDup: boolean
}) {
  return (
    <section className="pq-result-block" data-testid="pq-result-block">
      <div className="pq-result-toolbar no-print">
        <label className="inline-label">
          查看周次
          <select className="input input-sm" value={week} data-testid="pq-result-week" onChange={(e) => onWeekChange(Number(e.target.value))}>
            {generatedWeeks.map((w) => (
              <option key={w} value={w}>
                第 {w} 周
              </option>
            ))}
          </select>
        </label>
        <span className="spacer" />
        <span className="readonly-hint">
          <Lock size={13} /> 只读，无法修改
        </span>
        <button className="btn" data-testid="pq-png" onClick={() => weekInfo && progress && downloadParentCard({ cls, student, weekInfo, progress })} disabled={!weekInfo || !progress}>
          <ImageDown size={15} /> 存成小图（PNG）
        </button>
        <button className="btn btn-primary" data-testid="pq-print" onClick={() => window.print()} disabled={!weekInfo}>
          <Printer size={15} /> 打印
        </button>
      </div>

      {(!weekInfo || !progress) && (
        <div className="card empty-hint">
          <p>第 {week} 周的座位表中没有该生（该周未安排座位）。可切换其他周次查看。</p>
        </div>
      )}

      {weekInfo && progress && (
        <div className="parent-sheet" data-testid="pq-result">
          <header className="parent-sheet-head">
            <h2>
              {cls.name} · 第 {weekInfo.week} 周座位查询
            </h2>
            <p className="parent-sheet-ident">
              <b>{displayName(student)}</b>
              {!isDup && student.note?.trim() && <span className="muted">　备注：{student.note.trim()}</span>}
            </p>
          </header>

          <MiniNeighborhood cls={cls} student={student} center={weekInfo.seat} week={week} displayName={displayName} />

          <div className="parent-sections">
            <div className="parent-sec">
              <h3>本周座位</h3>
              <p className="parent-seat-line" data-testid="pq-seat">
                第 <b>{weekInfo.row}</b> 排第 <b>{weekInfo.col}</b> 列
                <span className={`zone-pill zone-${weekInfo.seat.tags.includes('front') ? 'front' : weekInfo.seat.tags.includes('back') ? 'back' : 'middle'}`}>
                  {weekInfo.zoneLabel}
                </span>
                {weekInfo.seatTags.map((t) => (
                  <span key={t} className="zone-pill zone-tag">
                    {t}
                  </span>
                ))}
              </p>
            </div>

            <div className="parent-sec">
              <h3>周围同学</h3>
              {weekInfo.neighbors.length === 0 ? (
                <p className="muted">周围座位本周为空。</p>
              ) : (
                <ul className="neighbor-list" data-testid="pq-neighbors">
                  {weekInfo.neighbors.map((n) => (
                    <li key={`${n.student.id}-${n.direction}`}>
                      <span className="neighbor-dir">{n.direction}</span>
                      <b>{displayName(n.student)}</b>
                      {n.acrossAisle && <em className="across-aisle">隔过道</em>}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="parent-sec">
              <h3>本周特殊标记</h3>
              {weekInfo.careBadges.length === 0 && weekInfo.violations.length === 0 ? (
                <p className="muted" data-testid="pq-no-flags">
                  本周无特殊标记。
                </p>
              ) : (
                <div className="parent-flags" data-testid="pq-flags">
                  {weekInfo.careBadges.map((b) => (
                    <span key={b} className="zone-pill">
                      {b}
                    </span>
                  ))}
                  {weekInfo.violations.map((v) => (
                    <span key={v} className="zone-pill zone-violation">
                      ⚠ {v}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="parent-sec parent-stats" data-testid="pq-stats">
              <h3>到目前（已排 {progress.seatedWeeks} 周）</h3>
              <ul>
                <li>
                  前 {cls.constraints.frontRows} 排次数
                  <b data-testid="pq-front-count">{progress.frontRowsCount}</b> 次
                </li>
                <li>
                  平均位置分<b data-testid="pq-avg-score">{progress.avgScore.toFixed(2)}</b>
                  <span className="muted small">（越低位置越好）</span>
                </li>
                <li>
                  全班位置排名
                  <b data-testid="pq-rank">
                    第 {progress.rank} 名
                  </b>
                  / 共 {progress.classSize} 人
                  {progress.tieCount > 1 && <span className="muted small">（{progress.tieCount} 人并列）</span>}
                </li>
                <li>
                  前/中/后 1/3 行
                  <b>
                    {progress.frontCount}/{progress.middleCount}/{progress.backCount}
                  </b>
                  周
                </li>
              </ul>
              <p className="muted small score-note">
                位置分 = 前后排权重(0~2，越小越靠前) + 中间度权重(0~1，越小越靠中间)，分数越低位置越好；排名按平均位置分从好到差。
              </p>
            </div>
          </div>

          <footer className="parent-sheet-foot">
            <ShieldCheck size={13} />
            <span>本数据仅保存在本机浏览器中，不会上传到任何服务器；查询结果只读，不能修改任何座位数据。</span>
          </footer>
        </div>
      )}
    </section>
  )
}

// ---------- 3×3 周边座位缩略图（含过道间隙） ----------

function MiniNeighborhood({
  cls,
  student,
  center,
  week,
  displayName,
}: {
  cls: ClassEntity
  student: Student
  center: Seat
  week: number
  displayName: (s: Student) => string
}) {
  const asg = cls.assignments.find((a) => a.week === week)
  const studentById = new Map(cls.students.map((s) => [s.id, s]))
  const cols = [center.col - 1, center.col, center.col + 1].filter((c) => c >= 0 && c < cls.layout.cols)

  // 与 SeatGrid.gridMeta 同一套规则：过道在第 a|a+1 列之间时插入一条 10px 间隙轨道，
  // 某座位所在网格列 = 相对序号 +1 + 其左侧间隙数。
  const parts: string[] = []
  cols.forEach((c) => {
    if (cls.layout.aisles.includes(c - 1)) parts.push('10px')
    parts.push('1fr')
  })
  const gridColOf = (c: number) => c - cols[0] + 1 + cls.layout.aisles.filter((a) => a >= cols[0] - 1 && a < c).length

  const seatAt = (r: number, c: number) => cls.seats.find((s) => s.row === r && s.col === c)

  return (
    <div className="mini-neighborhood" data-testid="pq-mini">
      <div className="mini-stage">▲ 讲台方向</div>
      <div className="mini-canvas" style={{ gridTemplateColumns: parts.join(' ') }}>
        {cls.layout.aisles
          .filter((a) => a >= cols[0] - 1 && a < cols[cols.length - 1])
          .map((a) => (
            <div key={a} className="mini-aisle" style={{ gridColumn: a - cols[0] + 2 + cls.layout.aisles.filter((x) => x < a).length, gridRow: '1 / span 3' }} />
          ))}
        {[-1, 0, 1].map((dr) =>
          [-1, 0, 1].map((dc) => {
            const seat = seatAt(center.row + dr, center.col + dc)
            if (!seat) return null
            const occupantId = asg?.map[seat.id]
            const occupant = occupantId ? studentById.get(occupantId) : undefined
            const isMe = occupantId === student.id
            return (
              <div
                key={seat.id}
                className={`mini-cell ${isMe ? 'mini-me' : occupant ? 'mini-occupied' : 'mini-empty'} ${
                  seat.tags.includes('front') ? 'mini-front' : seat.tags.includes('back') ? 'mini-back' : ''
                }`}
                style={{ gridColumn: gridColOf(seat.col), gridRow: seat.row - center.row + 2 }}
                data-seat-id={seat.id}
              >
                {isMe ? (
                  <>
                    <span className="mini-name">我</span>
                    <span className="mini-sub">{student.name}</span>
                  </>
                ) : occupant ? (
                  <span className="mini-name">{displayName(occupant)}</span>
                ) : (
                  <span className="mini-name mini-name-empty">空</span>
                )}
              </div>
            )
          }),
        )}
      </div>
    </div>
  )
}
