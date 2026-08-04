/**
 * siteConfig — the creator's public identity + social/support links. One place to edit them; the Help &
 * reference dialog's "Support & community" section (and any future follow/support surface) reads from here.
 * Links open in the system browser via ExternalLink (window.nvs.openUrl), never in-app.
 *
 * No ogImage yet — add one when the getqed-web landing has a card to point at.
 */
export const qedConfig = {
  name: 'QED Research',
  url: 'https://www.getqed.app/',
  description: 'Information at a new angle',
  links: {
    twitter: 'https://x.com/intent/follow?screen_name=nelvOfficial&tw_p=followbutton',
    github: 'https://github.com/neldivad',
    // youtube: 'https://youtube.com/@nelvOfficial',
    discord: 'https://discord.gg/QpggZnAHEY'
  },
  // Legal text lives ONCE on getqed-web (/legal/*); the app only LINKS out — so the policy can never drift
  // between product + site. Repoint here if the site moves. Surfaced in the Support dialog.
  legal: {
    privacy: 'https://www.getqed.app/legal/privacy',
    terms: 'https://www.getqed.app/legal/terms'
  }
} as const

export type SocialKey = keyof typeof qedConfig.links

/**
 * The QED app portfolio — the left rail of the Support/launcher dialog (mirrors getqed-web/config/products.ts).
 * `current: true` marks the app you're in right now. Add products here as they ship.
 */
export const apps = [
  {
    slug: 'nvs',
    name: 'Novel Visual Studio',
    tagline: 'A writing IDE for dialogue-driven fiction.',
    description:
      'Write Markdown scenes while an in-process engine keeps your narrative ledgers — threads, cast presence, coherence, reveals — surfaced as panels. Your story stays plain files.',
    status: 'beta', // 'live' | 'beta' | 'soon'
    url: 'https://www.getqed.app/nvs',
    current: true,
    highlights: [
      'Files are the product — scenes stay plain Markdown, analysis co-located beside the work.',
      'Living narrative ledgers — threads, cast, reveals, coherence, surfaced as you write.',
      'Bring your own model — OpenRouter, Claude via MCP, an Anthropic key, or local Ollama.'
    ]
  },
  {
    slug: 'confynotebooks',
    name: 'Confy Notebooks',
    tagline: 'Coming soon to the QED hub.',
    description: 'Another QED product, in development. Follow the socials for launch news.',
    status: 'soon',
    url: 'https://www.getqed.app',
    current: false,
    highlights: []
  }
] as const

export type AppEntry = (typeof apps)[number]

