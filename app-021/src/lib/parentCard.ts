import type { ClassEntity, Student } from '../types'
import type { StudentProgress, WeekSeatInfo } from './parentQuery'
import { disambiguationText, duplicateNameSet } from './parentQuery'

// ============ 家长查询结果小图：Canvas 2D 手绘 → PNG（无第三方依赖） ============
// 选 Canvas 而非 SVG foreignObject：系统中文字体栈在 rasterize 时更稳，
// 教师可直接把 PNG 发到家长群/微信。

const FONT =
  "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif"

export interface ParentCardData {
  cls: ClassEntity
  student: Student
  weekInfo: WeekSeatInfo
  progress: StudentProgress
}

const SCALE = 2 // 2 倍图，手机上清晰
const W = 460
const PAD = 24
const COLORS = {
  ink: '#1c2430',
  muted: '#66707d',
  brand: '#2563eb',
  brandWeak: '#dbeafe',
  brandInk: '#1d4ed8',
  line: '#dfe4ec',
  warn: '#b45309',
  warnBg: '#fef3c7',
}

function measureWrapped(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const ch of text) {
    const test = line + ch
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = ch
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

interface Block {
  h: number
  draw: (y: number) => void
}

/**
 * 渲染查询卡片到 canvas。canvas 的尺寸按内容自适应，返回该 canvas。
 * 离屏 canvas（未挂到 DOM）也可调用，供「存成小图」直接导出 PNG。
 */
export function renderParentCard(data: ParentCardData): HTMLCanvasElement {
  const { cls, student, weekInfo, progress } = data
  const contentW = W - PAD * 2
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const dup = duplicateNameSet(cls.students).has(student.name)

  // ---------- 排版块 ----------
  const blocks: Block[] = []

  const gap = (h: number): Block => ({ h, draw: () => {} })

  const sectionTitle = (text: string): Block => ({
    h: 28,
    draw: (y) => {
      ctx.fillStyle = COLORS.brand
      ctx.fillRect(PAD, y + 3, 3.5, 14)
      ctx.fillStyle = COLORS.ink
      ctx.font = `bold 14px ${FONT}`
      ctx.textBaseline = 'top'
      ctx.fillText(text, PAD + 9, y + 2)
    },
  })

  const wrapped = (text: string, color: string, bold = false): Block => {
    ctx.font = `${bold ? 'bold ' : ''}13.5px ${FONT}`
    const lines = measureWrapped(ctx, text, contentW)
    const lh = 21
    return {
      h: lines.length * lh,
      draw: (y) => {
        ctx.fillStyle = color
        ctx.font = `${bold ? 'bold ' : ''}13.5px ${FONT}`
        ctx.textBaseline = 'top'
        lines.forEach((ln, i) => ctx.fillText(ln, PAD, y + i * lh))
      },
    }
  }

  const chipRow = (items: string[]): Block => {
    if (items.length === 0) return { h: 0, draw: () => {} }
    const chipGap = 6
    const chipH = 22
    const chipPad = 9
    const positions: Array<[string, number, number]> = []
    let x = 0
    let rows = 1
    ctx.font = `12px ${FONT}`
    for (const t of items) {
      const w = ctx.measureText(t).width + chipPad * 2
      if (x > 0 && x + w > contentW) {
        x = 0
        rows++
      }
      positions.push([t, x, rows - 1])
      x += w + chipGap
    }
    return {
      h: rows * (chipH + chipGap) - chipGap,
      draw: (y) => {
        ctx.textBaseline = 'middle'
        ctx.font = `12px ${FONT}`
        for (const [t, cx, ry] of positions) {
          const w = ctx.measureText(t).width + chipPad * 2
          const bx = PAD + cx
          const by = y + ry * (chipH + chipGap)
          ctx.fillStyle = COLORS.brandWeak
          roundRect(ctx, bx, by, w, chipH, 6)
          ctx.fill()
          ctx.fillStyle = COLORS.brandInk
          ctx.fillText(t, bx + chipPad, by + chipH / 2 + 0.5)
        }
      },
    }
  }

  // 头部（班级 + 周次）
  blocks.push({
    h: 50,
    draw: (y) => {
      ctx.fillStyle = COLORS.brand
      roundRect(ctx, PAD, y, contentW, 50, 10)
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.textBaseline = 'middle'
      ctx.font = `bold 17px ${FONT}`
      ctx.fillText(`${cls.name} · 第 ${weekInfo.week} 周座位查询`, PAD + 14, y + 26)
    },
  })
  blocks.push(gap(4))

  // 学生身份行：重名时附加区分信息（优先学号，其次备注）
  const distinguish = dup ? disambiguationText(student) : null
  const identity =
    `${student.name}${distinguish ? `（${distinguish}）` : ''}` +
    `${student.studentNo?.trim() && !dup ? ` · 学号 ${student.studentNo.trim()}` : ''}`
  blocks.push(wrapped(identity, COLORS.ink, true))
  if (!dup && student.note?.trim()) blocks.push(wrapped(`备注：${student.note.trim()}`, COLORS.muted))

  blocks.push(gap(6))

  // 本周座位
  blocks.push(sectionTitle('本周座位'))
  blocks.push(chipRow([`第 ${weekInfo.row} 排第 ${weekInfo.col} 列`, weekInfo.zoneLabel, ...weekInfo.seatTags]))

  // 周围同学
  blocks.push(gap(4))
  blocks.push(sectionTitle('周围同学'))
  if (weekInfo.neighbors.length === 0) {
    blocks.push(wrapped('周围座位本周为空。', COLORS.muted))
  } else {
    blocks.push(
      wrapped(
        weekInfo.neighbors.map((n) => `${n.direction}：${n.student.name}${n.acrossAisle ? '（隔过道）' : ''}`).join('　'),
        COLORS.ink,
      ),
    )
  }

  // 特殊标记
  blocks.push(gap(4))
  blocks.push(sectionTitle('本周特殊标记'))
  if (weekInfo.careBadges.length === 0 && weekInfo.violations.length === 0) {
    blocks.push(wrapped('本周无特殊标记。', COLORS.muted))
  } else {
    if (weekInfo.careBadges.length > 0) blocks.push(chipRow(weekInfo.careBadges))
    for (const v of weekInfo.violations) {
      blocks.push({
        h: 24,
        draw: (y) => {
          ctx.fillStyle = COLORS.warnBg
          roundRect(ctx, PAD, y, contentW, 22, 6)
          ctx.fill()
          ctx.fillStyle = COLORS.warn
          ctx.font = `12px ${FONT}`
          ctx.textBaseline = 'middle'
          ctx.fillText(`⚠ ${v}`, PAD + 8, y + 11.5)
        },
      })
    }
  }

  // 到目前的统计
  blocks.push(gap(4))
  blocks.push(sectionTitle(`到目前（已排 ${progress.seatedWeeks} 周）`))
  blocks.push(
    wrapped(
      `前 ${cls.constraints.frontRows} 排次数：${progress.frontRowsCount} 次　平均位置分：${progress.avgScore.toFixed(
        2,
      )}（越低越好）`,
      COLORS.ink,
    ),
  )
  blocks.push(
    wrapped(
      `全班位置排名：第 ${progress.rank} 名 / 共 ${progress.classSize} 人${
        progress.tieCount > 1 ? `（${progress.tieCount} 人并列）` : ''
      }；前/中/后 1/3 行：${progress.frontCount}/${progress.middleCount}/${progress.backCount} 周`,
      COLORS.ink,
    ),
  )
  blocks.push(gap(2))
  blocks.push(wrapped('位置分 = 前后排权重(0~2) + 中间度权重(0~1)，越低位置越好。', COLORS.muted))

  // 隐私脚注
  blocks.push({
    h: 42,
    draw: (y) => {
      ctx.strokeStyle = COLORS.line
      ctx.beginPath()
      ctx.moveTo(PAD, y)
      ctx.lineTo(W - PAD, y)
      ctx.stroke()
      ctx.fillStyle = COLORS.muted
      ctx.font = `11.5px ${FONT}`
      ctx.textBaseline = 'top'
      ctx.fillText('本数据仅保存在本机浏览器中，不会上传到任何服务器。', PAD, y + 8)
      ctx.fillText('查询结果只读，不能修改任何座位数据。', PAD, y + 23)
    },
  })

  // ---------- 定尺寸、实际绘制 ----------
  const contentH = blocks.reduce((h, b) => h + b.h, 0)
  const height = contentH + PAD * 2
  canvas.width = W * SCALE
  canvas.height = height * SCALE
  ctx.scale(SCALE, SCALE)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, W, height)

  let y = PAD
  for (const b of blocks) {
    b.draw(y)
    y += b.h
  }
  return canvas
}

/** 渲染并触发 PNG 下载（供「存成小图」按钮调用） */
export function downloadParentCard(data: ParentCardData): void {
  const canvas = renderParentCard(data)
  const url = canvas.toDataURL('image/png')
  const a = document.createElement('a')
  a.href = url
  a.download = `${data.cls.name}-${data.student.name}-第${data.weekInfo.week}周座位.png`
  a.click()
}
