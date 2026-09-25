import { expect, test, type Page } from '@playwright/test'
import { addStudent, bulkAdd, generate, readSeatMap } from './helpers'

// 家长查询页：只读、按班级/周次/姓名或学号查询、重名按学号备注区分、可打印/存图、含隐私声明

async function setupClass(page: Page) {
  await page.goto('/')
  await page.getByTestId('new-class-name').fill('E2E 家长查询班')
  await page.getByTestId('create-class').click()
  // 两个同名学生（用学号/备注区分）+ 其他学生
  await addStudent(page, { name: '林同同', height: '150' })
  // 第二位同名：弹窗填学号
  await page.getByTestId('add-student').click()
  const modal = page.getByTestId('student-modal')
  await modal.getByTestId('student-name').fill('林同同')
  await modal.getByTestId('student-no').fill('42')
  await modal.getByTestId('student-save').click()
  await expect(page.locator('[data-testid="student-row"][data-name="林同同"]')).toHaveCount(2)
  await bulkAdd(page, '陈一,152\n黄二,158\n周三,140\n吴四,162\n郑五,147\n冯六,155\n褚七,138\n卫八,160')
  await page.getByRole('link', { name: '轮换结果' }).click()
  await generate(page, 4, 42)
  const map = await readSeatMap(page)
  const classId = /\/class\/([^/]+)\//.exec(page.url())![1]
  return { classId, map }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('未生成周次时给出引导，不出现结果卡', async ({ page }) => {
  await page.getByTestId('new-class-name').fill('E2E 查询空班')
  await page.getByTestId('create-class').click()
  await page.getByRole('link', { name: '家长查询' }).first().click()
  await expect(page).toHaveURL(/\/query$/)
  await page.getByTestId('qq-class').selectOption({ index: 1 })
  await expect(page.getByTestId('qq-week')).toBeDisabled()
  await page.getByTestId('qq-keyword').fill('测试')
  await page.getByTestId('qq-go').click()
  await expect(page.getByTestId('qq-no-week')).toBeVisible()
  await expect(page.getByTestId('query-card')).toHaveCount(0)
})

test('按姓名查到座位/周围/标记/累计统计，且页面为只读、含隐私声明', async ({ page }) => {
  await setupClass(page)
  await page.getByRole('link', { name: '家长查询' }).first().click()
  await page.getByTestId('qq-class').selectOption({ index: 1 })
  await page.getByTestId('qq-week').selectOption('1')
  await page.getByTestId('qq-keyword').fill('陈一')
  await page.getByTestId('qq-go').click()

  const card = page.getByTestId('query-card')
  await expect(card).toBeVisible()
  await expect(page.getByTestId('qc-position')).toContainText(/第 \d+ 排第 \d+ 列/)
  await expect(page.getByTestId('qc-neighbors')).toBeVisible()
  await expect(page.getByTestId('qc-front-count')).toHaveText(/^\d+$/)
  await expect(page.getByTestId('qc-avg')).toHaveText(/^\d+\.\d{2}$/)
  await expect(page.getByTestId('qc-rank-phrase')).toContainText('第 1 /')
  await expect(page.getByTestId('qc-privacy')).toContainText('不会上传到任何服务器')

  // 打印 / 存图入口存在（打印 headless 下 no-op；PNG 触发下载）
  await expect(page.getByTestId('qq-print')).toBeVisible()
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('qq-png').click()])
  expect(dl.suggestedFilename()).toMatch(/第1周座位查询单\.png$/)

  // 结果区没有任何可编辑控件（只读）
  await expect(card.locator('input, textarea, select, button')).toHaveCount(0)
})

test('按学号精确查询；重名时先让选择，再用学号区分', async ({ page }) => {
  await setupClass(page)
  await page.getByRole('link', { name: '家长查询' }).first().click()
  await page.getByTestId('qq-class').selectOption({ index: 1 })

  // 只输入重名姓名 → 出现二次选择
  await page.getByTestId('qq-keyword').fill('林同同')
  await page.getByTestId('qq-go').click()
  const amb = page.getByTestId('qq-ambiguous')
  await expect(amb).toBeVisible()
  const candidates = page.getByTestId('qq-candidate')
  await expect(candidates).toHaveCount(2)

  // 点选带学号 42 的那位
  await candidates.filter({ hasText: '学号 42' }).click()
  await expect(page.getByTestId('query-card')).toBeVisible()
  await expect(page.getByTestId('qc-no')).toHaveText('学号 42')

  // 直接用学号查询唯一命中
  await page.getByTestId('qq-keyword').fill('42')
  await page.getByTestId('qq-go').click()
  await expect(page.getByTestId('qq-ambiguous')).toHaveCount(0)
  await expect(page.getByTestId('qc-name')).toHaveText('林同同')
  await expect(page.getByTestId('qc-no')).toHaveText('学号 42')
})

test('切换周次后结果随之变化；深链接直达班级查询页', async ({ page }) => {
  const { classId } = await setupClass(page)
  await page.goto(`/class/${classId}/query`)
  await expect(page.getByTestId('qq-class')).toBeVisible()
  await page.getByTestId('qq-week').selectOption('3')
  await page.getByTestId('qq-keyword').fill('陈一')
  await page.getByTestId('qq-go').click()
  await expect(page.getByTestId('query-card')).toBeVisible()
  await expect(page.locator('.qc-section h3').first()).toContainText('第 3 周座位')
})

test('查询页不提供任何改数据入口（无生成/交换/删除按钮）', async ({ page }) => {
  await setupClass(page)
  await page.getByRole('link', { name: '家长查询' }).first().click()
  await page.getByTestId('qq-class').selectOption({ index: 1 })
  await page.getByTestId('qq-keyword').fill('陈一')
  await page.getByTestId('qq-go').click()
  for (const tid of ['gen-all', 'regen-week', 'add-student', 'undo-swap', 'do-print']) {
    await expect(page.getByTestId(tid)).toHaveCount(0)
  }
})
