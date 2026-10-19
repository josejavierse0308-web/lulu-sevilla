import { ActionForm, Field, Select } from '@/components/forms';
import type { FormAction } from '@/lib/action-result';

export type PatientValues = {
  id?: string;
  full_name?: string;
  email?: string | null;
  phone?: string | null;
  birth_date?: string | null;
  preferred_contact?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  emergency_contact_relation?: string | null;
  session_price_cents?: number | null;
  status?: string;
};

export function PatientForm({ action, values = {}, submitLabel }: { action: FormAction; values?: PatientValues; submitLabel: string }) {
  const editing = !!values.id;
  return (
    <ActionForm action={action} submitLabel={submitLabel} className="grid gap-8">
      {editing && <input type="hidden" name="id" value={values.id} />}
      <fieldset className="grid gap-4">
        <legend className="display mb-3 text-[24px]">Datos generales</legend>
        <Field label="Nombre completo" name="nombre" required maxLength={120} autoComplete="off" defaultValue={values.full_name ?? ''} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Teléfono" name="telefono" type="tel" optional maxLength={20} defaultValue={values.phone ?? ''} />
          <Field label="Correo" name="correo" type="email" optional maxLength={254} defaultValue={values.email ?? ''} />
          <Select label="Medio de contacto preferido" name="preferencia" optional defaultValue={values.preferred_contact ?? ''}>
            <option value="">Sin preferencia</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="telefono">Llamada</option>
            <option value="correo">Correo</option>
          </Select>
          <Field
            label="Fecha de nacimiento"
            name="nacimiento"
            type="date"
            optional
            defaultValue={values.birth_date ?? ''}
            hint="Regístrala solo si es necesaria para la atención."
          />
        </div>
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="display mb-1 text-[24px]">Contacto de emergencia</legend>
        <p className="-mt-2 mb-1 text-[14px] text-tenue">Solo cuando proceda.</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Nombre" name="emergencia_nombre" optional maxLength={120} defaultValue={values.emergency_contact_name ?? ''} />
          <Field label="Teléfono" name="emergencia_telefono" type="tel" optional maxLength={20} defaultValue={values.emergency_contact_phone ?? ''} />
          <Field label="Relación" name="emergencia_relacion" optional maxLength={60} defaultValue={values.emergency_contact_relation ?? ''} />
        </div>
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="display mb-3 text-[24px]">Administración</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Precio por sesión para este paciente"
            name="precio"
            inputMode="decimal"
            optional
            placeholder="Usa el precio del servicio"
            defaultValue={values.session_price_cents != null ? String(values.session_price_cents / 100) : ''}
            hint="Déjalo vacío para usar el precio del tipo de sesión."
          />
          {editing && (
            <Select label="Estado del expediente" name="estado" defaultValue={values.status ?? 'activo'}>
              <option value="activo">Activo</option>
              <option value="en_pausa">En pausa</option>
              <option value="alta">Alta</option>
              <option value="archivado">Archivado</option>
            </Select>
          )}
        </div>
      </fieldset>
    </ActionForm>
  );
}
