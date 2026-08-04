/**
 * Provider metadata — shared by the connections UI (labels, model lists, links) and the agent
 * runner (wire format + base URL). Pure data. Adding a provider is a row here.
 *
 * `api` is the wire protocol: 'anthropic' (Messages API) or 'openai' (Chat Completions — OpenRouter
 * and OpenAI both speak it), or 'plan' (the keyless host: NVS drives Claude Code via the Agent SDK on
 * the user's subscription — no API key, tools attached in-process). The catalog tools feed all three.
 *
 * We never show pricing (it drifts); we link users to each provider's pricing page instead.
 */
export type AiProviderType = 'anthropic' | 'openrouter' | 'openai' | 'plan'

export interface ProviderMeta {
  label: string
  api: 'anthropic' | 'openai' | 'plan' // the wire protocol the runner uses
  baseUrl?: string // for openai-compatible providers
  defaultModel: string
  models: string[] // suggested models for the picker (free-text still allowed)
  keyHint: string // placeholder for the secret field
  keysUrl: string // where to get a key
  pricingUrl: string // where to see model pricing
  keyless?: boolean // no API key — auth comes from the user's Claude Code login (the 'plan' host)
}

export const AI_PROVIDERS: Record<AiProviderType, ProviderMeta> = {
  anthropic: {
    label: 'Anthropic',
    api: 'anthropic',
    defaultModel: 'claude-sonnet-4-6',
    models: ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-8'],
    keyHint: 'sk-ant-…',
    keysUrl: 'https://console.anthropic.com/settings/keys',
    pricingUrl: 'https://www.anthropic.com/pricing'
  },
  openrouter: {
    label: 'OpenRouter',
    api: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'google/gemini-3.1-flash-lite',
    models: [
      'google/gemini-3.1-flash-lite',
      'minimax/minimax-m3',
      'moonshotai/kimi-k2.5',
      'z-ai/glm-4.7',
      'deepseek/deepseek-v4-pro',
      'openai/gpt-5.4-nano'
    ],
    keyHint: 'sk-or-…',
    keysUrl: 'https://openrouter.ai/settings/keys',
    pricingUrl: 'https://openrouter.ai/models'
  },
  openai: {
    label: 'OpenAI',
    api: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.4-mini-2026-03-17',
    models: ['gpt-5.4-mini-2026-03-17', 'gpt-5.4-nano-2026-03-17'],
    keyHint: 'sk-…',
    keysUrl: 'https://platform.openai.com/api-keys',
    pricingUrl: 'https://openai.com/api/pricing/'
  },
  plan: {
    // Keyless: NVS spawns Claude Code via the Agent SDK on the user's subscription. Auth is the
    // existing `claude` login (one-time), not a key — so no secret field. Empty defaultModel uses
    // the CLI default; aliases let the user pin a tier.
    label: 'Claude (Plan)',
    api: 'plan',
    defaultModel: 'sonnet',
    models: ['opus', 'sonnet', 'haiku'],
    keyHint: '',
    keysUrl: 'https://code.claude.com/docs/en/agent-sdk/overview',
    pricingUrl: '',
    keyless: true
  }
}

export const PROVIDER_TYPES = Object.keys(AI_PROVIDERS) as AiProviderType[]
