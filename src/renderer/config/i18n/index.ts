/**
 * i18n — the app's UI language (chrome only). This is ONE of three independent language axes; keep them separate:
 *   • prompt language   — always English, in src (never translated)
 *   • output language   — the AI's replies, steered by project.inLanguage / the user's request
 *   • UI language (this) — NVS's own menus + labels, chosen in Settings, persisted as `uiLocale`
 *
 * HARD RULES: translate the chrome ONLY — never the author's prose or the AI's output; and NEVER translate format
 * contracts (Fountain keywords, .nvs schema, page-kind slugs, entity ids). i18n is a presentation skin, nothing more.
 *
 * Catalogs live beside this file at ./{locale}/{namespace}.json — one namespace file per component/feature, so a
 * view loads only what it needs (`useTranslation('settings')`). Codes are BCP-47 primary subtags — en / zh / ja —
 * because navigator.language / app.getLocale() return `zh-CN`, `ja-JP`, and i18next matches the primary subtag.
 * A-1 seeds the `settings` namespace; A-2 adds more (coherence, threads, …) as strings get wrapped.
 */
import i18n, { type Resource } from 'i18next'
import { initReactI18next } from 'react-i18next'

/** What the user picks in Settings. `system` follows the OS/app locale; the rest pin a language. */
export type UiLocale = 'system' | 'en' | 'zh' | 'ja'

/** The concrete catalogs we ship. `system` resolves into one of these. */
export const SUPPORTED = ['en', 'zh', 'ja'] as const
export type SupportedLocale = (typeof SUPPORTED)[number]

/**
 * Resolve a `UiLocale` to a concrete catalog. For `system` we read `navigator.language` (in the Electron renderer
 * that already tracks the OS/app locale) and match its primary subtag; anything unsupported falls back to English.
 * A-1.5 will optionally upgrade `system` to Electron `app.getLocale()` over ipc for cases where they diverge.
 */
export function resolveLocale(locale: UiLocale): SupportedLocale {
  if (locale !== 'system') return locale
  try {
    const primary = (navigator.language || 'en').toLowerCase().split('-')[0]
    if (primary === 'zh' || primary === 'ja') return primary
  } catch {
    /* navigator unavailable — fall through to English */
  }
  return 'en'
}

/** Switch the live UI language. Mirrors applyTheme(): called at boot and from the Settings setter. */
export function applyLocale(locale: UiLocale): void {
  void i18n.changeLanguage(resolveLocale(locale))
}

// Auto-register every catalog: config/i18n/{locale}/{namespace}.json → resources[locale][namespace]. Drop a new
// {locale}/{ns}.json (the i18n:translate script generates zh/ja from en/) and it loads with ZERO edits here.
const catalogs = import.meta.glob('./*/*.json', { eager: true, import: 'default' }) as Record<string, Record<string, unknown>>
const resources: Record<string, Record<string, unknown>> = {}
const nsSet = new Set<string>()
for (const [path, data] of Object.entries(catalogs)) {
  const m = path.match(/\.\/([^/]+)\/([^/]+)\.json$/)
  if (!m) continue
  const [, locale, ns] = m
  ;(resources[locale] ??= {})[ns] = data
  nsSet.add(ns)
}

i18n.use(initReactI18next).init({
  resources: resources as unknown as Resource,
  ns: [...nsSet],
  defaultNS: 'settings',
  lng: 'en', // overwritten by applyLocale() at boot (main.tsx) from the persisted uiLocale
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React already escapes
  returnNull: false
})

export default i18n
