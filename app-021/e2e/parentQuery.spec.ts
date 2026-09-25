import { expect, test, type Page } from '@playwright/test'
import { addStudent, bulkAdd, generate } from './helpers'

// 场景三：家长只读查询 —— 选班/选周/按姓名学号查、重名区分、只读、打印/存图

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

async function createClass(page: Page, name: string) {
  await page.getByTestId('new-class-name').fill(name)
  await page.getByTestId('create-class').click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`${name} · 配置`)
  return /\/class\/([^/]+)/.exec(page.url())![1]
}

test('家长查询：按姓名查出座位、周围同学、统计与排名', async ({ page }) => {
  await createClass(page, 'E2E 查询班')
  await addStudent(page, { name: '张小近', height: '145', vision: 'front_required' })
  await bulkAdd(page, '李一,150\n王二,158,爱说话\n赵三,140\n钱四,162\n孙五,147\n周六,155\n吴七,138\n郑八,160')
  await page.getByRole('link', { name: '轮换结果' }).click()
  await generate(page, 4, 42)

  // 从卡片进入家长查询页
  await page.goto('/')
  await page.locator('[data-testid="class-card"]', { hasText: 'E2E 查询班' }).getByRole('link', { name: '家长查询' }).click()
  await expect(page).toHaveURL(/\/class\/.+\/query$/)
  await expect(page.getByTestId('pq-privacy')).toContainText('不会上传')
  await expect(page.getByTestId('pq-privacy')).toContainText('只读')

  // 选周次、搜姓名
  await page.getByTestId('pq-week').selectOption('2')
  await page.getByTestId('pq-keyword').fill('张小近')
  await page.getByTestId('pq-candidate').click()

  const result = page.getByTestId('pq-result')
  await expect(result).toBeVisible()
  await expect(page.getByTestId('pq-seat')).toContainText('排')
  await expect(page.getByTestId('pq-seat')).toContainText('列')
  // 近视学生第 2 周仍在前 2 排
  const row = Number((await page.getByTestId('pq-seat').locator('b').first().textContent()) ?? '0')
  expect(row).toBeLessThanOrEqual(2)
  await expect(page.getByTestId('pq-flags')).toContainText('近视·需前排')
  await expect(page.getByTestId('pq-front-count')).toHaveText(/^\d+$/)
  await expect(page.getByTestId('pq-avg-score')).toHaveText(/\d+\.\d{2}/)
  await expect(page.getByTestId('pq-rank')).toContainText('名')
  // 隐私脚注也在结果卡内
  await expect(page.getByTestId('pq-result')).toContainText('不会上传到任何服务器')
  // 只读提示
  await expect(page.locator('.readonly-hint')).toBeVisible()
})

test('重名学生按学号/备注区分，且页面上没有任何编辑入口', async ({ page }) => {
  await createClass(page, 'E2E 重名班')
  // 两个「张伟」：一个有学号，一个用备注
  await addStudent(page, { name: '张伟' })
  await page.getByTestId('add-student').click()
  await page.getByTestId('student-name').fill('张伟')
  // 同名且无学号/备注 → 被拦截
  await page.getByTestId('student-save').click()
  await expect(page.getByText('已存在同名学生；请填写学号或备注以便家长区分')).toBeVisible()
  await page.getByTestId('student-no').fill('2024002')
  await page.getByTestId('student-save').click()
  await bulkAdd(page, '李一,150\n王二,158\n赵三,140')

  await page.getByRole('link', { name: '轮换结果' }).click()
  await generate(page, 2, 42)
  await page.goto('/query')
  await page.getByTestId('pq-class').selectOption({ label: 'E2E 重名班（5 人）' })
  await page.getByTestId('pq-keyword').fill('张伟')
  const candidates = page.getByTestId('pq-candidate')
  await expect(candidates).toHaveCount(2)
  await expect(candidates.nth(0)).toContainText(/学号 2024002|备注/)
  // 选带学号的那个
  await page.locator('[data-testid="pq-candidate"]', { hasText: '2024002' }).click()
  await expect(page.getByTestId('pq-result')).toBeVisible()

  // 只读：查询页不得出现增删改/拖拽/生成控件
  await expect(page.getByTestId('add-student')).toHaveCount(0)
  await expect(page.getByTestId('gen-all')).toHaveCount(0)
  await expect(page.locator('[draggable="true"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /删除/ })).toHaveCount(0)
})

test('查询结果可打印、可存成 PNG 小图', async ({ page }) => {
  await createClass(page, 'E2E 导出班')
  await bulkAdd(page, '李一,150\n王二,158\n赵三,140')
  await page.getByRole('link', { name: '轮换结果' }).click()
  await generate(page, 2, 42)
  await page.goto('/query')
  await page.getByTestId('pq-class').selectOption({ label: 'E2E 导出班（3 人）' })
  await page.getByTestId('pq-keyword').fill('李一')
  await page.getByTestId('pq-candidate').click()
  await expect(page.getByTestId('pq-result')).toBeVisible()

  // 打印按钮可点（headless 下 window.print 为 no-op，不报错即可）
  await page.getByTestId('pq-print').click()

  // 存小图：拦截下载
  // 进入查询默认展示最新一周（第 2 周）
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('pq-png').click(),
  ])
  expect(dl.suggestedFilename()).toMatch(/第2周座位\.png$/)
  // 切到第 1 周后导出文件名跟随周次
  await page.getByTestId('pq-result-week').selectOption('1')
  const [dl1] = await Promise.all([page.waitForEvent('download'), page.getByTestId('pq-png').click()])
  expect(dl1.suggestedFilename()).toMatch(/第1周座位\.png$/)
})

test('未生成轮换时查询页给出引导，周次不可选', async ({ page }) => {
  await createClass(page, 'E2E 空查询班')
  await bulkAdd(page, '陈晨,2024088,150\n周周,155')
  await page.goto('/query')
  await page.getByTestId('pq-class').selectOption({ label: 'E2E 空查询班（2 人）' })
  await expect(page.getByTestId('pq-no-plan')).toBeVisible()
  await expect(page.getByTestId('pq-week')).toBeDisabled()
  // 未选学生时没有结果区，自然也没有打印/导出按钮（只读、无结果可输出）
  await expect(page.getByTestId('pq-result-block')).toHaveCount(0)
  // 仍可用学号搜到学生，只是没有可查周次
  await page.getByTestId('pq-keyword').fill('2024088')
  await expect(page.getByTestId('pq-candidate')).toContainText('陈晨')
})
