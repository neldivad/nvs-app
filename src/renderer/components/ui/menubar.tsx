import { createContext, useContext, useEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A lightweight VS Code-style menu bar — no radix (this app is radix-free). Click a
 * top-level menu to open it; once one is open, hovering another switches to it;
 * click-away or Escape closes. Used by the custom TitleBar.
 */
type Ctx = { open: string | null; setOpen: (id: string | null) => void }
const MenubarCtx = createContext<Ctx | null>(null)
const useMenubar = (): Ctx => {
  const c = useContext(MenubarCtx)
  if (!c) throw new Error('Menubar parts must be used inside <Menubar>')
  return c
}

export function Menubar({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  const [open, setOpen] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null)
    }
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(null)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onEsc)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onEsc)
    }
  }, [open])
  return (
    <MenubarCtx.Provider value={{ open, setOpen }}>
      <div ref={ref} className={cn('flex items-center gap-0.5', className)}>
        {children}
      </div>
    </MenubarCtx.Provider>
  )
}

export function MenubarMenu({
  id,
  label,
  children,
  disabled
}: {
  id: string
  label: string
  children: ReactNode
  disabled?: boolean
}): JSX.Element {
  const { open, setOpen } = useMenubar()
  const isOpen = open === id
  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(isOpen ? null : id)}
        onMouseEnter={() => {
          if (open && open !== id) setOpen(id) // hover-switch once a menu is open
        }}
        className={cn(
          'rounded px-2 py-1 text-[13px] transition-colors',
          isOpen ? 'bg-panel-soft text-foreground' : 'text-muted-foreground hover:text-foreground',
          disabled && 'pointer-events-none opacity-40'
        )}
      >
        {label}
      </button>
      {isOpen && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 min-w-48 rounded-md border border-border bg-panel py-1 shadow-lg"
        >
          {children}
        </div>
      )}
    </div>
  )
}

export function MenubarItem({
  children,
  onSelect,
  disabled,
  shortcut
}: {
  children: ReactNode
  onSelect?: () => void
  disabled?: boolean
  shortcut?: string
}): JSX.Element {
  const { setOpen } = useMenubar()
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        onSelect?.()
        setOpen(null)
      }}
      className={cn(
        'flex w-full items-center justify-between gap-8 whitespace-nowrap px-3 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-panel-soft',
        disabled && 'pointer-events-none opacity-40'
      )}
    >
      <span>{children}</span>
      {shortcut && <span className="shrink-0 whitespace-nowrap text-[11px] text-faint">{shortcut}</span>}
    </button>
  )
}

export function MenubarSeparator(): JSX.Element {
  return <div role="separator" className="my-1 h-px bg-border" />
}
