import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ActionForm, Field } from '@/components/forms';
import { Notice } from '@/components/ui';
import { getAdminContext } from '@/lib/auth';
import { iniciarSesion } from '../actions';
import { AuthShell } from '../shell';

export const metadata = { title: 'Ingresar' };

const MOTIVOS: Record<string, string> = {
  salida: 'Cerraste sesión. Hasta pronto.',
  inactividad: 'Por seguridad cerramos tu sesión tras un tiempo sin actividad.',
  cuenta: 'Esta cuenta no tiene acceso al panel.',
  enlace: 'El enlace ya no es válido. Solicita uno nuevo.',
};

export default async function IngresarPage({ searchParams }: { searchParams: Promise<{ motivo?: string }> }) {
  const ctx = await getAdminContext();
  if (ctx.status === 'ok') redirect('/admin');
  if (ctx.status === 'mfa') redirect('/admin/verificar');
  const { motivo } = await searchParams;
  const aviso = motivo ? MOTIVOS[motivo] : undefined;

  return (
    <AuthShell
      title={
        <>
          Bienvenida <em>de nuevo.</em>
        </>
      }
      footer={
        <Link href="/admin/recuperar" className="link">
          ¿Olvidaste tu contraseña?
        </Link>
      }
    >
      {aviso && (
        <div className="mb-5">
          <Notice tone={motivo === 'cuenta' || motivo === 'enlace' ? 'rosa' : 'neutro'}>{aviso}</Notice>
        </div>
      )}
      <ActionForm action={iniciarSesion} submitLabel="Entrar" pendingLabel="Entrando…" className="flex flex-col gap-4">
        <Field label="Correo" name="email" type="email" autoComplete="username" required maxLength={254} />
        <Field label="Contraseña" name="password" type="password" autoComplete="current-password" required maxLength={200} />
      </ActionForm>
    </AuthShell>
  );
}
