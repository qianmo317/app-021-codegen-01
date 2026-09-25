import { useMemo, useState } from 'react'
import { Link, navigate } from '../router'
import { useStore } from '../store'
import { QueryCard } from '../components/QueryCard'
import { buildStudentWeekReport, pickStudent, searchStudents } from '../lib/query'
import { exportReportPNG } from '../lib/cardImage'
import { ArrowLeft, ImageDown, Lock, Printer, Search, ShieldCheck } from 'lucide-react'

// 家长查询：纯只读。本组件不调用任何写 Store 的方法。
// 路由：/query            （先选班级）
//       /class/:id/query  （已锁定班级）
export function ParentQuery({ classId }: { classId?: string }) {
  const { classes, getClass } = useStore()
  const [selectedId, setSelectedId] = useState<string>(classId ?? '')
  const [week, setWeek] = useState<number>(1)
  const [keyword, setKeyword] = useState('')
  const [submitted, setSubmitted] = useState('')

  const cls = getClass(selectedId)

  const weeksReady = cls?.assignments.length ?? 0
  const effectiveWeek = Math.min(Math.max(1, week), Math.max(1, weeksReady))

  const candidates = useMemo(
    () => (cls && submitted ? searchStudents(cls, submitted) : []),
    [cls, submitted],
  )
  const chosen = useMemo(() => (cls ? pickStudent(candidates, submitted) : null), [candidates, cls, submitted])
  const report = useMemo(
    () => (cls && chosen && weeksReady > 0 ? buildStudentWeekReport(cls, chosen, effectiveWeek) : null),
    [cls, chosen, weeksReady, effectiveWeek],
  )

  const selectClass = (id: string) => {
    setSelectedId(id)
    setSubmitted('')
    setKeyword('')
    if (id) navigate(`/class/${id}/query`)
  }

  const doSearch = () => {
    setSubmitted(keyword.trim())
  }

  const printSheet = () => window.print()
  const saveImage = () => {
    if (cls && report) exportReportPNG(cls, report)
  }

  return (
    <div className="page page-query" data-testid="parent-query">
      <div className="page-head">
        <Link className="back" to={cls ? `/class/${cls.id}/rotations` : '/'}>
          <ArrowLeft size={14} /> 返回
        </Link>
        <h1>家长座位查询</h1>
        <p className="muted small">
          <Lock size={13} style={{ verticalAlign: -2 }} /> 只读查询页：这里<b>不能修改</b>任何学生或座位数据；可直接打印或存成一张小图发给家长。
        </p>
      </div>

      {/* 查询条件 */}
      <section className="card qq-form" data-testid="qq-form">
        <label className="qq-field">
          <span>班级</span>
          <select
            className="input"
            value={selectedId}
            data-testid="qq-class"
            onChange={(e) => selectClass(e.target.value)}
          >
            <option value="">请选择班级…</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}（{c.students.length} 人）
              </option>
            ))}
          </select>
        </label>

        <label className="qq-field">
          <span>周次</span>
          <select
            className="input"
            value={effectiveWeek}
            disabled={weeksReady === 0}
            data-testid="qq-week"
            onChange={(e) => setWeek(Number(e.target.value))}
          >
            {weeksReady === 0 && <option value={1}>（暂无已生成周次）</option>}
            {Array.from({ length: weeksReady }, (_, i) => i + 1).map((w) => (
              <option key={w} value={w}>
                第 {w} 周
              </option>
            ))}
          </select>
        </label>

        <label className="qq-field qq-grow">
          <span>学生姓名 / 学号</span>
          <input
            className="input"
            placeholder="输入完整或部分姓名，或学号"
            value={keyword}
            disabled={!cls}
            data-testid="qq-keyword"
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doSearch()}
          />
        </label>
        <button className="btn btn-primary qq-search" disabled={!cls || !keyword.trim()} onClick={doSearch} data-testid="qq-go">
          <Search size={15} /> 查询
        </button>
      </section>

      {/* 查询结果 */}
      {submitted && cls && weeksReady === 0 && (
        <div className="card warn-card" data-testid="qq-no-week">
          <p>这个班还没有生成任何周次的座位表，请老师先到「轮换结果」页生成后再来查询。</p>
        </div>
      )}

      {submitted && cls && weeksReady > 0 && candidates.length === 0 && (
        <div className="card" data-testid="qq-none">
          <p className="muted">
            没有找到与「{submitted}」匹配的学生。请核对姓名或学号；也可能孩子在其他班级。
          </p>
        </div>
      )}

      {submitted && cls && weeksReady > 0 && candidates.length > 0 && !chosen && (
        <div className="card" data-testid="qq-ambiguous">
          <h3>班里有 {candidates.length} 位同名 / 相近的同学，请按学号或备注确认是哪一位：</h3>
          <ul className="qq-candidates">
            {candidates.map((s) => (
              <li key={s.id}>
                <button
                  className="btn qq-candidate"
                  data-testid="qq-candidate"
                  onClick={() => {
                    setKeyword(s.studentNo || s.name)
                    setSubmitted(s.studentNo || s.name)
                  }}
                >
                  <b>{s.name}</b>
                  {s.studentNo && <span className="qc-no">学号 {s.studentNo}</span>}
                  {s.note ? <span className="muted">备注：{s.note}</span> : <span className="muted">（无备注）</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {report && cls && (
        <>
          <div className="qq-actions no-print" data-testid="qq-actions">
            <button className="btn btn-primary" onClick={printSheet} data-testid="qq-print">
              <Printer size={15} /> 直接打印
            </button>
            <button className="btn" onClick={saveImage} data-testid="qq-png">
              <ImageDown size={15} /> 存成一张小图（PNG）
            </button>
            <span className="muted small">
              <ShieldCheck size={14} style={{ verticalAlign: -2 }} /> 数据只在本机浏览器里，不会上传
            </span>
          </div>
          <div className="qq-print-area">
            <QueryCard cls={cls} report={report} />
          </div>
        </>
      )}
    </div>
  )
}
