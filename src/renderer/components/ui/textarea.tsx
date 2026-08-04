import type { TextareaHTMLAttributes, JSX } from 'react';
import { cn } from '@/lib/utils'

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>): JSX.Element {
  return (
    <textarea
      className={cn(
        'w-full resize-none rounded-md border border-border bg-canvas px-2.5 py-1.5 text-sm text-foreground placeholder:text-faint focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        className
      )}
      {...props}
    />
  )
}
