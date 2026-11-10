import { useEffect, useState } from 'react'
import { fetchConfig, saveConfig, testConfig } from '../api'
import type { PlatformConfig } from '../api'
import { IconX } from './icons'

/** 服务商预设：一键填充地址 + 推荐模型 */
const PROVIDER_PRESETS = [
  { name: 'DeepSeek', base_url: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { name: '智谱 GLM', base_url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { name: 'Moonshot', base_url: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
]

/** 常见模型名（输入时下拉提示） */
const MODEL_SUGGESTIONS = [
  'deepseek-chat', 'deepseek-reasoner',
  'glm-4-flash', 'glm-4-plus', 'glm-4.5',
  'moonshot-v1-8k', 'moonshot-v1-32k',
  'qwen-plus', 'qwen-turbo',
]

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

  const hasSavedKey = Boolean(cfg?.has_key)
  const keyReady = hasSavedKey || apiKey.trim().length > 0

  const applyPreset = (p: (typeof PROVIDER_PRESETS)[number]) => {
    setBaseUrl(p.base_url)
    setModel(p.model)
  }

  const submit = async () => {
    setSaving(true)
    setMessage('')
    try {
      const payload: { base_url?: string; api_key?: string; model?: string } = {
        base_url: baseUrl,
        model,
      }
      if (apiKey.trim()) payload.api_key = apiKey.trim() // 留空 = 保留已存 Key

      // ① 真实调用一次模型验证可用性，失败则不保存
      const t = await testConfig({
        base_url: baseUrl,
        model,
        api_key: apiKey.trim() || undefined,
      })
      if (!t.ok) {
        setMessage(`连接失败：${t.error}（配置未保存）`)
        return
      }

      // ② 测试通过才保存
      await saveConfig(payload)
      const c = await fetchConfig()
      setCfg(c)
      setApiKey('')
      setMessage(`连接成功，模型回复「${t.reply}」，已保存配置`)
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

        <div className="field">
          <span className="field-label">服务商快捷填充</span>
          <div className="preset-chips">
            {PROVIDER_PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                className={`preset-chip ${baseUrl === p.base_url ? 'active' : ''}`}
                onClick={() => applyPreset(p)}
              >
                {p.name}
              </button>
            ))}
          </div>
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
          <span>
            API Key{' '}
            {hasSavedKey && (
              <em className="hint-inline">已保存 {cfg?.key_masked}，留空则继续使用</em>
            )}
          </span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={hasSavedKey ? '留空继续使用已保存的 Key' : 'sk-...'}
          />
        </label>
        <label className="field">
          <span>模型名称（可下拉选择或手动输入）</span>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            list="model-presets"
            placeholder="deepseek-chat / glm-4-flash / moonshot-v1-8k"
          />
          <datalist id="model-presets">
            {MODEL_SUGGESTIONS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>

        <div className="field-tips">
          <p>支持任意 OpenAI 兼容服务商。保存时会真实调用一次模型验证可用性。</p>
        </div>

        {message && <div className="modal-message">{message}</div>}

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>取消</button>
          <button className="btn primary" onClick={submit} disabled={saving || !baseUrl || !model || !keyReady}>
            {saving ? '测试连接中…' : '保存并测试'}
          </button>
        </div>
      </div>
    </div>
  )
}
