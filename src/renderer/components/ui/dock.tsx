/**
 * A magnifying dock (macOS-style) — icons swell as the cursor nears them. Composable: <Dock> wraps <DockItem>s,
 * each holding a <DockIcon> and an optional <DockLabel> (hover tooltip). Ported from the motion-primitives dock,
 * retokenized to the NVS design system (no gray-/neutral- — DESIGN.md tokens only) so it reads correctly in
 * both themes. framer-motion drives the spring magnify.
**/
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  AnimatePresence,
  type MotionValue,
  type SpringOptions
} from 'framer-motion'
import {
  Children,
  cloneElement,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactElement,
  type ReactNode
} from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

const DOCK_HEIGHT = 96
const DEFAULT_MAGNIFICATION = 48
const DEFAULT_DISTANCE = 120
const DEFAULT_PANEL_HEIGHT = 42
const BASE_ITEM = 30 // resting icon-tile size (px); grows to DEFAULT_MAGNIFICATION under the cursor

type DockProps = {
  children: ReactNode
  className?: string
  distance?: number
  panelHeight?: number
  magnification?: number
  spring?: SpringOptions
}
type DockItemProps = { className?: string; children: ReactNode; onClick?: () => void; title?: string }
type DockLabelProps = { className?: string; children: ReactNode }
type DockIconProps = { className?: string; children: ReactNode }

type DockContextType = { mouseX: MotionValue; spring: SpringOptions; magnification: number; distance: number }

const DockContext = createContext<DockContextType | undefined>(undefined)

function useDock(): DockContextType {
  const context = useContext(DockContext)
  if (!context) throw new Error('useDock must be used within a <Dock>')
  return context
}

export function Dock({
  children,
  className,
  spring = { mass: 0.1, stiffness: 150, damping: 12 },
  magnification = DEFAULT_MAGNIFICATION,
  distance = DEFAULT_DISTANCE,
  panelHeight = DEFAULT_PANEL_HEIGHT
}: DockProps): JSX.Element {
  const { t } = useTranslation('dock')
  const mouseX = useMotionValue(Infinity)
  const isHovered = useMotionValue(0)

  const maxHeight = useMemo(() => Math.max(DOCK_HEIGHT, magnification + magnification / 2 + 4), [magnification])
  const heightRow = useTransform(isHovered, [0, 1], [panelHeight, maxHeight])
  const height = useSpring(heightRow, spring)

  return (
    // pointer-events-none on the tall magnification track (it springs to `maxHeight`, mostly EMPTY above the pill) so
    // that headroom never captures clicks meant for the content behind it — only the glass pill below re-enables them.
    <motion.div style={{ height, scrollbarWidth: 'none' }} className="pointer-events-none mx-2 flex max-w-full items-end overflow-x-auto">
      <motion.div
        onMouseMove={({ pageX }) => {
          isHovered.set(1)
          mouseX.set(pageX)
        }}
        onMouseLeave={() => {
          isHovered.set(0)
          mouseX.set(Infinity)
        }}
        // GLASS — deliberately NOT a flat app panel: a frosted, translucent, pill-shaped control (heavy blur +
        // low-opacity fill + hairline border + deep shadow) so it reads as a floating overlay, never mistaken for
        // an in-page surface. Theme-aware (a light glass over the manuscript, a dark glass over the focus canvas).
        className={cn(
          // pointer-events-auto: the visible pill (and its magnified icons, which overflow it) is the ONLY clickable
          // part — re-enabling events the tall track above disabled, so no dead zone hangs over the content.
          'pointer-events-auto mx-auto flex w-fit items-end gap-1.5 rounded-full px-2.5 pb-1.5 shadow-2xl shadow-black/40 backdrop-blur-xl',
          'border border-black/10 bg-white/55 dark:border-white/10 dark:bg-black/30',
          className
        )}
        style={{ height: panelHeight }}
        role="toolbar"
        aria-label={t('label')}
      >
        <DockContext.Provider value={{ mouseX, spring, distance, magnification }}>{children}</DockContext.Provider>
      </motion.div>
    </motion.div>
  )
}

export function DockItem({ children, className, onClick, title }: DockItemProps): JSX.Element {
  const ref = useRef<HTMLButtonElement>(null)
  const { distance, magnification, mouseX, spring } = useDock()
  const isHovered = useMotionValue(0)

  const mouseDistance = useTransform(mouseX, (val) => {
    const domRect = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 }
    return val - domRect.x - domRect.width / 2
  })
  const widthTransform = useTransform(mouseDistance, [-distance, 0, distance], [BASE_ITEM, magnification, BASE_ITEM])
  const width = useSpring(widthTransform, spring)

  return (
    <motion.button
      ref={ref}
      type="button"
      style={{ width }}
      onClick={onClick}
      title={title}
      onHoverStart={() => isHovered.set(1)}
      onHoverEnd={() => isHovered.set(0)}
      onFocus={() => isHovered.set(1)}
      onBlur={() => isHovered.set(0)}
      className={cn('relative inline-flex aspect-square items-center justify-center', className)}
      aria-label={title}
    >
      {Children.map(children, (child) => cloneElement(child as ReactElement<{ width?: MotionValue<number>; isHovered?: MotionValue<number> }>, { width, isHovered }))}
    </motion.button>
  )
}

export function DockLabel({ children, className, ...rest }: DockLabelProps): JSX.Element {
  const isHovered = (rest as Record<string, unknown>)['isHovered'] as MotionValue<number>
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    if (!isHovered) return
    const unsubscribe = isHovered.on('change', (latest) => setIsVisible(latest === 1))
    return () => unsubscribe()
  }, [isHovered])

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 0 }}
          animate={{ opacity: 1, y: -10 }}
          exit={{ opacity: 0, y: 0 }}
          transition={{ duration: 0.2 }}
          className={cn('absolute -top-7 left-1/2 w-fit whitespace-pre rounded-md border border-border bg-panel px-2 py-0.5 text-[11px] text-foreground shadow-md', className)}
          role="tooltip"
          style={{ x: '-50%' }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function DockIcon({ children, className, ...rest }: DockIconProps): JSX.Element {
  const width = (rest as Record<string, unknown>)['width'] as MotionValue<number>
  const widthTransform = useTransform(width, (val) => val / 2)
  return (
    <motion.div style={{ width: widthTransform }} className={cn('flex items-center justify-center', className)}>
      {children}
    </motion.div>
  )
}
