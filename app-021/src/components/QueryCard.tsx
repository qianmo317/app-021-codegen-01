import type { ClassEntity } from '../types'
import type { StudentWeekReport } from '../lib/query'
import { formatAvg, rankPhrase } from '../lib/query'

// ============ 家长查询结果卡（只读）：屏幕展示与打印共用这一块 ============

interface Props {
  cls: ClassEntity
  report: StudentWeekReport
}

function markBadge(kind: string): string {
  if (kind === 'care') return 'qc-badge qc-care'
  if (kind === 'seat') return 'qc-badge qc-seat'
  return 'qc-badge qc-fixed'
}

export function QueryCard({ cls, report }: Props) {
  const r = report
  const s = r.student
  return (
    <article className="query-card" data-testid="query-card">
      <header className="qc-head">
        <div>
          <h2 data-testid="qc-title">座位查询单</h2>
          <p className="qc-class">{cls.name}</p>
        </div>
        <span className="qc-readonly">只读 · 仅供家长查看</span>
      </header>

      <section className="qc-section" data-testid="qc-week-section">
        <h3>第 {r.week} 周座位</h3>
        <div className="qc-student">
          <span className="qc-name" data-testid="qc-name">
            {s.name}
          </span>
          {s.studentNo && (
            <span className="qc-no" data-testid="qc-no">
              学号 {s.studentNo}
            </span>
          )}
          {s.note && (
            <span className="qc-note" data-testid="qc-note">
              备注：{s.note}
            </span>
          )}
        </div>

        {!r.seated ? (
          <p className="qc-missing" data-testid="qc-missing">
            该周座位表里没有这位同学的座位（可能该周未生成或未安排），请向老师核对周次。
          </p>
        ) : (
          <>
            <dl className="qc-rows">
              <div className="qc-row">
                <dt>位置</dt>
                <dd data-testid="qc-position">
                  <b>
                    第 {r.seat!.row + 1} 排第 {r.seat!.col + 1} 列
                  </b>
                  <span className="qc-sub">
                    （{r.zoneLabel}
                    {r.positionTags.length ? ' · ' + r.positionTags.join(' · ') : ''}）
                  </span>
                </dd>
              </div>
              <div className="qc-row">
                <dt>周围同学</dt>
                <dd data-testid="qc-neighbors">
                  {r.neighbors.length ? (
                    <ul className="qc-neighbor-list">
                      {r.neighbors.map((n) => (
                        <li key={n.seat.id} className="qc-neighbor" data-rel={n.rel}>
                          <em className="qc-rel">
                            {n.rel}
                            {n.side ? `（${n.side}）` : ''}
                          </em>
                          {n.student.name}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="qc-sub">周围座位该周为空</span>
                  )}
                </dd>
              </div>
              {r.marks.length > 0 && (
                <div className="qc-row">
                  <dt>本周标记</dt>
                  <dd data-testid="qc-marks">
                    {r.marks.map((m, i) => (
                      <span key={i} className={markBadge(m.kind)}>
                        {m.text}
                      </span>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
            {r.warnings.length > 0 && (
              <ul className="qc-warnings" data-testid="qc-warnings">
                {r.warnings.map((w, i) => (
                  <li key={i}>⚠ {w.text}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section className="qc-section" data-testid="qc-cumulative">
        <h3>截至第 {r.stat.throughWeek} 周 · 累计</h3>
        <div className="qc-stats">
          <div className="qc-stat">
            <span className="qc-stat-num" data-testid="qc-front-count">
              {r.stat.frontRowsCount}
            </span>
            <span className="qc-stat-label">前排次数（前 {cls.constraints.frontRows} 排）</span>
            <span className="qc-stat-sub">共入座 {r.stat.weeksSeated} 周</span>
          </div>
          <div className="qc-stat">
            <span className="qc-stat-num" data-testid="qc-avg">
              {formatAvg(r.stat.avgScore)}
            </span>
            <span className="qc-stat-label">平均位置分</span>
            <span className="qc-stat-sub">分数越低位置越好</span>
          </div>
          <div className="qc-stat">
            <span className="qc-stat-num qc-rank" data-testid="qc-rank">
              {r.stat.rank == null ? '—' : r.stat.rank}
              {r.stat.rank != null && <small> / {r.stat.rankTotal}</small>}
            </span>
            <span className="qc-stat-label">全班位置{rankPhrase(r.stat).includes('并列') ? '（并列）' : ''}</span>
            <span className="qc-stat-sub" data-testid="qc-rank-phrase">
              {rankPhrase(r.stat)}
            </span>
          </div>
        </div>
      </section>

      <footer className="qc-foot">
        <p className="qc-privacy" data-testid="qc-privacy">
          隐私说明：本页所有学生数据只保存在老师本机浏览器（IndexedDB）中，<b>不会上传到任何服务器</b>
          ，也没有账号与联网收集；此查询单请由老师当面或私聊发给家长。
        </p>
        <p className="qc-date">
          出具日期：{new Date().toLocaleDateString('zh-CN')} 　 数据来源：本机浏览器，结果只读、不可修改
        </p>
      </footer>
    </article>
  )
}
