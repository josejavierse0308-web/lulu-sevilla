import Link from 'next/link';
import { ActionForm, Field } from '@/components/forms';
import { solicitarRecuperacion } from '../actions';
import { AuthShell } from '../shell';

export const metadata = { title: 'Recuperar acceso' };

export default function RecuperarPage() {
  return (
    <AuthShell
      title={
        <>
          Recupera <em>tu acceso.</em>
        </>
      }
      footer={
        <Link href="/admin/ingresar" className="link">
          Volver a ingresar
        </Link>
      }
    >
      <p className="mb-5 text-[15px] text-tenue">Te enviaremos un enlace para crear una nueva contraseña. El enlace es de un solo uso y caduca pronto.</p>
      <ActionForm action={solicitarRecuperacion} submitLabel="Enviar enlace" pendingLabel="Enviando…">
        <Field label="Correo de tu cuenta" name="email" type="email" autoComplete="username" required maxLength={254} />
      </ActionForm>
    </AuthShell>
  );
}
