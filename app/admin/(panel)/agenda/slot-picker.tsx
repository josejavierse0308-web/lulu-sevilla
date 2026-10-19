'use client';

import { useEffect, useState, useTransition } from 'react';
import { fmtTime, todayKey, zonedToDate } from '@/lib/format';
import { horariosLibres } from './actions';

type Service = { id: string; name: string; duration_min: number; modality: string };

/**
 * Selector de horario para el panel: muestra los horarios libres según la
 * disponibilidad configurada y permite escribir otra hora (fuera del horario
 * publicado). La base de datos sigue impidiendo cualquier empalme.
 */
export function SlotPicker({
  services,
  fixedServiceId,
  exclude,
  defaultDay,
}: {
  services?: Service[];
  fixedServiceId?: string;
  exclude?: string;
  defaultDay?: string;
}) {
  const [serviceId, setServiceId] = useState(fixedServiceId ?? services?.[0]?.id ?? '');
  const [day, setDay] = useState(defaultDay ?? todayKey());
  const [slots, setSlots] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState('');
  const [manual, setManual] = useState(false);
  const [manualTime, setManualTime] = useState('');
  const [loading, start] = useTransition();

  useEffect(() => {
    if (!serviceId || !day) return;
    setPick('');
    start(async () => {
      const r = await horariosLibres(serviceId, day, exclude);
      setSlots(r.slots);
      setError(r.error ?? null);
    });
  }, [serviceId, day, exclude]);

  const iso = manual ? (manualTime && day ? zonedToDate(day, manualTime).toISOString() : '') : pick;

  return (
    <div className="grid gap-4">
      {services && !fixedServiceId && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sp-servicio" className="text-[14px] font-medium">
            Tipo de sesión
          </label>
          <select id="sp-servicio" name="servicio" className="field" value={serviceId} onChange={(e) => setServiceId(e.target.value)} required>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.duration_min} min
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="sp-dia" className="text-[14px] font-medium">
          Día
        </label>
        <input id="sp-dia" type="date" className="field max-w-xs" value={day} min={todayKey()} onChange={(e) => setDay(e.target.value)} required />
      </div>

      <fieldset>
        <legend className="mb-2 text-[14px] font-medium">Horario</legend>
        {!manual && (
          <div className="flex flex-wrap gap-2" aria-busy={loading}>
            {loading && <p className="text-[14px] text-tenue">Buscando horarios libres…</p>}
            {!loading && error && <p className="text-[14px] text-rosa-700">{error}</p>}
            {!loading && slots && !slots.length && !error && (
              <p className="text-[14px] text-tenue">No hay horarios libres ese día dentro de tu horario de atención.</p>
            )}
            {!loading &&
              slots?.map((s) => (
                <label
                  key={s}
                  className={`relative inline-flex min-h-11 min-w-20 cursor-pointer items-center justify-center rounded-full border px-4 tabular-nums transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-lavanda-700 ${
                    pick === s ? 'border-tinta bg-tinta text-hueso' : 'border-linea-fuerte bg-superficie hover:bg-white'
                  }`}
                >
                  <input type="radio" name="_slot" value={s} checked={pick === s} onChange={() => setPick(s)} className="sr-only" />
                  {fmtTime(s)}
                </label>
              ))}
          </div>
        )}
        {manual && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sp-hora" className="text-[14px]">
              Hora de inicio
            </label>
            <input id="sp-hora" type="time" step={300} className="field max-w-[180px]" value={manualTime} onChange={(e) => setManualTime(e.target.value)} />
            <p className="text-[13.5px] text-tenue">Puede quedar fuera de tu horario publicado; nunca se permitirá encimarla con otra cita.</p>
          </div>
        )}
        <button type="button" className="link mt-3 min-h-9 text-[14px]" onClick={() => setManual((m) => !m)}>
          {manual ? 'Ver horarios libres' : 'Escribir otra hora'}
        </button>
      </fieldset>
      <input type="hidden" name="inicio" value={iso} />
    </div>
  );
}
