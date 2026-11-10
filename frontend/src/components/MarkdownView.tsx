import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import 'katex/dist/katex.min.css'
import { useEffect, useId, useRef, useState, type ReactElement } from 'react'
import { IconCheck, IconCopy, IconDownload, IconFile } from './icons'

/** 按扩展名分流的媒体/文件类型 */
const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'webm']
const VIDEO_EXT = ['mp4', 'webm', 'ogv', 'mov', 'm4v']
const FILE_EXT = [
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'txt', 'md',
  'zip', 'rar', '7z', 'tar', 'gz', 'json', 'xml', 'yaml', 'yml', 'log', 'sql',
]

function extOf(url: string): string {
  const clean = url.split(/[?#]/)[0]
  const name = clean.split('/').pop() ?? ''
  const parts = name.split('.')
  return parts.length > 1 ? parts.pop()!.toLowerCase() : ''
}

function fileNameOf(url: string): string {
  const clean = url.split(/[?#]/)[0]
  return decodeURIComponent(clean.split('/').pop() || url)
}

/** 音频 / 视频播放器（统一外观，浏览器原生控件） */
function MediaPlayer({ kind, src }: { kind: 'audio' | 'video'; src: string }) {
  if (kind === 'audio') {
    return (
      <div className="md-audio">
        <audio controls preload="metadata" src={src} />
      </div>
    )
  }
  return (
    <div className="md-video">
      <video controls preload="metadata" playsInline src={src} />
    </div>
  )
}

/** 文件卡片：图标 + 文件名 + 类型徽章 + 打开/下载 */
function FileCard({ href }: { href: string }) {
  const name = fileNameOf(href)
  const ext = extOf(href)
  return (
    <div className="file-card">
      <span className="file-card-icon"><IconFile size={18} /></span>
      <div className="file-card-meta">
        <span className="file-card-name" title={name}>{name}</span>
        <span className="file-card-ext">{ext ? ext.toUpperCase() : 'FILE'}</span>
      </div>
      <div className="file-card-actions">
        <a className="file-card-btn" href={href} target="_blank" rel="noreferrer">打开</a>
        <a className="file-card-btn primary" href={href} download>
          <IconDownload size={12} /> 下载
        </a>
      </div>
    </div>
  )
}

/** 语言 → 下载文件扩展名 */
const EXT_MAP: Record<string, string> = {
  javascript: 'js', typescript: 'ts', tsx: 'tsx', jsx: 'jsx', python: 'py',
  json: 'json', html: 'html', css: 'css', scss: 'scss', markdown: 'md',
  bash: 'sh', shell: 'sh', sql: 'sql', java: 'java', go: 'go', rust: 'rs',
  c: 'c', cpp: 'cpp', csharp: 'cs', yaml: 'yaml', xml: 'xml', php: 'php',
  ruby: 'rb', kotlin: 'kt', swift: 'swift', dockerfile: 'Dockerfile',
}

function downloadText(filename: string, text: string, mime = 'text/plain') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
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

/** 带头部（语言标签 + 复制/下载按钮）的代码块 */
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

  const download = () => {
    const ext = EXT_MAP[language.toLowerCase()] ?? 'txt'
    const name = language.toLowerCase() === 'dockerfile' ? 'Dockerfile' : `snippet.${ext}`
    downloadText(name, rawCode)
  }

  return (
    <div className="code-block">
      <div className="code-head">
        <span className="code-lang">{language || 'text'}</span>
        <div className="code-actions">
          <button className={`code-act ${copied ? 'ok' : ''}`} onClick={copy}>
            {copied ? <IconCheck size={12} /> : <IconCopy size={13} />}
            {copied ? '已复制' : '复制'}
          </button>
          <button className="code-act" onClick={download}>
            <IconDownload size={13} /> 下载
          </button>
        </div>
      </div>
      <pre ref={preRef}><code className={`hljs${language ? ` language-${language}` : ''}`}>{highlighted}</code></pre>
    </div>
  )
}

/** 表格：横向滚动 + 复制为 CSV */
function TableBlock({ children }: { children: React.ReactNode }) {
  const tableRef = useRef<HTMLTableElement>(null)
  const [copied, setCopied] = useState(false)

  const copyCsv = () => {
    const table = tableRef.current
    if (!table) return
    const rows = Array.from(table.querySelectorAll('tr')).map((tr) =>
      Array.from(tr.querySelectorAll('th,td'))
        .map((cell) => `"${(cell.textContent ?? '').replace(/"/g, '""').trim()}"`)
        .join(','),
    )
    navigator.clipboard.writeText(rows.join('\n')).catch(() => undefined)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="md-table-wrap">
      <button
        className={`md-table-copy ${copied ? 'ok' : ''}`}
        onClick={copyCsv}
        title={copied ? '已复制' : '复制表格（CSV）'}
        aria-label={copied ? '已复制' : '复制表格'}
      >
        {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
      </button>
      <div className="md-table-scroll">
        <table ref={tableRef}>{children}</table>
      </div>
    </div>
  )
}

/** 图片：点击下载（跨域失败降级新标签打开） */
function MdImage({ src, alt }: { src?: string; alt?: string }) {
  const download = async () => {
    if (!src) return
    try {
      const resp = await fetch(src)
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = alt || src.split('/').pop()?.split('?')[0] || 'image'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      window.open(src, '_blank')
    }
  }
  return (
    <span className="md-img-wrap">
      <img src={src} alt={alt ?? ''} loading="lazy" className="md-img" />
      {src && (
        <button className="md-img-dl" onClick={download} title="下载图片">
          <IconDownload size={13} />
        </button>
      )}
    </span>
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

/** 升级版 Markdown 渲染：代码/表格/图片/流程图/LaTeX/音视频/文件卡片 */
export function MarkdownView({ content }: { content: string }) {
  return (
    <div className="bubble-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, rehypeKatex, rehypeHighlight]}
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
          table: ({ children }) => <TableBlock>{children}</TableBlock>,
          img: ({ src, alt }) => (
            <MdImage src={typeof src === 'string' ? src : undefined} alt={alt ?? undefined} />
          ),
          // 链接按扩展名分流：音频/视频 → 播放器，文档 → 文件卡片，其余普通链接
          a: ({ href, children }) => {
            const url = typeof href === 'string' ? href : ''
            const ext = extOf(url)
            if (AUDIO_EXT.includes(ext)) return <MediaPlayer kind="audio" src={url} />
            if (VIDEO_EXT.includes(ext)) return <MediaPlayer kind="video" src={url} />
            if (FILE_EXT.includes(ext)) return <FileCard href={url} />
            return (
              <a href={url} target="_blank" rel="noreferrer">{children}</a>
            )
          },
          // 支持直接写 <audio> / <video> 标签（rehype-raw 解析后统一换样式）
          audio: ({ src }) => <MediaPlayer kind="audio" src={typeof src === 'string' ? src : ''} />,
          video: ({ src }) => <MediaPlayer kind="video" src={typeof src === 'string' ? src : ''} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
