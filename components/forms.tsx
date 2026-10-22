'use client';

import { createContext, startTransition, useActionState, useContext, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ActionResult, FormAction } from '@/lib/action-result';
import { btn } from '@/components/ui';
import { announce } from '@/components/toaster';

const FieldErrorsContext = createContext<Record<string, string> | undefined>(undefined);

type ConfirmSpec = { title: string; body?: string; confirmLabel: string; danger?: boolean };

/**
 * Formulario conectado a una acción del servidor. Muestra estados de envío,
 * errores por campo, mensajes de éxito/error y, si se indica, pide
 * confirmación antes de enviar (para cambios importantes o eliminaciones).
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel = 'Guardando…',
  confirm,
  submitVariant = 'primary',
  className = '',
  footer,
  hideSubmit = false,
  inline = false,
}: {
  action: FormAction;
  children?: React.ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  confirm?: ConfirmSpec;
  submitVariant?: 'primary' | 'secondary' | 'danger' | 'quiet';
  className?: string;
  footer?: React.ReactNode;
  hideSubmit?: boolean;
  /** Formularios que son solo un botón (sin margen superior). */
  inline?: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmed = useRef(false);
  const [shown, setShown] = useState<ActionResult>(null);

  const [state, dispatch, pending] = useActionState<ActionResult, FormData>(async (prev, fd) => {
    try {
      const r = await action(prev, fd);
      // Se anuncia aquí (y no en un efecto) porque al revalidar la página el
      // formulario puede desaparecer antes de que su efecto llegue a ejecutarse.
      if (r?.ok && r.message) announce(r.message, true);
      return r;
    } catch (e) {
      // Las redirecciones del framework no son errores.
      if (e && typeof e === 'object' && 'digest' in e && String((e as { digest: unknown }).digest).startsWith('NEXT_REDIRECT')) throw e;
      return {
        ok: false,
        message: navigator.onLine
          ? 'No se pudo completar la acción. Inténtalo de nuevo en un momento.'
          : 'Parece que no hay conexión a internet. Tus datos siguen en el formulario; inténtalo cuando vuelva la conexión.',
      };
    }
  }, null);

  useEffect(() => {
    setShown(state);
    if (!state) return;
    if (state.ok && state.resetForm) formRef.current?.reset();
    if (state.redirectTo) router.push(state.redirectTo);
    else if (state.ok && !state.revalidated) router.refresh();
  }, [state, router]);

  // Se envía manualmente (sin la prop `action`) para que React no limpie el
  // formulario: si hay un error, lo escrito se conserva.
  function send() {
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    setShown(null); // limpia el error anterior mientras se envía de nuevo
    startTransition(() => dispatch(fd));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    if (confirm && !confirmed.current) {
      dialogRef.current?.showModal();
      return;
    }
    confirmed.current = false;
    send();
  }

  return (
    <FieldErrorsContext.Provider value={shown?.fieldErrors}>
      <form ref={formRef} onSubmit={onSubmit} className={className} aria-busy={pending}>
        {children}
        <div className={`${inline ? '' : 'mt-5 '}flex flex-wrap items-center gap-3`}>
          {!hideSubmit && <SubmitButton label={submitLabel} pendingLabel={pendingLabel} variant={submitVariant} pending={pending} />}
          {footer}
        </div>
        <FormMessage result={shown} />
      </form>
      {confirm && (
        <dialog
          ref={dialogRef}
          className="m-auto w-[min(92vw,460px)] rounded-3xl border border-linea bg-superficie p-6 text-tinta shadow-[0_40px_80px_-30px_rgb(30_30_50/0.5)] backdrop:bg-[rgb(30_30_40/0.35)] backdrop:backdrop-blur-[3px]"
          aria-labelledby={`${confirm.title}-t`}
        >
          <h2 id={`${confirm.title}-t`} className="display text-[28px]">
            {confirm.title}
          </h2>
          {confirm.body && <p className="mt-2 text-[15px] text-tenue">{confirm.body}</p>}
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <button type="button" className={btn('quiet')} onClick={() => dialogRef.current?.close()} autoFocus>
              Volver
            </button>
            <button
              type="button"
              className={btn(confirm.danger ? 'danger' : 'primary')}
              onClick={() => {
                confirmed.current = false;
                dialogRef.current?.close();
                send();
              }}
            >
              {confirm.confirmLabel}
            </button>
          </div>
        </dialog>
      )}
    </FieldErrorsContext.Provider>
  );
}

