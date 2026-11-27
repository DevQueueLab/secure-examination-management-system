'use client';

import { Label as LabelPrimitive } from 'radix-ui';
import { createContext, useContext, useId, type ComponentProps, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { cn } from '@/lib/cn';

interface FieldContextValue {
  id: string;
  hintId: string;
  errorId: string;
  invalid: boolean;
  required: boolean;
  disabled: boolean;
  hasHint: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/**
 * Props a control spreads to join its Field: id, aria-describedby, aria-invalid, required, disabled.
 * Input, Textarea, Select, Checkbox and Switch call it for you.
 */
export function useFieldControl(own: { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean | 'true' | 'false'; required?: boolean; disabled?: boolean } = {}) {
  const field = useContext(FieldContext);
  if (!field) return own;
  const describedBy = [own['aria-describedby'], field.hasHint ? field.hintId : null, field.invalid ? field.errorId : null]
    .filter(Boolean)
    .join(' ');
  return {
    id: own.id ?? field.id,
    'aria-describedby': describedBy || undefined,
    'aria-invalid': own['aria-invalid'] ?? (field.invalid || undefined),
    required: own.required ?? (field.required || undefined),
    disabled: own.disabled ?? (field.disabled || undefined),
  };
}

export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn('text-subheadline font-medium text-label select-none peer-disabled:opacity-50', className)}
      {...props}
    />
  );
}

export interface FieldProps {
  label?: ReactNode;
  /** Help text under the control. Linked with aria-describedby. */
  hint?: ReactNode;
  /** Error text. Marks the control invalid and is announced. */
  error?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  /** Something on the label's right, like a "Forgot password?" link. */
  labelAccessory?: ReactNode;
  /** Override the generated control id. */
  id?: string;
  className?: string;
  children: ReactNode;
}

/** Label + control + hint + error, wired for assistive tech. */
export function Field({ label, hint, error, required = false, disabled = false, labelAccessory, id, className, children }: FieldProps) {
  const auto = useId();
  const controlId = id ?? `field-${auto}`;
  const value: FieldContextValue = {
    id: controlId,
    hintId: `${controlId}-hint`,
    errorId: `${controlId}-error`,
    invalid: !!error,
    required,
    disabled,
    hasHint: !!hint,
  };
  return (
    <FieldContext.Provider value={value}>
      <div data-slot="field" data-invalid={!!error || undefined} className={cn('flex flex-col gap-1.5', className)}>
        {(label || labelAccessory) && (
          <div className="flex items-baseline justify-between gap-3">
            {label && (
              <Label htmlFor={controlId}>
                {label}
                {required && (
                  <span aria-hidden className="ml-0.5 text-label-tertiary">
                    *
                  </span>
                )}
              </Label>
            )}
            {labelAccessory}
          </div>
        )}
        {children}
        {hint && !error && (
          <p id={value.hintId} className="text-footnote text-label-secondary">
            {hint}
          </p>
        )}
        {hint && error && (
          <p id={value.hintId} className="sr-only">
            {hint}
          </p>
        )}
        {error && (
          <p id={value.errorId} role="alert" className="flex items-start gap-1.5 text-footnote font-medium text-danger-text">
            <CircleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
            <span>{error}</span>
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}
