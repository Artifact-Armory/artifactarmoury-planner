import React from 'react'
import { cn } from '@/lib/utils'
import { Input as ShadcnInput } from '@/components/shadcn/input'
import { Label } from '@/components/shadcn/label'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  description?: string
  error?: string
}

// Thin wrapper over the shadcn / Base UI input that keeps this project's own API
// (label / description / error), so the existing call sites don't change.
//
// forwardRef is required so react-hook-form (and any ref-based caller) reaches
// the real <input>. Without it, RHF can't read the field values and every
// field validates as empty ("… is required") even when filled in.
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, description, error, className, id, ...props }, ref) => {
    const inputId = id ?? props.name

    return (
      <div className="space-y-1.5">
        {label && <Label htmlFor={inputId}>{label}</Label>}
        <ShadcnInput
          id={inputId}
          ref={ref}
          // Drives the destructive border/ring in the shadcn input, and tells
          // screen readers the field is invalid — the old version only coloured it.
          aria-invalid={error ? true : undefined}
          aria-describedby={error || description ? `${inputId}-hint` : undefined}
          className={cn('h-9', className)}
          {...props}
        />
        {description && !error && (
          <p id={`${inputId}-hint`} className="text-xs text-muted-foreground">
            {description}
          </p>
        )}
        {error && (
          <p id={`${inputId}-hint`} className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    )
  },
)

Input.displayName = 'Input'

export default Input
