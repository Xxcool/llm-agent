import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchConfig, saveConfig, testConfig } from '../api'
import type { PlatformConfig } from '../api'
import { IconCheck, IconChevron, IconX } from './icons'
import { PROVIDER_PRESETS, ProviderMark } from './providerInfo'
import type { ProviderPreset } from './providerInfo'

const EyeIcon = ({ off = false }: { off?: boolean }) => (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden>
    <path d="M1.4 8S3.9 3.4 8 3.4 14.6 8 14.6 8 12.1 12.6 8 12.6 1.4 8 1.4 8Z" stroke="currentColor" strokeWidth="1.2" />
    <circle cx="8" cy="8" r="2.1" stroke="currentColor" strokeWidth="1.2" />
    {off && <path d="M2.6 13 13.4 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />}
  </svg>
)

export function SettingsModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [cfg, setCfg] = useState<PlatformConfig | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState('')
  // null = 中性 / true = 成功（绿）/ false = 失败（红）
  const [msgOk, setMsgOk] = useState<boolean | null>(null)
  const [modelListOpen, setModelListOpen] = useState(false)
  const [providerOpen, setProviderOpen] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const modelComboRef = useRef<HTMLDivElement>(null)
  const providerSelectRef = useRef<HTMLDivElement>(null)
  const baseUrlRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchConfig()
      .then((c) => {
        setCfg(c)
        setBaseUrl(c.base_url)
        setModel(c.model)
      })
      .catch(() => setMessage('无法读取当前配置（后端未连接）'))
  }, [])

  // 点击外部关闭下拉
  useEffect(() => {
    if (!modelListOpen && !providerOpen) return
    const close = (e: MouseEvent) => {
      if (modelListOpen && !modelComboRef.current?.contains(e.target as Node)) setModelListOpen(false)
      if (providerOpen && !providerSelectRef.current?.contains(e.target as Node)) setProviderOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [modelListOpen, providerOpen])

  const hasSavedKey = Boolean(cfg?.has_key)
  const sameEndpoint = baseUrl.trim().replace(/\/$/, '') === cfg?.base_url.replace(/\/$/, '')
  const keyReady = (hasSavedKey && sameEndpoint) || apiKey.trim().length > 0

  /** 按当前 API 地址识别服务商（匹配 host），给出对应模型建议 */
  const matchedProvider = useMemo((): ProviderPreset | null => {
    try {
      const host = new URL(baseUrl.trim()).host
      return PROVIDER_PRESETS.find((p) => new URL(p.base_url).host === host) ?? null
    } catch {
      return null
    }
  }, [baseUrl])

  const modelSuggestions = matchedProvider?.models ?? []

  const applyPreset = (p: ProviderPreset) => {
    setBaseUrl(p.base_url)
    setModel(p.models[0])
    setMessage('')
    setMsgOk(null)
  }

  /** 独立测试连接：只验证当前表单配置，不落盘 */
  const testConnection = async () => {
    setTesting(true)
    setMessage('')
    setMsgOk(null)
    try {
      const t = await testConfig({
        base_url: baseUrl,
        model,
        api_key: apiKey.trim() || undefined,
      })
      if (t.ok) {
        setMessage(`连接成功，模型回复「${t.reply}」`)
        setMsgOk(true)
      } else {
        setMessage(`连接失败：${t.error}`)
        setMsgOk(false)
      }
    } catch (e) {
      setMessage(`测试失败：${(e as Error).message}`)
      setMsgOk(false)
    } finally {
      setTesting(false)
    }
  }

  const submit = async () => {
    setSaving(true)
    setMessage('')
    setMsgOk(null)
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
        setMsgOk(false)
        return
      }

      // ② 测试通过才保存
      await saveConfig(payload)
      const c = await fetchConfig()
      setCfg(c)
      setApiKey('')
      setMessage(`已保存配置，模型回复「${t.reply}」`)
      setMsgOk(true)
      onSaved()
    } catch (e) {
      setMessage(`保存失败：${(e as Error).message}`)
      setMsgOk(false)
    } finally {
      setSaving(false)
    }
  }

  const canTest = Boolean(baseUrl.trim() && model.trim() && keyReady)

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>接入模型服务</h2>
          <button className="modal-close" onClick={onClose} aria-label="关闭"><IconX size={14} /></button>
        </div>

        <p className="field-hint">此浏览器的对话、知识库和模型配置独立保存，无需登录。清除网站数据或换浏览器会进入新工作区。</p>

        <div className="field">
          <span className="field-label">服务商（仅支持 OpenAI 兼容协议 API）</span>
          <div className="provider-select" ref={providerSelectRef}>
            <button
              type="button"
              className="provider-select-btn"
              onClick={() => setProviderOpen((v) => !v)}
            >
              {matchedProvider ? (
                <>
                  <ProviderMark name={matchedProvider.name} color={matchedProvider.color} />
                  {matchedProvider.name}
                </>
              ) : baseUrl.trim() ? (
                <>
                  <ProviderMark name="自定义" color="#6B7280" />
                  自定义服务
                </>
              ) : (
                <span className="provider-placeholder">选择服务商</span>
              )}
              <span className={`steps-chevron ${providerOpen ? 'down' : ''}`}>
                <IconChevron size={12} />
              </span>
            </button>
            {providerOpen && (
              <div className="provider-list">
                {PROVIDER_PRESETS.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    className={`provider-option ${matchedProvider?.name === p.name ? 'active' : ''}`}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      applyPreset(p)
                      setProviderOpen(false)
                    }}
                    title={p.base_url}
                  >
                    <ProviderMark name={p.name} color={p.color} size={16} />
                    <span className="provider-option-name">{p.name}</span>
                    {matchedProvider?.name === p.name && <IconCheck size={13} />}
                  </button>
                ))}
                <button
                  type="button"
                  className={`provider-option ${!matchedProvider && baseUrl.trim() ? 'active' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    setProviderOpen(false)
                    setTimeout(() => baseUrlRef.current?.focus(), 0)
                  }}
                >
                  <ProviderMark name="自定义" color="#6B7280" size={16} />
                  <span className="provider-option-name">自定义（任意 OpenAI 兼容地址）</span>
                  {!matchedProvider && baseUrl.trim() && <IconCheck size={13} />}
                </button>
              </div>
            )}
          </div>
        </div>

        <label className="field">
          <span>API 地址（选择服务商自动填充，可修改）</span>
          <input
            ref={baseUrlRef}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.deepseek.com 或 http://localhost:11434/v1"
          />
        </label>

        <div className="field">
          <span className="field-label">
            API Key{' '}
            {hasSavedKey && (
              <em className="hint-inline">已保存 {cfg?.key_masked}，留空则继续使用</em>
            )}
          </span>
          <div className="key-row">
            <div className="key-input">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasSavedKey && sameEndpoint ? '留空继续使用已保存的 Key' : '输入此服务的 API Key'}
              />
              <button
                type="button"
                className="key-eye"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? '隐藏 Key' : '显示 Key'}
                title={showKey ? '隐藏' : '显示'}
              >
                <EyeIcon off={showKey} />
              </button>
            </div>
            <button
              type="button"
              className="btn ghost test-btn"
              onClick={testConnection}
              disabled={testing || !canTest}
              title={canTest ? '真实调用一次模型验证可用性（不保存）' : '需先填写 API 地址、模型与 Key'}
            >
              {testing ? '测试中…' : '测试连接'}
            </button>
          </div>
        </div>

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
          <p>支持任意 OpenAI 兼容服务商（含 vLLM / Ollama 等自建服务）。保存时会真实调用一次模型验证可用性，验证失败不会保存。</p>
        </div>

        {message && <div className={`modal-message ${msgOk === true ? 'ok' : msgOk === false ? 'err' : ''}`}>{message}</div>}

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>取消</button>
          <button className="btn primary" onClick={submit} disabled={saving || !canTest}>
            {saving ? '测试并保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
