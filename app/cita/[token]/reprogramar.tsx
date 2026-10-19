'use client';

import { useEffect, useMemo, useState } from 'react';
import { ActionForm } from '@/components/forms';
import { addDays, dateKey, fmtDate, fmtTime } from '@/lib/format';
import type { FormAction } from '@/lib/action-result';

/** Elige un nuevo horario libre (consulta la misma API pública que la página). */
export function Reprogramar({ token, serviceId, tz, action }: { token: string; serviceId: string; tz: string; action: FormAction }) {
  const [page, setPage] = useState(0);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [pick, setPick] = useState<string>('');

  const start = useMemo(() => addDays(dateKey(new Date(), tz), page * 14), [page, tz]);

  useEffect(() => {
    let alive = true;
    setSlots(null);
    setError(null);
    fetch(`/api/publico/horarios?servicio=${serviceId}&desde=${start}&hasta=${addDays(start, 13)}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.message || 'No se pudieron cargar los horarios.');
        return d.slots as string[];
      })
      .then((s) => {
        if (!alive) return;
        setSlots(s);
        setDay((cur) => cur ?? (s[0] ? dateKey(s[0], tz) : null));
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [serviceId, start, tz]);

  const byDay = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of slots ?? []) {
      const k = dateKey(s, tz);
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return m;
  }, [slots, tz]);
  const days = Array.from({ length: 14 }, (_, i) => addDays(start, i));
  const noon = (k: string) => new Date(k + 'T18:00:00Z');

  return (
    <ActionForm action={action} submitLabel="Solicitar este nuevo horario" pendingLabel="Enviando…" hideSubmit={!pick}>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="inicio" value={pick} />
      <div className="flex items-center justify-between gap-3">
        <p className="display text-[20px] italic">{fmtDate(noon(days[0]!), { month: 'long', year: 'numeric' }, tz)}</p>
        <div className="flex gap-2">
          <button
            type="button"
            className="min-h-11 min-w-11 rounded-full border border-linea-fuerte disabled:opacity-30"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            aria-label="Días anteriores"
          >
            ←
          </button>
          <button
            type="button"
            className="min-h-11 min-w-11 rounded-full border border-linea-fuerte disabled:opacity-30"
            disabled={page >= 3}
            onClick={() => setPage((p) => p + 1)}
            aria-label="Días siguientes"
          >
            →
          </button>
        </div>
      </div>
      {error && <p className="mt-3 text-[15px] text-rosa-700">{error}</p>}
      <div className="mt-3 grid grid-cols-7 gap-1.5" aria-busy={slots === null}>
        {days.map((k) => {
          const n = byDay.get(k)?.length ?? 0;
          const on = day === k;
          return (
            <button
              key={k}
              type="button"
              disabled={!n}
              aria-pressed={on}
              onClick={() => {
                setDay(k);
                setPick('');
              }}
              className={`flex min-h-16 flex-col items-center justify-center rounded-2xl border text-center transition-colors ${
                on ? 'border-tinta bg-tinta text-hueso' : 'border-linea-fuerte bg-white/60'
              } disabled:border-dashed disabled:bg-transparent disabled:opacity-40`}
              aria-label={`${fmtDate(noon(k), { weekday: 'long', day: 'numeric', month: 'long' }, tz)}${n ? `, ${n} horarios` : ', sin horarios'}`}
            >
              <span className="text-[12px] capitalize">{fmtDate(noon(k), { weekday: 'short' }, tz).replace('.', '')}</span>
              <span className="display text-[22px] leading-none">{fmtDate(noon(k), { day: 'numeric' }, tz)}</span>
            </button>
          );
        })}
      </div>
      {day && (
        <fieldset className="mt-5">
          <legend className="mb-2 text-[14px] text-tenue">{fmtDate(noon(day), { weekday: 'long', day: 'numeric', month: 'long' }, tz)}</legend>
          <div className="flex flex-wrap gap-2">
            {(byDay.get(day) ?? []).map((s) => (
              <label
                key={s}
                className={`relative inline-flex min-h-11 min-w-20 cursor-pointer items-center justify-center rounded-full border px-4 tabular-nums has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-lavanda-700 ${
                  pick === s ? 'border-tinta bg-tinta text-hueso' : 'border-linea-fuerte bg-white/60'
                }`}
              >
                <input type="radio" name="_hora" value={s} checked={pick === s} onChange={() => setPick(s)} className="sr-only" />
                {fmtTime(s, tz)}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {slots && !slots.length && !error && <p className="mt-3 text-[15px] text-tenue">No hay horarios libres en estos días; prueba con los siguientes.</p>}
    </ActionForm>
  );
}
