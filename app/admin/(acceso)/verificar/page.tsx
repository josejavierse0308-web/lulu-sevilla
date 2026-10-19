import { redirect } from 'next/navigation';
import { ActionForm, Field } from '@/components/forms';
import { getAdminContext } from '@/lib/auth';
import { cerrarSesion, verificarCodigo } from '../actions';
import { AuthShell } from '../shell';

export const metadata = { title: 'Verificación' };

export default async function VerificarPage() {
  const ctx = await getAdminContext();
  if (ctx.status === 'anon') redirect('/admin/ingresar');
  if (ctx.status === 'ok') redirect('/admin');
  if (ctx.status === 'forbidden') redirect('/admin/ingresar?motivo=cuenta');

  return (
    <AuthShell
      title={
        <>
          Un paso <em>más.</em>
        </>
      }
      footer={
        <form action={cerrarSesion}>
          <button type="submit" className="link">
            Usar otra cuenta
          </button>
        </form>
      }
    >
      <p className="mb-5 text-[15px] text-tenue">Abre tu aplicación de autenticación y escribe el código de 6 dígitos.</p>
      <ActionForm action={verificarCodigo} submitLabel="Verificar" pendingLabel="Verificando…">
        <Field
          label="Código"
          name="code"
          inputClassName="text-center text-[22px] tracking-[0.4em]"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          required
          autoFocus
        />
      </ActionForm>
    </AuthShell>
  );
}
