import { type JSX } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useWorkspace } from '@/stores/workspace'
import { anyDirty } from '@/lib/editor/saveTarget'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

const VERB_KEY: Record<string, string> = {
  library: 'verb.library',
  tab: 'verb.tab',
  app: 'verb.app',
  nav: 'verb.nav' // an in-app switch (page / custody tab / topic) held behind the prompt
}

/**
 * Exit guard — one dialog shared by returning to the Library, closing a tab, and quitting (driven by store
 * `pendingExit`). Two shapes: if anything is unsaved (the scene buffer OR any other registered save target —
 * see anyDirty), it's the VS Code Save / Don't Save / Cancel. If nothing's unsaved it's a plain confirm — the
 * library/quit path always asks (guard against a stray click), so it can open with a clean project too.
 */
export function UnsavedExitDialog(): JSX.Element {
  const { t } = useTranslation('unsavedExit')
  const pending = useWorkspace((s) => s.pendingExit)
  const resolve = useWorkspace((s) => s.resolvePendingExit)
  const pageTitle = useWorkspace((s) => s.activePage?.title)
  const sceneDirty = useWorkspace((s) => s.sceneDirty)
  const progress = useWorkspace((s) => s.ingestProgress)

  const verb = pending ? t(VERB_KEY[pending.kind]) : t('verb.default')
  const dirty = sceneDirty || anyDirty()
  // Leaving the project or app pauses a running analysis (resumable) — remind, don't block. Not for tab-close.
  const jobActive = !!progress?.active && (pending?.kind === 'app' || pending?.kind === 'library')
  const jobDone = progress ? progress.steps.filter((s) => s.status === 'done' || s.status === 'skipped' || s.status === 'failed').length : 0

  return (
    <Dialog
      region="unsavedExitDialog"
      size="confirm"
      open={!!pending}
      onClose={() => void resolve('cancel')}
      title={dirty ? t('title.dirty') : t('title.clean')}
      footer={
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => void resolve('cancel')}>{t('button.cancel')}</Button>
          {dirty ? (
            <>
              <Button variant="outline" size="sm" onClick={() => void resolve('discard')}>{t('button.dontSave')}</Button>
              <Button size="sm" onClick={() => void resolve('save')}>{t('button.save')}</Button>
            </>
          ) : (
            <Button size="sm" onClick={() => void resolve('discard')}>
              {pending?.kind === 'app' ? t('button.quit') : pending?.kind === 'tab' ? t('button.closeTab') : t('button.returnToLibrary')}
            </Button>
          )}
        </DialogFooter>
      }
    >
      <div className="space-y-4">
        {dirty ? (
          <p className="text-sm text-muted-foreground">
            <Trans
              t={t}
              i18nKey="dirty"
              values={{ name: pageTitle || t('thisPage'), verb }}
              components={{ hl: <span className="text-foreground" /> }}
            />
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t('clean', { verb })}</p>
        )}
        {jobActive && (
          <p className="rounded border border-border bg-panel-soft px-3 py-2 text-xs text-muted-foreground">
            <Trans
              t={t}
              i18nKey="job"
              values={{ name: progress?.projectName || t('thisProject'), done: jobDone, total: progress?.steps.length ?? 0 }}
              components={{ hl: <span className="text-foreground" />, em: <span className="text-foreground" /> }}
            />
          </p>
        )}
      </div>
    </Dialog>
  )
}
