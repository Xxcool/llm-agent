/**
 * 服务商品牌信息：预设、官方 logo、按 API 地址识别。
 * 设置面板与状态徽章共用，避免两处各写一份。
 */
import deepseekLogo from '../assets/providers/deepseek.svg'
import qwenLogo from '../assets/providers/qwen.svg'
import moonshotLogo from '../assets/providers/moonshotai.svg'
import ollamaLogo from '../assets/providers/ollama.svg'
import anthropicLogo from '../assets/providers/anthropic.svg'
import zhipuLogo from '../assets/providers/zhipu.svg'
import geminiLogo from '../assets/providers/gemini.svg'

export interface ProviderPreset {
  name: string
  base_url: string
  models: string[]
  color: string
}

/** 服务商预设：品牌 logo + 一键填充地址，models 供下拉选择 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  { name: 'DeepSeek', base_url: 'https://api.deepseek.com', color: '#4D6BFE', models: ['deepseek-flash', 'deepseek-v4-pro'] },
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
export const PROVIDER_LOGOS: Record<string, string> = {
  DeepSeek: deepseekLogo,
  '智谱 GLM': zhipuLogo,
  通义千问: qwenLogo,
  Moonshot: moonshotLogo,
  '本地 Ollama': ollamaLogo,
  Claude: anthropicLogo,
  'Google Gemini': geminiLogo,
}

export function ProviderMark({ name, color, size = 20 }: { name: string; color: string; size?: number }) {
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

/** 按 API 地址 host 识别服务商（未匹配返回 null，前端用「自定义服务」兜底） */
export function identifyProvider(baseUrl?: string | null): ProviderPreset | null {
  if (!baseUrl) return null
  try {
    const host = new URL(baseUrl.trim()).host
    return PROVIDER_PRESETS.find((p) => new URL(p.base_url).host === host) ?? null
  } catch {
    return null
  }
}
