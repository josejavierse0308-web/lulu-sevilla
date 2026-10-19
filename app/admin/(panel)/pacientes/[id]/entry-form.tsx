'use client';

import { useState } from 'react';
import { ActionForm, Field, Select, TextArea } from '@/components/forms';
import type { FormAction } from '@/lib/action-result';
import { todayKey } from '@/lib/format';

export type EntryValues = {
  id?: string;
  kind?: string;
  title?: string | null;
  body?: string;
  entry_date?: string;
  goal_status?: string | null;
  appointment_id?: string | null;
};

export function EntryForm({
  action,
  patientId,
  values = {},
  sessions,
  submitLabel,
}: {
  action: FormAction;
  patientId: string;
  values?: EntryValues;
  sessions: Array<{ id: string; label: string }>;
  submitLabel: string;
}) {
  const [kind, setKind] = useState(values.kind ?? 'nota_sesion');
  return (
    <ActionForm action={action} submitLabel={submitLabel} className="grid gap-5">
      <input type="hidden" name="paciente" value={patientId} />
      {values.id && <input type="hidden" name="id" value={values.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Tipo de registro" name="tipo" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="nota_sesion">Nota de sesión</option>
          <option value="observacion">Observación profesional</option>
          <option value="objetivo">Objetivo de seguimiento</option>
          <option value="evolucion">Evolución</option>
        </Select>
        <Field label="Fecha" name="fecha" type="date" required max={todayKey()} defaultValue={values.entry_date ?? todayKey()} />
      </div>
      {!values.id && sessions.length > 0 && (
        <Select label="Sesión relacionada" name="cita" optional defaultValue={values.appointment_id ?? ''}>
          <option value="">Ninguna</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
      )}
      <Field label="Título" name="titulo" optional maxLength={140} defaultValue={values.title ?? ''} />
      {kind === 'objetivo' && (
        <Select label="Estado del objetivo" name="estado_objetivo" defaultValue={values.goal_status ?? 'activo'}>
          <option value="activo">En curso</option>
          <option value="logrado">Logrado</option>
          <option value="pausado">En pausa</option>
        </Select>
      )}
      <TextArea
        label="Contenido"
        name="contenido"
        required
        rows={14}
        maxLength={20000}
        defaultValue={values.body ?? ''}
        hint="Escrito y validado por ti. Solo es visible para tu cuenta."
        className="clinico"
      />
    </ActionForm>
  );
}
