import type { ClassEntity } from '../types'
import type { StudentWeekReport } from './query'
import { formatAvg, rankPhrase } from './query'

// ================= 家长查询单 → PNG（手绘 Canvas，零第三方依赖、无网络请求） =================
// 两遍渲染：第一遍记录绘制指令并量高，第二遍在确定高度的画布上重放。
// 屏幕卡片、打印、PNG 三处文案保持一致，避免家长拿到的图与页面信息不符。

const W = 780
const PAD = 34
const INK = '#1c2430'
const MUTED = '#5f6b7a'
const BRAND = '#2563eb'
const BRAND_BG = '#eef4ff'
const LINE = '#dfe4ec'
const WARN = '#b91c1c'
const WARN_BG = '#fef2f2'
const GOOD = '#15803d'

type Op = (c: CanvasRenderingContext2D) => void
type FontColor = { font: string; color: string }

const measureCanvas = document.createElement('canvas')
const measureCtx = measureCanvas.getContext('2d')!

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath()
  c.moveTo(x + r, y)
  c.arcTo(x + w, y, x + w, y + h, r)
  c.arcTo(x + w, y + h, x, y + h, r)
  c.arcTo(x, y + h, x, y, r)
  c.arcTo(x, y, x + w, y, r)
  c.closePath()
}

// 中文逐字符折行（无单词边界）
function wrap(text: string, font: string, maxW: number): string[] {
  measureCtx.font = font
  const lines: string[] = []
  let line = ''
  for (const ch of text) {
    if (measureCtx.measureText(line + ch).width > maxW && line) {
      lines.push(line)
      line = ch
    } else {
      line += ch
    }
  }
  if (line) lines.push(line)
  return lines
}

class Pen {
  y: number
  private ops: Op[] = []
  constructor(y0: number) {
    this.y = y0
  }
  at(x: number, yy: number, text: string, { font, color }: FontColor, align: CanvasTextAlign = 'left') {
    this.ops.push((c) => {
      c.font = font
      c.fillStyle = color
      c.textAlign = align
      c.fillText(text, x, yy)
      c.textAlign = 'left'
    })
  }
  line(x1: number, x2: number, yy: number, color: string) {
    this.ops.push((c) => {
      c.strokeStyle = color
      c.lineWidth = 1
      c.beginPath()
      c.moveTo(x1, yy)
      c.lineTo(x2, yy)
      c.stroke()
    })
  }
  box(x: number, top: number, w: number, h: number, fill: string, stroke: string) {
    this.ops.push((c) => {
      roundRect(c, x, top, w, h, 8)
      c.fillStyle = fill
      c.fill()
      c.strokeStyle = stroke
      c.stroke()
    })
  }
  // 一行文字（基线 = 当前 y），随后下移 lh
  lineText(x: number, text: string, fc: FontColor, align?: CanvasTextAlign, lh = 22) {
    this.at(x, this.y, text, fc, align)
    this.y += lh
  }
  gap(h: number) {
    this.y += h
  }
  sectionTitle(text: string) {
    this.at(PAD, this.y, text, { font: 'bold 17px sans-serif', color: BRAND })
    this.gap(11)
    this.line(PAD, W - PAD, this.y, LINE)
    this.gap(20)
  }
  // key/value 两栏；value 自动折行
  kv(key: string, value: string, opts: { color?: string; bold?: boolean } = {}) {
    const start = this.y
    this.at(PAD, start, key, { font: '15px sans-serif', color: MUTED })
    const kx = PAD + 96
    const font = opts.bold ? 'bold 16px sans-serif' : '16px sans-serif'
    const lines = wrap(value, font, W - PAD - kx)
    lines.forEach((ln, i) => this.at(kx, start + i * 22, ln, { font, color: opts.color ?? INK }))
    this.y = start + Math.max(24, lines.length * 22 + 2)
  }
  warningBox(lines: string[]) {
    const top = this.y - 12
    const bh = lines.length * 22 + 20
    this.box(PAD, top, W - PAD * 2, bh, WARN_BG, '#fecaca')
    lines.forEach((ln, i) => this.at(PAD + 12, top + 26 + i * 22, ln, { font: '14px sans-serif', color: WARN }))
    this.y = top + bh + 4
  }
  infoBox(lines: string[]) {
    const top = this.y - 10
    const bh = lines.length * 20 + 20
    this.box(PAD, top, W - PAD * 2, bh, BRAND_BG, '#c7dcff')
    lines.forEach((ln, i) => this.at(PAD + 14, top + 24 + i * 20, ln, { font: '13.5px sans-serif', color: '#1d4ed8' }))
    this.y = top + bh + 4
  }
  replay(c: CanvasRenderingContext2D) {
    for (const op of this.ops) op(c)
  }
}

