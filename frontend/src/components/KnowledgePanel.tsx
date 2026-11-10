import { useEffect, useRef, useState } from 'react'
import {
  addKnowledgeText,
  deleteKnowledge,
  importUrls,
  listKnowledge,
  uploadKnowledgeDir,
  uploadKnowledgeFile,
} from '../api'
import type { KnowledgeDoc } from '../api'
import { IconFile, IconFolder, IconLink, IconPencil, IconUpload, IconX } from './icons'

type ImportMode = 'none' | 'paste' | 'url'

export function KnowledgePanel({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<ImportMode>('none')
  const [docName, setDocName] = useState('')
  const [docText, setDocText] = useState('')
  const [urlText, setUrlText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)

  /** 上传整个文件夹：保留相对目录结构，仅收 .md/.txt/.markdown */
  const handleFolderUpload = (fileList: FileList) =>
    run(async () => {
      const SUPPORTED = /\.(md|txt|markdown)$/i
      const items = Array.from(fileList)
        .map((f) => ({ file: f, relPath: f.webkitRelativePath || f.name }))
        .filter((it) => SUPPORTED.test(it.relPath))
      const total = fileList.length
      if (items.length === 0) {
        setMessage(`所选文件夹中没有可入库的文档（仅支持 .md / .txt / .markdown，共 ${total} 个文件）`)
        return
      }
      const r = await uploadKnowledgeDir(items)
      const skipNote = r.skipped.length ? `，跳过 ${r.skipped.length} 个不支持的文件` : ''
      setMessage(
        `文件夹导入完成：入库 ${r.saved.length} 篇${skipNote}，共 ${r.total_chunks} 个知识块（目录结构已保留）`,
      )
    })

  const refresh = () => {
    listKnowledge()
      .then(setDocs)
      .catch(() => setMessage('无法读取知识库列表'))
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setMessage('')
    try {
      await fn()
      refresh()
      onChanged()
    } catch (e) {
      setMessage(`操作失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const handleUpload = (file: File) =>
    run(async () => {
      await uploadKnowledgeFile(file)
      setMessage(`已上传并入库：${file.name}`)
    })

  const handlePaste = () =>
    run(async () => {
      await addKnowledgeText(docName.trim(), docText)
      setMode('none')
      setDocName('')
      setDocText('')
      setMessage('文本已入库，可立即问答')
    })

  const handleUrls = () =>
    run(async () => {
      const urls = urlText.split(/\s+/).map((u) => u.trim()).filter(Boolean)
      if (urls.length === 0) throw new Error('请至少填写一个链接')
      const r = await importUrls(urls)
      setMessage(
        `导入完成：成功 ${r.saved.length} 篇${r.failed.length ? `，失败 ${r.failed.length} 篇（${r.failed[0].error}）` : ''}`,
      )
      if (r.saved.length) setUrlText('')
    })

  const handleDelete = (source: string) =>
    run(async () => {
      await deleteKnowledge(source)
      setMessage(`已删除：${source}`)
    })

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>知识库管理</h2>
          <button className="modal-close" onClick={onClose} aria-label="关闭"><IconX size={14} /></button>
        </div>

        <p className="panel-sub">
          知识库用于沉淀企业制度、产品文档、技术资料与业务流程。支持本地上传、文本录入与链接抓取，
          文档自动分块向量化，问答时被智能体检索并标注来源。
        </p>

        <div className="panel-actions">
          <button className="btn primary" onClick={() => folderRef.current?.click()} disabled={busy}>
            <IconFolder size={14} /> 上传文件夹
          </button>
          <button className="btn ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
            <IconUpload size={14} /> 上传文件
          </button>
          <button className="btn ghost" onClick={() => setMode(mode === 'paste' ? 'none' : 'paste')}>
            <IconPencil size={14} /> 文本录入
          </button>
          <button className="btn ghost" onClick={() => setMode(mode === 'url' ? 'none' : 'url')}>
            <IconLink size={14} /> 链接导入
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".md,.txt,.markdown"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleUpload(f)
              e.target.value = ''
            }}
          />
          <input
            ref={folderRef}
            type="file"
            hidden
            multiple
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
            onChange={(e) => {
              const files = e.target.files
              if (files && files.length > 0) handleFolderUpload(files)
              e.target.value = ''
            }}
          />
        </div>

        {mode === 'paste' && (
          <div className="paste-box">
            <input
              value={docName}
              onChange={(e) => setDocName(e.target.value)}
              placeholder="文档名称，如：员工报销制度"
            />
            <textarea
              value={docText}
              onChange={(e) => setDocText(e.target.value)}
              placeholder="粘贴文档内容（Markdown / 纯文本）…"
              rows={6}
            />
            <button className="btn primary small" onClick={handlePaste} disabled={busy || !docName.trim() || !docText.trim()}>
              {busy ? '处理中…' : '添加到知识库'}
            </button>
          </div>
        )}

        {mode === 'url' && (
          <div className="paste-box">
            <textarea
              value={urlText}
              onChange={(e) => setUrlText(e.target.value)}
              placeholder={'粘贴文档链接，一行一个（最多 10 个）\nhttps://intranet.example.com/docs/xxx'}
              rows={4}
            />
            <button className="btn primary small" onClick={handleUrls} disabled={busy || !urlText.trim()}>
              {busy ? '抓取中…' : '抓取正文并入库'}
            </button>
          </div>
        )}

        {message && <div className="modal-message">{message}</div>}

        <div className="doc-list">
          {loading && <p className="panel-sub">加载中…</p>}
          {!loading && docs.length === 0 && <p className="panel-sub">知识库为空，先导入一份文档吧</p>}
          {docs.map((d) => (
            <div key={d.source} className="doc-row">
              <span className="doc-icon"><IconFile size={14} /></span>
              <span className="doc-name" title={d.source}>{d.source}</span>
              <span className="doc-chunks">{d.chunks} 块</span>
              <button className="doc-del" onClick={() => handleDelete(d.source)} disabled={busy} title="删除文档">
                <IconX size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
