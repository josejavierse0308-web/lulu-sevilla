'use client';

import { useState, useTransition } from 'react';
import { ActionForm, Field } from '@/components/forms';
import { btn } from '@/components/ui';
import { confirmarDosPasos, iniciarDosPasos } from './actions';

/** Alta de la verificación en dos pasos: código QR + primer código de verificación. */
export function DosPasos() {
  const [data, setData] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  if (!data) {
    return (
      <div className="grid gap-3">
        <button
          type="button"
          className={btn('primary')}
          disabled={busy}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await iniciarDosPasos();
              if (r.error || !r.factorId) setError(r.error ?? 'No se pudo iniciar.');
              else setData({ factorId: r.factorId, qr: r.qr!, secret: r.secret! });
            })
          }
        >
          {busy ? 'Preparando…' : 'Activar verificación en dos pasos'}
        </button>
        {error && <p className="text-[15px] text-rosa-700">{error}</p>}
      </div>
    );
  }

  return (
    <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:items-start">
      {/* El QR lo genera Supabase como imagen SVG en data URL */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={data.qr} alt="Código QR para tu aplicación de autenticación" width={180} height={180} className="rounded-2xl bg-white p-3" />
      <div className="grid gap-3">
        <ol className="list-decimal pl-5 text-[15px] leading-relaxed">
          <li>Escanea el código con tu aplicación de autenticación.</li>
          <li>
            Si no puedes escanearlo, escribe esta clave: <code className="break-all rounded bg-white px-1.5 py-0.5 text-[13px]">{data.secret}</code>
          </li>
          <li>Escribe el código de 6 dígitos que aparece en la aplicación.</li>
        </ol>
        <ActionForm action={confirmarDosPasos} submitLabel="Verificar y activar">
          <input type="hidden" name="factor" value={data.factorId} />
          <Field
            label="Código"
            name="codigo"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            required
            inputClassName="max-w-[200px] tracking-[0.3em]"
          />
        </ActionForm>
      </div>
    </div>
  );
}