export function exportReportPNG(cls: ClassEntity, report: StudentWeekReport): void {
  const r = report
  const s = r.student
  const pen = new Pen(PAD + 24) // 首行基线

  // ---------- 第一遍：布局量高 ----------
  pen.at(PAD, pen.y, '座位查询单', { font: 'bold 22px sans-serif', color: BRAND })
  pen.at(W - PAD, pen.y, '只读 · 仅供家长查看', { font: '13px sans-serif', color: MUTED }, 'right')
  pen.gap(26)
  pen.at(PAD, pen.y, cls.name, { font: 'bold 17px sans-serif', color: INK })
  pen.gap(26)

  pen.sectionTitle(`第 ${r.week} 周座位`)
  if (!r.seated) {
    for (const ln of wrap(
      '该周座位表里没有这位同学的座位（可能该周未生成或未安排），请向老师核对周次。',
      '15px sans-serif',
      W - PAD * 2,
    )) {
      pen.lineText(PAD, ln, { font: '15px sans-serif', color: MUTED })
    }
    pen.gap(4)
  } else {
    pen.kv(
      '位置',
      `第 ${r.seat!.row + 1} 排第 ${r.seat!.col + 1} 列（${r.zoneLabel}${
        r.positionTags.length ? ' · ' + r.positionTags.join(' · ') : ''
      }）`,
      { bold: true, color: BRAND },
    )
    const nbText = r.neighbors.length
      ? r.neighbors.map((n) => `${n.rel}${n.side ? `（${n.side}）` : ''}：${n.student.name}`).join('　')
      : '周围座位该周为空'
    pen.kv('周围同学', nbText)
    if (r.marks.length) pen.kv('本周标记', r.marks.map((m) => m.text).join('　'))
    if (r.warnings.length) {
      pen.gap(6)
      const lines = r.warnings.flatMap((w) => wrap('⚠ ' + w.text, '14px sans-serif', W - PAD * 2 - 24))
      pen.warningBox(lines)
    }
  }

  pen.gap(10)
  pen.sectionTitle(`截至第 ${r.stat.throughWeek} 周 · 累计`)
  pen.kv('前排次数', `${r.stat.frontRowsCount} 次（前 ${cls.constraints.frontRows} 排，共 ${r.stat.weeksSeated} 周入座）`)
  pen.kv('平均位置分', `${formatAvg(r.stat.avgScore)} 分（分数越低位置越好）`, { bold: true })
  pen.kv('全班位置', rankPhrase(r.stat), { bold: true, color: GOOD })

  pen.gap(14)
  pen.infoBox([
    '隐私说明：本页所有学生数据只保存在老师本机浏览器（IndexedDB）中，',
    '不会上传到任何服务器，也没有账号与联网收集；此图请由老师当面或私聊发给家长。',
  ])
  pen.gap(22)
  pen.at(
    PAD,
    pen.y,
    `出具日期：${new Date().toLocaleDateString('zh-CN')}　数据来源：本机浏览器，结果只读、不可修改`,
    { font: '12px sans-serif', color: MUTED },
  )
  const H = pen.y + PAD - 8

  // ---------- 第二遍：在确定高度的画布上重放 ----------
  const scale = 2 // 高分屏清晰度
  const canvas = document.createElement('canvas')
  canvas.width = W * scale
  canvas.height = H * scale
  const c = canvas.getContext('2d')!
  c.scale(scale, scale)
  c.fillStyle = '#ffffff'
  c.fillRect(0, 0, W, H)
  c.strokeStyle = LINE
  c.lineWidth = 1
  roundRect(c, 0.5, 0.5, W - 1, H - 1, 12)
  c.stroke()
  pen.replay(c)

  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${cls.name}-${s.name}-第${r.week}周座位查询单.png`
    a.click()
    URL.revokeObjectURL(url)
  }, 'image/png')
}
