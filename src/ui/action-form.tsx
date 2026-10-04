'use client';

import { createContext, useActionState, useContext, useEffect, useRef, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { buttonClass, type ButtonSize, type ButtonVariant } from './button';
import { Alert } from './feedback';

export interface ClientActionState {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  message?: string;
  data?: Record<string, unknown>;
  at?: number;
}
export type FormAction = (prev: ClientActionState, fd: FormData) => Promise<ClientActionState>;

const FormStateCtx = createContext<ClientActionState>({});

/**
 * Progressive-enhancement form bound to a server action. Shows a summary error, per-field errors
 * (via <FieldError/>), a success message, and disables the submit button while pending.
 */
export function ActionForm({
  action,
  children,
  className,
  successMessage,
  resetOnSuccess,
  encType,
  id,
}: {
  action: FormAction;
  children: ReactNode;
  className?: string;
  successMessage?: string;
  resetOnSuccess?: boolean;
  encType?: 'multipart/form-data';
  id?: string;
}) {
  const [state, formAction] = useActionState(action, {} as ClientActionState);
  const ref = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
    if (state.at && (state.error || state.ok)) alertRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [state, resetOnSuccess]);
  const msg = state.ok ? (state.message ?? successMessage) : undefined;
  return (
    <FormStateCtx.Provider value={state}>
      <form ref={ref} action={formAction} className={className} encType={encType} id={id} noValidate={false}>
        <div ref={alertRef} aria-live="polite">
          {state.error && (
            <Alert tone="danger" className="mb-4" key={state.at}>
              {state.error}
            </Alert>
          )}
          {msg && (
            <Alert tone="success" className="mb-4" key={state.at}>
              {msg}
            </Alert>
          )}
        </div>
        {children}
      </form>
    </FormStateCtx.Provider>
  );
}

export function useFormState() {
  return useContext(FormStateCtx);
}

export function FieldError({ name }: { name: string }) {
  const s = useContext(FormStateCtx);
  const e = s.fieldErrors?.[name]?.[0];
  if (!e) return null;
  return (
    <p className="text-xs text-red-600" role="alert">
      {e}
    </p>
  );
}

export function SubmitButton({ children, variant, size, className, pendingText, name, value, formNoValidate }: { children: ReactNode; variant?: ButtonVariant; size?: ButtonSize; className?: string; pendingText?: string; name?: string; value?: string; formNoValidate?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} name={name} value={value} formNoValidate={formNoValidate} className={buttonClass(variant, size, className)}>
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {pending && pendingText ? pendingText : children}
    </button>
  );
}

/** Submit button that asks for confirmation first (destructive / financial actions). */
export function ConfirmSubmit({ children, confirm, variant = 'danger', size, className }: { children: ReactNode; confirm: string; variant?: ButtonVariant; size?: ButtonSize; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(buttonClass(variant, size, className))}
      onClick={(e) => {
        if (!window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}
