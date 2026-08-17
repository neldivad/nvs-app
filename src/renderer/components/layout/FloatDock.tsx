/**
 * FloatDock — a floating macOS-style magnifying dock, the quick-access surface for the app's "chrome" actions so
 * they don't clutter the menubar / status bar. Two groups (a hairline splits them):
 *   • Main  — Composition mode (project-only), Settings
 *   • Theme — light/dark toggle
 * Bottom-center, above the status bar. The wrapper is pointer-events-none so only the dock itself is clickable;
 * the rest of the editor stays fully interactive underneath.
 */
import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { Maximize2, Settings, Sun, Moon } from 'lucide-react'
import { useWorkspace } from '@/stores/workspace'
import { Dock, DockItem, DockIcon, DockLabel } from '@/components/ui/dock'

// Glass tiles — aspect-square keeps the icon centered (no droop); the icon fills half the tile (DockIcon = w/2), so
// there's an even margin all round. Subtle theme-safe hover well; icons inherit foreground so they read on the glass.
const ITEM = 'aspect-square rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground'

export function FloatDock(): JSX.Element | null {
  const { t } = useTranslation('floatDock')
  const open = useWorkspace((s) => s.floatDockOpen)
  const project = useWorkspace((s) => s.project)
  const setComposing = useWorkspace((s) => s.setComposing)
  const setSettingsOpen = useWorkspace((s) => s.setSettingsOpen)
  const theme = useWorkspace((s) => s.theme)
  const setTheme = useWorkspace((s) => s.setTheme)

  if (!open) return null // summoned by the status-bar handle

  return (
    <div className="pointer-events-none fixed bottom-11 left-1/2 z-40 -translate-x-1/2">
      <div className="pointer-events-auto">
        <Dock>
          {project && (
            <DockItem title={t('composition.title')} onClick={() => setComposing(true)} className={ITEM}>
              <DockLabel>{t('composition.label')}</DockLabel>
              <DockIcon>
                <Maximize2 className="size-full" />
              </DockIcon>
            </DockItem>
          )}
          <DockItem title={t('settings.title')} onClick={() => setSettingsOpen(true)} className={ITEM}>
            <DockLabel>{t('settings.label')}</DockLabel>
            <DockIcon>
              <Settings className="size-full" />
            </DockIcon>
          </DockItem>

          {/* group split: Main | Theme */}
          <div className="mx-1 h-6 w-px shrink-0 self-center bg-border" />

          <DockItem title={t('theme.toggle')} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className={ITEM}>
            <DockLabel>{theme === 'dark' ? t('theme.light') : t('theme.dark')}</DockLabel>
            <DockIcon>{theme === 'dark' ? <Sun className="size-full" /> : <Moon className="size-full" />}</DockIcon>
          </DockItem>
        </Dock>
      </div>
    </div>
  )
}
