import { useEffect, useState } from 'react'
import { fetchConfig, saveConfig } from '../api'
import type { PlatformConfig } from '../api'
import { IconX } from './icons'

export function SettingsModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [cfg, setCfg] = useState<PlatformConfig | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetchConfig()
      .then((c) => {
        setCfg(c)
        setBaseUrl(c.base_url)
        setModel(c.model)
      })
      .catch(() => setMessage('无法读取当前配置（后端未连接）'))
  }, [])

  const submit = async () => {
    setSaving(true)
    setMessage('')
    try {
      const payload: { base_url?: string; api_key?: string; model?: string } = {
        base_url: baseUrl,
        model,
      }
      if (apiKey.trim()) payload.api_key = apiKey.trim() // 留空 = 保留已存 Key
      const r = await saveConfig(payload)
      setMessage(r.provider === 'mock' ? '未填写 Key，当前仍为演示模式' : `已接入 ${r.provider}`)
      onSaved()
    } catch (e) {
      setMessage(`保存失败：${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>接入模型服务</h2>
          <button className="modal-close" onClick={onClose} aria-label="关闭"><IconX size={14} /></button>
        </div>

        <label className="field">
          <span>API 地址（OpenAI 兼容）</span>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.deepseek.com"
          />
        </label>
        <label className="field">
          <span>API Key {cfg?.has_key && <em className="hint-inline">已保存，留空则不修改</em>}</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
          />
        </label>
        <label className="field">
          <span>模型名称</span>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="deepseek-chat / glm-4-flash / moonshot-v1-8k"
          />
        </label>

        <div className="field-tips">
          <p>支持任意 OpenAI 兼容服务商，常用 API 地址：</p>
          <ul>
            <li>DeepSeek：<code>https://api.deepseek.com</code>（模型 deepseek-chat）</li>
            <li>智谱 GLM：<code>https://open.bigmodel.cn/api/paas/v4</code></li>
            <li>Moonshot：<code>https://api.moonshot.cn/v1</code></li>
          </ul>
        </div>

        {message && <div className="modal-message">{message}</div>}

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>取消</button>
          <button className="btn primary" onClick={submit} disabled={saving || !baseUrl || !model}>
            {saving ? '保存中…' : '保存并测试'}
          </button>
        </div>
      </div>
    </div>
  )
}
