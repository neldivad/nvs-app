import { type JSX } from 'react'
import { useWorkspace } from '@/stores/workspace'
import { anyDirty } from '@/lib/editor/saveTarget'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

const VERB: Record<string, string> = {
  library: 'return to the Library',
  tab: 'close this tab',
  app: 'quit',
  nav: 'leave this page' // an in-app switch (page / custody tab / topic) held behind the prompt
}

/**
 * Exit guard — one dialog shared by returning to the Library, closing a tab, and quitting (driven by store
 * `pendingExit`). Two shapes: if anything is unsaved (the scene buffer OR any other registered save target —
 * see anyDirty), it's the VS Code Save / Don't Save / Cancel. If nothing's unsaved it's a plain confirm — the
 * library/quit path always asks (guard against a stray click), so it can open with a clean project too.
 */
export function UnsavedExitDialog(): JSX.Element {
  const pending = useWorkspace((s) => s.pendingExit)
  const resolve = useWorkspace((s) => s.resolvePendingExit)
  const pageTitle = useWorkspace((s) => s.activePage?.title)
  const sceneDirty = useWorkspace((s) => s.sceneDirty)
  const progress = useWorkspace((s) => s.ingestProgress)

  const verb = pending ? VERB[pending.kind] : 'leave'
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
      title={dirty ? 'Unsaved changes' : 'Leave this project?'}
      footer={
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => void resolve('cancel')}>Cancel</Button>
          {dirty ? (
            <>
              <Button variant="outline" size="sm" onClick={() => void resolve('discard')}>Don't Save</Button>
              <Button size="sm" onClick={() => void resolve('save')}>Save</Button>
            </>
          ) : (
            <Button size="sm" onClick={() => void resolve('discard')}>
              {pending?.kind === 'app' ? 'Quit' : pending?.kind === 'tab' ? 'Close tab' : 'Return to Library'}
            </Button>
          )}
        </DialogFooter>
      }
    >
      <div className="space-y-4">
        {dirty ? (
          <p className="text-sm text-muted-foreground">
            You have unsaved edits in <span className="text-foreground">{pageTitle || 'this page'}</span>.
            Save them before you {verb}?
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Everything's saved. {`Ready to ${verb}?`}</p>
        )}
        {jobActive && (
          <p className="rounded border border-border bg-panel-soft px-3 py-2 text-xs text-muted-foreground">
            Analysis is running on <span className="text-foreground">{progress?.projectName || 'this project'}</span> ({jobDone}/{progress?.steps.length ?? 0}).
            Leaving <span className="text-foreground">pauses</span> it — it resumes right where it left off next time you open it.
          </p>
        )}
      </div>
    </Dialog>
  )
}
