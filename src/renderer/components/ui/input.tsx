import type { InputHTMLAttributes, JSX } from 'react';
import { cn } from '@/lib/utils'

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return (
    <input
      className={cn(
        'h-8 w-full rounded-md border border-border bg-canvas px-2.5 text-sm text-foreground placeholder:text-faint focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        className
      )}
      {...props}
    />
  )
}
