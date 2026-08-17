/**
 * The unified raw-markdown SOURCE surface — a real CodeMirror editor (markdown highlighting, the shared
 * theme, native history, Mod-S), replacing per-pane reinventions (custody's plain <textarea> was the
 * drift that motivated the BasePage plan). Mount it keyed by page path; `text` seeds the document.
 */
import { useEffect, useRef, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting } from '@codemirror/language'
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands'
import { highlightSelectionMatches } from '@codemirror/search'
import { Loader2, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cmTheme, cmMdHighlight } from './cmTheme'
import { useCmFind } from '@/lib/editor/useCmFind'
import { cmFindExtension } from '@/lib/editor/cmFind'
import { FindBar } from '@/components/editor/FindBar'
import { SearchMinimap } from '@/components/editor/SearchMinimap'

export function SourceTab({
  text,
  onChange,
  onSave,
  dirty,
  saving,
  readOnly,
  error,
  chromeless,
  gutter
}: {
  text: string // initial document — remount (key by path) to load a different page
  onChange?: (text: string) => void
  onSave?: () => void
  dirty?: boolean
  saving?: boolean
  readOnly?: boolean
  error?: string | null // a gated save's refusal (e.g. the custody grammar gate) — shown beside Save
  chromeless?: boolean // hide the built-in bottom Save bar — the host puts Save in its own header (custody Write)
  gutter?: boolean // show a line-number gutter (so linter "Line N" references are locatable — scene source)
}): JSX.Element {
  const { t } = useTranslation('sourceTab')
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const find = useCmFind(() => viewRef.current)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  useEffect(() => {
    if (!hostRef.current) return
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          markdown(),
          syntaxHighlighting(cmMdHighlight),
          ...(gutter ? [lineNumbers()] : []), // locatable "Line N" (linter references) — off for prose surfaces
          EditorView.lineWrapping,
          cmTheme,
          // In-editor find — our self-contained highlighter (cmFind), driven by the shared FindBar. NOT
          // @codemirror/search's search()/searchKeymap, which auto-open CM's native panel (a second bar).
          cmFindExtension,
          highlightSelectionMatches(),
          ...(readOnly
            ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
            : [
                history(),
                keymap.of([
                  { key: 'Mod-s', preventDefault: true, run: () => { onSaveRef.current?.(); return true } },
                  ...historyKeymap,
                  ...defaultKeymap
                ]),
                EditorView.updateListener.of((u) => {
                  if (u.docChanged) onChangeRef.current?.(u.state.doc.toString())
                })
              ])
        ]
      })
    })
    viewRef.current = view
    return () => { viewRef.current = null; view.destroy() }
    // text is the INITIAL doc only — parents remount via key when the page changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly])
  return (
    <div className="relative flex min-h-0 flex-1 flex-col" onKeyDown={find.onKeyDown}>
      {find.open && (
        <>
          <FindBar ref={find.inputRef} query={find.query} count={find.count} active={find.active} onQueryChange={find.onQueryChange} onNext={() => find.step(1)} onPrev={() => find.step(-1)} onClose={find.close} placeholder={t('findPlaceholder')} />
          <SearchMinimap markers={find.markers} onJump={find.goto} />
        </>
      )}
      <div
        ref={hostRef}
        className="min-h-0 flex-1 overflow-hidden"
        onMouseMove={(e) => {
          const el = viewRef.current?.dom
          if (!el) return
          const r = el.getBoundingClientRect()
          el.classList.toggle('reveal-gutter', e.clientX - r.left < r.width * 0.3) // numbers fade in near the left edge
        }}
        onMouseLeave={() => viewRef.current?.dom.classList.remove('reveal-gutter')}
      />
      {!readOnly && !chromeless && (
        <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-1.5">
          <Button size="sm" variant="outline" disabled={!dirty || saving} onClick={() => onSaveRef.current?.()}>
            {saving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />} {t('save')}
          </Button>
          {error ? <span className="text-[10px] text-flag">{error}</span> : dirty && <span className="text-[10px] text-faint">{t('unsaved')}</span>}
        </div>
      )}
    </div>
  )
}
