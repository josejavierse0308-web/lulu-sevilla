import { redirect } from 'next/navigation';
import { ActionForm, Field } from '@/components/forms';
import { createSessionClient } from '@/lib/supabase/server';
import { restablecerContrasena } from '../actions';
import { AuthShell } from '../shell';

export const metadata = { title: 'Nueva contraseña' };

export default async function RestablecerPage() {
  // Solo se llega aquí con la sesión temporal que crea el enlace de recuperación.
  const supabase = await createSessionClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/admin/ingresar?motivo=enlace');

  return (
    <AuthShell
      title={
        <>
          Crea una <em>nueva contraseña.</em>
        </>
      }
    >
      <ActionForm action={restablecerContrasena} submitLabel="Guardar contraseña" className="flex flex-col gap-4">
        <Field
          label="Nueva contraseña"
          name="password"
          hint="Al menos 12 caracteres, combinando mayúsculas, minúsculas, números o símbolos."
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
        />
        <Field label="Repite la contraseña" name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
      </ActionForm>
    </AuthShell>
  );
}