export function SubmitButton({
  label,
  pendingLabel,
  variant = 'primary',
  pending,
}: {
  label: string;
  pendingLabel: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'quiet';
  pending: boolean;
}) {
  return (
    <button type="submit" className={btn(variant)} disabled={pending} aria-busy={pending}>
      {pending && <span aria-hidden className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />}
      {pending ? pendingLabel : label}
    </button>
  );
}

function FormMessage({ result }: { result: ActionResult }) {
  return (
    <div aria-live="assertive" role="alert" className="empty:hidden">
      {result?.message && !result.ok && <p className="aparecer mt-4 rounded-2xl bg-rosa-50 px-4 py-3 text-[15px] text-rosa-700">{result.message}</p>}
    </div>
  );
}

type ShellProps = { label: string; name: string; hint?: React.ReactNode; optional?: boolean; className?: string };

function useFieldIds(name: string, hint?: React.ReactNode) {
  const errors = useContext(FieldErrorsContext);
  const err = errors?.[name];
  const uid = useId();
  const id = `${name}-${uid}`;
  const hintId = hint ? `${id}-h` : undefined;
  const errId = err ? `${id}-e` : undefined;
  return {
    err,
    id,
    hintId,
    errId,
    aria: {
      id,
      name,
      'aria-invalid': err ? (true as const) : undefined,
      'aria-describedby': [hintId, errId].filter(Boolean).join(' ') || undefined,
    },
  };
}

function Shell({ label, hint, optional, className = '', ids, children }: ShellProps & { ids: ReturnType<typeof useFieldIds>; children: React.ReactNode }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={ids.id} className="text-[14px] font-medium">
        {label} {optional && <span className="font-normal text-tenue">(opcional)</span>}
      </label>
      {children}
      {hint && (
        <p id={ids.hintId} className="text-[13.5px] text-tenue">
          {hint}
        </p>
      )}
      {ids.err && (
        <p id={ids.errId} className="text-[13.5px] text-rosa-700">
          {ids.err}
        </p>
      )}
    </div>
  );
}

/** Campo de texto con etiqueta, ayuda y error conectados por ARIA. */
export function Field({
  label,
  name,
  hint,
  optional,
  className,
  inputClassName = '',
  ...input
}: ShellProps & { inputClassName?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'name' | 'id' | 'className'>) {
  const ids = useFieldIds(name, hint);
  return (
    <Shell label={label} name={name} hint={hint} optional={optional} className={className} ids={ids}>
      <input className={`field ${inputClassName}`} {...input} {...ids.aria} />
    </Shell>
  );
}

export function TextArea({
  label,
  name,
  hint,
  optional,
  className,
  ...input
}: ShellProps & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'name' | 'id' | 'className'>) {
  const ids = useFieldIds(name, hint);
  return (
    <Shell label={label} name={name} hint={hint} optional={optional} className={className} ids={ids}>
      <textarea className="field" {...input} {...ids.aria} />
    </Shell>
  );
}

export function Select({
  label,
  name,
  hint,
  optional,
  className,
  children,
  ...input
}: ShellProps & { children: React.ReactNode } & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'name' | 'id' | 'className'>) {
  const ids = useFieldIds(name, hint);
  return (
    <Shell label={label} name={name} hint={hint} optional={optional} className={className} ids={ids}>
      <select className="field" {...input} {...ids.aria}>
        {children}
      </select>
    </Shell>
  );
}

/** Interruptor accesible basado en checkbox. */
export function Toggle({ name, label, description, defaultChecked }: { name: string; label: string; description?: string; defaultChecked?: boolean }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span>
        <span className="block text-[15px] font-medium">{label}</span>
        {description && <span className="mt-0.5 block text-[14px] text-tenue">{description}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input id={id} type="checkbox" name={name} defaultChecked={defaultChecked} className="peer sr-only" />
        <span className="h-7 w-12 rounded-full bg-[rgb(37_38_44/0.18)] transition-colors peer-checked:bg-salvia-700 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-lavanda-700" />
        <span className="absolute left-1 top-1 size-5 rounded-full bg-white shadow transition-transform duration-300 ease-[var(--ease-out-quint)] peer-checked:translate-x-5" />
      </span>
    </label>
  );
}
