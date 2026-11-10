import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { useEffect, useId, useRef, useState, type ReactElement } from 'react'
import { IconCheck } from './icons'

/** 复制图标（仅此处使用，内联维护） */
function IconCopy({ size = 13 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" aria-hidden>
      <rect x="5.2" y="5.2" width="8.3" height="8.3" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10.8 5V3.4A1.4 1.4 0 0 0 9.4 2H3.4A1.4 1.4 0 0 0 2 3.4v6a1.4 1.4 0 0 0 1.4 1.4H5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

/** mermaid 流程图渲染（流式期间 250ms 防抖，失败降级显示源码） */
function MermaidDiagram({ chart }: { chart: string }) {
  const rawId = useId()
  const id = `mmd-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`
  const [svg, setSvg] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setFailed(false)
    const timer = window.setTimeout(async () => {
      try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' })
        const { svg: out } = await mermaid.render(id, chart)
        if (alive) setSvg(out)
      } catch {
        if (alive) setFailed(true)
      }
    }, 250)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [chart, id])

  if (failed) {
    return <pre className="mermaid-fallback"><code>{chart}</code></pre>
  }
  if (!svg) {
    return <div className="mermaid-loading">流程图渲染中…</div>
  }
  return <div className="mermaid-box" dangerouslySetInnerHTML={{ __html: svg }} />
}

/** 带头部（语言标签 + 复制按钮）的代码块 */
function CodeBlock({ language, highlighted, rawCode }: {
  language: string
  highlighted: React.ReactNode // rehype-highlight 生成的带语法色子节点
  rawCode: string
}) {
  const [copied, setCopied] = useState(false)
  const preRef = useRef<HTMLPreElement>(null)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(rawCode)
    } catch {
      // 剪贴板不可用时降级：读取 DOM 文本
      const text = preRef.current?.textContent ?? rawCode
      await navigator.clipboard.writeText(text).catch(() => undefined)
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="code-block">
      <div className="code-head">
        <span className="code-lang">{language || 'text'}</span>
        <button className={`code-copy ${copied ? 'ok' : ''}`} onClick={copy}>
          {copied ? <IconCheck size={12} /> : <IconCopy />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre ref={preRef}><code className={`hljs${language ? ` language-${language}` : ''}`}>{highlighted}</code></pre>
    </div>
  )
}

/** 从 ReactMarkdown 的 pre 子节点提取代码信息 */
function extractCode(children: React.ReactNode): {
  language: string
  highlighted: React.ReactNode
  rawCode: string
} | null {
  const child = (Array.isArray(children) ? children[0] : children) as ReactElement | undefined
  if (!child?.props) return null
  const className: string = String(child.props.className ?? '')
  const language = /language-([\w-]+)/.exec(className)?.[1] ?? ''

  // 递归提取纯文本（供复制按钮使用）
  const toText = (node: React.ReactNode): string => {
    if (node === null || node === undefined || typeof node === 'boolean') return ''
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(toText).join('')
    const el = node as ReactElement
    if (el.props) return toText(el.props.children)
    return ''
  }

  return {
    language,
    highlighted: child.props.children,
    rawCode: toText(child.props.children).replace(/\n$/, ''),
  }
}

/** 升级版 Markdown 渲染：代码块头部 + 语法高亮 + mermaid 流程图 + 图片适配 */
export function MarkdownView({ content }: { content: string }) {
  return (
    <div className="bubble-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: ({ children }) => {
            const info = extractCode(children)
            if (!info) return <pre>{children}</pre>
            if (info.language === 'mermaid') {
              return <MermaidDiagram chart={info.rawCode} />
            }
            return (
              <CodeBlock language={info.language} highlighted={info.highlighted} rawCode={info.rawCode} />
            )
          },
          img: ({ src, alt, ...rest }) => (
            <img
              src={typeof src === 'string' ? src : undefined}
              alt={alt ?? ''}
              loading="lazy"
              className="md-img"
              {...rest}
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
