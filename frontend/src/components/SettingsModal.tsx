import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchConfig, saveConfig, testConfig } from '../api'
import type { PlatformConfig } from '../api'
import { IconChevron, IconX } from './icons'
import deepseekLogo from '../assets/providers/deepseek.svg'
import qwenLogo from '../assets/providers/qwen.svg'
import moonshotLogo from '../assets/providers/moonshotai.svg'
import ollamaLogo from '../assets/providers/ollama.svg'
import anthropicLogo from '../assets/providers/anthropic.svg'
import zhipuLogo from '../assets/providers/zhipu.svg'
import geminiLogo from '../assets/providers/gemini.svg'

interface ProviderPreset {
  name: string
  base_url: string
  models: string[]
  color: string
}

/** 服务商预设：品牌 logo + 一键填充地址，models 供下拉选择 */
const PROVIDER_PRESETS: ProviderPreset[] = [
  { name: 'DeepSeek', base_url: 'https://api.deepseek.com', color: '#4D6BFE', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { name: '智谱 GLM', base_url: 'https://open.bigmodel.cn/api/paas/v4', color: '#2454FF', models: ['glm-4-flash', 'glm-4-plus', 'glm-4.5', 'glm-4.5-air'] },
  { name: '通义千问', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', color: '#615CED', models: ['qwen-plus', 'qwen-turbo', 'qwen-max'] },
  { name: 'Moonshot', base_url: 'https://api.moonshot.cn/v1', color: '#1E1E1E', models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'] },
  { name: '硅基流动', base_url: 'https://api.siliconflow.cn/v1', color: '#7C3AED', models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-7B-Instruct', 'THUDM/glm-4-9b-chat'] },
  { name: 'Mistral', base_url: 'https://api.mistral.ai/v1', color: '#FA520F', models: ['mistral-small-latest', 'mistral-large-latest'] },
  { name: 'Google Gemini', base_url: 'https://generativelanguage.googleapis.com/v1beta/openai', color: '#4796E3', models: ['gemini-2.0-flash', 'gemini-1.5-pro'] },
  { name: 'Claude', base_url: 'https://api.anthropic.com/v1', color: '#191919', models: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-1'] },
  { name: '本地 Ollama', base_url: 'http://localhost:11434/v1', color: '#4B5568', models: ['llama3.1', 'qwen2.5', 'deepseek-r1'] },
]

/** 官方品牌 logo（Simple Icons，构建期内置）；没有的用品牌色字母徽标兜底 */
const PROVIDER_LOGOS: Record<string, string> = {
  DeepSeek: deepseekLogo,
  '智谱 GLM': zhipuLogo,
  通义千问: qwenLogo,
  Moonshot: moonshotLogo,
  '本地 Ollama': ollamaLogo,
  Claude: anthropicLogo,
  'Google Gemini': geminiLogo,
}

function ProviderMark({ name, color, size = 20 }: { name: string; color: string; size?: number }) {
  const logo = PROVIDER_LOGOS[name]
  if (logo) {
    return <img src={logo} width={size} height={size} alt="" className="provider-img" />
  }
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
