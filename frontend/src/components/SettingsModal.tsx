import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchConfig, saveConfig, testConfig } from '../api'
import type { PlatformConfig } from '../api'
import { IconChevron, IconX } from './icons'

interface ProviderPreset {
  name: string
  base_url: string
  models: string[]
  color: string
}

/** 服务商预设：品牌色徽标 + 一键填充地址，models 供下拉选择 */
const PROVIDER_PRESETS: ProviderPreset[] = [
  { name: 'DeepSeek', base_url: 'https://api.deepseek.com', color: '#4D6BFE', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { name: '智谱 GLM', base_url: 'https://open.bigmodel.cn/api/paas/v4', color: '#2454FF', models: ['glm-4-flash', 'glm-4-plus', 'glm-4.5', 'glm-4.5-air'] },
  { name: '通义千问', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', color: '#615CED', models: ['qwen-plus', 'qwen-turbo', 'qwen-max'] },
  { name: 'Moonshot', base_url: 'https://api.moonshot.cn/v1', color: '#1E1E1E', models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'] },
  { name: '硅基流动', base_url: 'https://api.siliconflow.cn/v1', color: '#7C3AED', models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-7B-Instruct', 'THUDM/glm-4-9b-chat'] },
  { name: 'OpenAI', base_url: 'https://api.openai.com/v1', color: '#10A37F', models: ['gpt-4o-mini', 'gpt-4o'] },
  { name: '本地 Ollama', base_url: 'http://localhost:11434/v1', color: '#4B5568', models: ['llama3.1', 'qwen2.5', 'deepseek-r1'] },
]

/** 品牌色圆形字母徽标 */
function ProviderMark({ name, color, size = 20 }: { name: string; color: string; size?: number }) {
  return (
    <span className="provider-mark" style={{ background: color, width: size, height: size, fontSize: size * 0.55 }}>
      {name.slice(0, 1)}
    </span>
  )
}

export function SettingsModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [cfg, setCfg] = useState<PlatformConfig | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [modelListOpen, setModelListOpen] = useState(false)
  const modelComboRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchConfig()
      .then((c) => {
        setCfg(c)
        setBaseUrl(c.base_url)
        setModel(c.model)
      })
      .catch(() => setMessage('无法读取当前配置（后端未连接）'))
  }, [])

  // 点击外部关闭模型下拉
  useEffect(() => {
    if (!modelListOpen) return
    const close = (e: MouseEvent) => {
      if (!modelComboRef.current?.contains(e.target as Node)) setModelListOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [modelListOpen])

  const hasSavedKey = Boolean(cfg?.has_key)
  const keyReady = hasSavedKey || apiKey.trim().length > 0

  /** 按当前 API 地址识别服务商（匹配 host），给出对应模型建议 */
  const matchedProvider = useMemo(() => {
    try {
      const host = new URL(baseUrl.trim()).host
      return PROVIDER_PRESETS.find((p) => new URL(p.base_url).host === host)
    } catch {
      return undefined
    }
  }, [baseUrl])

  const modelSuggestions = matchedProvider?.models ?? []

  const applyPreset = (p: ProviderPreset) => {
    setBaseUrl(p.base_url)
    setModel(p.models[0])
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
          <span className="field-label">常用服务商（点击填充，也支持任意 OpenAI 兼容地址）</span>
          <div className="preset-chips">
            {PROVIDER_PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                className={`preset-chip ${matchedProvider?.name === p.name ? 'active' : ''}`}
                onClick={() => applyPreset(p)}
                title={p.base_url}
              >
                <ProviderMark name={p.name} color={p.color} />
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
            placeholder="https://api.deepseek.com 或 http://localhost:11434/v1"
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

        <div className="field">
          <span className="field-label">模型名称</span>
          <div className="model-combo" ref={modelComboRef}>
            <input
              value={model}
              onChange={(e) => {
                setModel(e.target.value)
                setModelListOpen(true)
              }}
              onFocus={() => setModelListOpen(true)}
              placeholder="选择或输入模型名"
            />
            <button
              type="button"
              className="model-combo-toggle"
              onClick={() => setModelListOpen((v) => !v)}
              aria-label="展开模型列表"
            >
              <span className={`steps-chevron ${modelListOpen ? 'down' : ''}`}>
                <IconChevron size={12} />
              </span>
            </button>
            {modelListOpen && modelSuggestions.length > 0 && (
              <div className="model-list">
                {modelSuggestions.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`model-option ${m === model ? 'active' : ''}`}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      setModel(m)
                      setModelListOpen(false)
                    }}
                  >
                    {matchedProvider && <ProviderMark name={matchedProvider.name} color={matchedProvider.color} size={16} />}
                    {m}
                  </button>
                ))}
                <div className="model-list-hint">也可直接手动输入任意模型名</div>
              </div>
            )}
          </div>
        </div>

        <div className="field-tips">
          <p>支持任意 OpenAI 兼容服务商（含 vLLM / Ollama 等自建服务）。保存时会真实调用一次模型验证可用性。</p>
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
