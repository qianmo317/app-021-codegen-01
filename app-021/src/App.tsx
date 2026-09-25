import { useEffect } from 'react'
import { Link, usePath } from './router'
import { ClassList } from './pages/ClassList'
import { Setup } from './pages/Setup'
import { Rotations } from './pages/Rotations'
import { Fairness } from './pages/Fairness'
import { Print } from './pages/Print'
import { ParentQuery } from './pages/ParentQuery'
import { useStore } from './store'
import { Armchair } from 'lucide-react'

// 打印时 @page 尺寸：普通座位表用 A4 纵向；家长查询单用窄版（一张小图比例）
const PAGE_RULES: Record<string, string> = {
  print: '@page { size: A4 portrait; margin: 8mm; }',
  query: '@page { size: 148mm 210mm; margin: 8mm; }',
}

function usePrintPageRule(mode: 'print' | 'query' | null) {
  useEffect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-print-page', '')
    document.head.appendChild(style)
    const apply = () => {
      style.textContent = mode ? PAGE_RULES[mode] : ''
    }
    apply()
    return () => {
      style.remove()
    }
  }, [mode])
}

export function App() {
  const path = usePath()
  const { ready } = useStore()

  if (!ready) {
    return <div className="loading">加载本地数据中…</div>
  }

  const printMode = /^\/class\/[^/]+\/print$/.test(path)
  const queryMode = /^\/class\/[^/]+\/query$/.test(path) || path === '/query'

  const appClass = ['app', printMode ? 'app-print' : '', queryMode ? 'app-print app-query' : ''].filter(Boolean).join(' ')

  return (
    <div className={appClass}>
      {!(printMode || queryMode) && (
        <header className="topbar">
          <Link to="/" className="brand">
            <Armchair size={20} />
            <span>教室座位轮换编排</span>
          </Link>
          <Link to="/query" className="topbar-query">
            家长查询
          </Link>
          <span className="topbar-note">数据仅保存在本机浏览器 · 不上传任何学生信息</span>
        </header>
      )}
      <main className={printMode || queryMode ? 'main main-print' : 'main'}>
        <Route path={path} />
      </main>
      <PrintPageRule mode={printMode ? 'print' : queryMode ? 'query' : null} />
    </div>
  )
}

function PrintPageRule({ mode }: { mode: 'print' | 'query' | null }) {
  usePrintPageRule(mode)
  return null
}

function Route({ path }: { path: string }) {
  if (path === '/' || path === '') return <ClassList />
  if (path === '/query') return <ParentQuery />
  const m = path.match(/^\/class\/([^/]+)(\/(setup|rotations|fairness|print|query))?$/)
  if (m) {
    const id = decodeURIComponent(m[1])
    switch (m[3]) {
      case 'setup':
        return <Setup classId={id} />
      case 'rotations':
        return <Rotations classId={id} />
      case 'fairness':
        return <Fairness classId={id} />
      case 'print':
        return <Print classId={id} />
      case 'query':
        return <ParentQuery classId={id} />
      default:
        return <Setup classId={id} />
    }
  }
  return (
    <div className="page">
      <h2>页面不存在</h2>
      <Link to="/">返回班级列表</Link>
    </div>
  )
}
