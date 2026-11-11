import { Component, lazy, Suspense, type ReactNode } from 'react'

const MarkdownContent = lazy(() => import('./MarkdownContent'))

class MarkdownBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

/** 富文本依赖按需加载，初始页面与输入交互不等待公式和语法高亮。 */
export function MarkdownView({ content }: { content: string }) {
  const plain = <div className="bubble-md" style={{ whiteSpace: 'pre-wrap' }}>{content}</div>
  return (
    <MarkdownBoundary fallback={plain}>
      <Suspense fallback={plain}>
        <MarkdownContent content={content} />
      </Suspense>
    </MarkdownBoundary>
  )
}
