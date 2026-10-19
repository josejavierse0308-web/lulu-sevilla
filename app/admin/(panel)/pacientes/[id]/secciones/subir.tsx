'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { btn } from '@/components/ui';
import { announce } from '@/components/toaster';
import { prepararSubida, registrarDocumento } from '../../actions';

const MAX = 10 * 1024 * 1024;
const TYPES: Record<string, string> = { 'application/pdf': 'PDF', 'image/jpeg': 'JPG', 'image/png': 'PNG' };

/**
 * Sube el archivo directamente al almacenamiento privado con una URL firmada
 * de un solo uso (el archivo no pasa por el servidor del sitio) y después lo
 * registra en el expediente.
 */
export function SubirDocumento({ patientId }: { patientId: string }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const title = String(fd.get('titulo') ?? '').trim();
    if (!file) return setError('Elige un archivo.');
    if (!TYPES[file.type]) return setError('Solo se aceptan archivos PDF, JPG o PNG.');
    if (file.size > MAX) return setError('El archivo pesa más de 10 MB.');
    if (title.length < 2) return setError('Escribe un nombre para el documento.');
    setBusy(true);
    try {
      const prep = await prepararSubida(patientId, file.type, file.size);
      if ('error' in prep) throw new Error(prep.error);
      const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const up = await sb.storage.from('expedientes').uploadToSignedUrl(prep.path, prep.token, file, { contentType: file.type, upsert: false });
      if (up.error) throw new Error('No se pudo subir el archivo. Revisa tu conexión e inténtalo de nuevo.');
      const reg = new FormData();
      reg.set('paciente', patientId);
      reg.set('ruta', prep.path);
      reg.set('titulo', title);
      reg.set('tipo', String(fd.get('tipo') ?? 'documento'));
      reg.set('mime', file.type);
      const r = await registrarDocumento(null, reg);
      if (!r?.ok) throw new Error(r?.message ?? 'No se pudo registrar el documento.');
      announce(r.message ?? 'Documento guardado.');
      form.current?.reset();
      setFile(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo subir el archivo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={form} onSubmit={onSubmit} className="grid gap-4" aria-busy={busy}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="doc-titulo" className="text-[14px] font-medium">
            Nombre del documento
          </label>
          <input id="doc-titulo" name="titulo" className="field" maxLength={140} required placeholder="Ej. Consentimiento informado firmado" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="doc-tipo" className="text-[14px] font-medium">
            Tipo
          </label>
          <select id="doc-tipo" name="tipo" className="field" defaultValue="documento">
            <option value="documento">Documento</option>
            <option value="consentimiento_firmado">Consentimiento firmado</option>
          </select>
        </div>
      </div>
      <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-linea-fuerte bg-white/40 px-4 py-6 text-center transition-colors hover:bg-white/70 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-lavanda-700">
        <input type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <span className="text-[15px] font-medium">{file ? file.name : 'Elegir archivo'}</span>
        <span className="text-[13.5px] text-tenue">
          {file ? `${TYPES[file.type] ?? 'Tipo no admitido'} · ${(file.size / 1024 / 1024).toFixed(1)} MB` : 'PDF, JPG o PNG · hasta 10 MB'}
        </span>
      </label>
      {error && (
        <p role="alert" className="rounded-2xl bg-rosa-50 px-4 py-3 text-[15px] text-rosa-700">
          {error}
        </p>
      )}
      <div>
        <button type="submit" className={btn('primary')} disabled={busy}>
          {busy ? 'Subiendo…' : 'Subir documento'}
        </button>
      </div>
    </form>
  );
}
