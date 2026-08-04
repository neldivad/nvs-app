/**
 * AI features — the ONE gate for the generative-AI layer.
 *
 * `aiEnabled` (Settings → AI, persisted per-user in workspace store) turns the whole layer off: the assistant
 * (chat + Tasks), the prompt library, /agent + AI-write, custody AI-suggest, analysis RUNNING (Update / Jobs /
 * coherence), and the model-connection indicators. Every AI surface reads THIS module — never `s.aiEnabled`
 * directly — so "what counts as AI" lives in one place and a sweep can't silently miss a spot.
 *
 * HIDE, and DISABLE: an unrendered control can't fire, so `<AiGate>` (hide) is the default. For a control that
 * must stay mounted (layout, a shared toolbar), grey it out with `disabled={!useAiEnabled()}` and skip its
 * onClick — never leave an AI action live while the layer is off. Store-level chokepoints back this up
 * (setAgentComposerOpen no-ops; the run dialogs return null) so a missed gate still can't trigger AI work.
 *
 * KEPT when off (NOT gated by this): result panels that only DISPLAY prior analysis (Cast, Threads, Coherence,
 * Lore, Relations, Timeline data) and the Store's Claude-connect SETUP page. Only AI ACTIONS + AI STATUS go.
 *
 * Gated surfaces (keep this list current as the sweep grows):
 *  - RightRail: Chat, Prompt library, Jobs · AppShell: AgentFloat, ConsoleDock · TitleBar: Toggle Assistant
 *  - StatusBar: console-dock toggle, AI connection/model indicator
 *  - Editor: /agent + "Ask AI to write" slash items · Custody: AI-suggest
 *  - Threads/Coherence: "Update analysis" / "Check coherence" run triggers (+ the run dialogs)
 *  - Timeline: "Build with AI", AI tree/chart affordances
 *  - Rail: Threads/Coherence nav entries, hidden only when EMPTY (no prior results to view)
 */
import { useWorkspace } from '@/stores/workspace'
import type { JSX, ReactNode } from 'react'

/** True when the generative-AI layer is on (Settings → AI). Use in any component deciding whether to show/enable
 *  an AI control; pairs with `disabled={!useAiEnabled()}` for controls that stay mounted. */
export function useAiEnabled(): boolean {
  return useWorkspace((s) => s.aiEnabled)
}

/** Render children only when AI is enabled — the standard way to HIDE an AI control, button, or panel. */
export function AiGate({ children }: { children: ReactNode }): JSX.Element | null {
  const aiEnabled = useWorkspace((s) => s.aiEnabled)
  return aiEnabled ? <>{children}</> : null
}
