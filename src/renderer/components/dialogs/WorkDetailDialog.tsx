import { useEffect, useState, type JSX } from 'react'
import { Play, GitFork, Trash2, Loader2, FolderOpen } from 'lucide-react'
import { useWorkspace } from '@/stores/workspace'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { BookCard } from '@/components/store/ProjectCard'
import type { ProjectInfo } from '@shared/ipc'

/**
 * The library "detail" step — clicking a work (grid card or sidebar row) previews it here before entering, rather
 * than opening straight into the editor (Steam/Netflix-style). Shows the full authored book card (read by path,
 * no need to open the work) + the primary actions: Open · Fork · Delete. Driven by the shared `detailWork` slot.
 */
export function WorkDetailDialog(): JSX.Element {
  const work = useWorkspace((s) => s.detailWork)
  const setDetailWork = useWorkspace((s) => s.setDetailWork)
  const openWork = useWorkspace((s) => s.openWork)
  const forkWork = useWorkspace((s) => s.forkWork)
  const deleteWork = useWorkspace((s) => s.deleteWork)
  const [info, setInfo] = useState<ProjectInfo | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  // (Re)load the previewed work's metadata by path whenever the selection changes.
  useEffect(() => {
    setInfo(null)
    setConfirming(false)
    setBusy(false)
    if (!work) return
    let live = true
    void window.nvs.readProjectInfoAt(work.path).then((i) => {
      if (live) setInfo(i)
    })
    return () => {
      live = false
    }
  }, [work])

  const close = (): void => setDetailWork(null)
  const fallback = work ? work.title || work.name || 'Untitled' : ''

  const run = (fn: (path: string) => Promise<boolean | void>) => async (): Promise<void> => {
    if (!work) return
    setBusy(true)
    await fn(work.path)
    close() // openWork/forkWork navigate away; delete removes the card — all end with the dialog closed
  }

  return (
    <Dialog
      region="workDetailDialog"
      open={!!work}
      onClose={close}
      title={fallback}
      size="panel"
      // Fixed height so every preview is the SAME footprint — a sparse project (title only) and a fully-filled
      // one open at one size; BookCard's `preview` mode keeps the facts table + synopsis present with placeholders.
      className="h-128"
      bodyClassName="select-text overflow-auto"
      footer={
        confirming ? (
          <DialogFooter aside={<span className="text-[12px] text-muted-foreground">Move <span className="text-foreground">{fallback}</span> to the system Trash? (recoverable)</span>}>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(false)}>Cancel</Button>
            <Button variant="destructive" size="sm" disabled={busy} onClick={() => void run(deleteWork)()}>Move to Trash</Button>
          </DialogFooter>
        ) : (
          <DialogFooter
            aside={
              <div className="flex min-w-0 items-center gap-3">
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(true)} className="shrink-0 text-flag hover:bg-flag/10"><Trash2 className="size-3.5" /> Delete</Button>
                {/* Disk folder — shown when it differs from the title, so you confirm you're opening the right
                    copy (e.g. the original vs a same-titled backup) before entering. */}
                {work?.title && work.title !== work.name && (
                  <span className="flex min-w-0 items-center gap-1 truncate font-mono text-[11px] text-faint" title={work.path}>
                    <FolderOpen className="size-3 shrink-0" /><span className="truncate">{work.name}</span>
                  </span>
                )}
              </div>
            }
          >
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(forkWork)()}><GitFork className="size-3.5" /> Fork</Button>
            <Button size="sm" disabled={busy} onClick={() => void run(openWork)()}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5 fill-current" />} Open project
            </Button>
          </DialogFooter>
        )
      }
    >
      {work &&
        (info ? (
          <BookCard info={info} fallbackTitle={fallback} basePath={work.path} preview />
        ) : (
          <div className="grid h-full place-items-center text-faint">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ))}
    </Dialog>
  )
}
