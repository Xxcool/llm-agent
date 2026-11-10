import { useEffect, useRef, useState } from 'react'
import { addKnowledgeText, deleteKnowledge, listKnowledge, uploadKnowledgeFile } from '../api'
import type { KnowledgeDoc } from '../api'

export function KnowledgePanel({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [docName, setDocName] = useState('')
  const [docText, setDocText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = () => {
    listKnowledge()
      .then(setDocs)
      .catch(() => setMessage('无法读取知识库列表'))
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [])

  const handleUpload = async (file: File) => {
    setMessage('')
    try {
      await uploadKnowledgeFile(file)
      refresh()
      onChanged()
    } catch (e) {
      setMessage(`上传失败：${(e as Error).message}`)
    }
  }

  const handlePaste = async () => {
    if (!docName.trim() || !docText.trim()) return
    setMessage('')
    try {
      await addKnowledgeText(docName.trim(), docText)
      setPasteOpen(false)
      setDocName('')
      setDocText('')
      refresh()
      onChanged()
    } catch (e) {
      setMessage(`添加失败：${(e as Error).message}`)
    }
  }

  const handleDelete = async (source: string) => {
    setMessage('')
    try {
      await deleteKnowledge(source)
      refresh()
      onChanged()
    } catch (e) {
      setMessage(`删除失败：${(e as Error).message}`)
    }
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>知识库管理</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <p className="panel-sub">
          上传 Markdown / 文本文件，或直接粘贴内容。文档自动分块、向量化并即时生效，
          回答时可被 Agent 检索引用。
        </p>

        <div className="panel-actions">
          <button className="btn primary" onClick={() => fileRef.current?.click()}>📎 上传文件</button>
          <button className="btn ghost" onClick={() => setPasteOpen((v) => !v)}>
            {pasteOpen ? '收起粘贴框' : '📝 粘贴文本'}
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
        </div>

        {pasteOpen && (
          <div className="paste-box">
            <input
              value={docName}
              onChange={(e) => setDocName(e.target.value)}
              placeholder="文档名称，如：Rust 入门笔记"
            />
            <textarea
              value={docText}
              onChange={(e) => setDocText(e.target.value)}
              placeholder="粘贴文档内容（Markdown / 纯文本）…"
              rows={6}
            />
            <button className="btn primary small" onClick={handlePaste} disabled={!docName.trim() || !docText.trim()}>
              添加到知识库
            </button>
          </div>
        )}

        {message && <div className="modal-message">{message}</div>}

        <div className="doc-list">
          {loading && <p className="panel-sub">加载中…</p>}
          {!loading && docs.length === 0 && <p className="panel-sub">知识库为空，先上传一份文档吧</p>}
          {docs.map((d) => (
            <div key={d.source} className="doc-row">
              <span className="doc-icon">📄</span>
              <span className="doc-name" title={d.source}>{d.source}</span>
              <span className="doc-chunks">{d.chunks} 块</span>
              <button className="doc-del" onClick={() => handleDelete(d.source)} title="删除文档">✕</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
