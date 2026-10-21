import Link from 'next/link';
import { Badge } from '@/components/ui';
import { apptName, type ApptRow } from '@/lib/admin-types';
import { APPOINTMENT_STATUS, type Tone } from '@/lib/labels';
import { fmtDate, fmtTime, MODALITY_LABEL } from '@/lib/format';

const DOT: Record<Tone, string> = {
  ocre: 'bg-ocre-700',
  lavanda: 'bg-lavanda-700',
  salvia: 'bg-salvia-700',
  rosa: 'bg-rosa-700',
  pizarra: 'bg-pizarra-700',
  neutro: 'bg-tenue',
};
const TEXT: Record<Tone, string> = {
  ocre: 'text-ocre-700',
  lavanda: 'text-lavanda-700',
  salvia: 'text-salvia-700',
  rosa: 'text-rosa-700',
  pizarra: 'text-pizarra-700',
  neutro: 'text-tenue',
};

/**
 * Una cita en una lista. En el celular el nombre puede ocupar dos líneas y el
 * estado se muestra como un punto de color bajo el nombre, para no cortar nada.
 */
export function ApptLine({ a, showDate = false }: { a: ApptRow; showDate?: boolean }) {
  const st = APPOINTMENT_STATUS[a.status] ?? { label: a.status, tone: 'neutro' as Tone };
  const web = a.source === 'publica' && !a.patient;
  return (
    <li>
      <Link
        href={`/admin/agenda/${a.id}`}
        className="flex min-h-[72px] items-center gap-3.5 px-4 py-3 transition-colors hover:bg-white/70 active:bg-white sm:min-h-16 sm:gap-4 sm:px-5"
      >
        <span className="flex w-[52px] shrink-0 flex-col tabular-nums sm:w-14">
          {showDate && (
            <span className="text-[12.5px] capitalize leading-tight text-tenue">{fmtDate(a.starts_at, { weekday: 'short', day: 'numeric' }).replace('.', '')}</span>
          )}
          <span className="text-[17px] font-medium leading-tight sm:text-[16px]">{fmtTime(a.starts_at)}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className={`text-[15.5px] leading-snug ${a.status === 'cancelada' ? 'text-tenue line-through decoration-1' : ''} line-clamp-2 sm:truncate`}>
            {apptName(a)}
          </span>
          <span className="mt-0.5 block truncate text-[13.5px] text-tenue">
            <span className={`mr-1.5 inline-flex items-center gap-1.5 font-medium sm:hidden ${TEXT[st.tone]}`}>
              <span aria-hidden className={`size-1.5 rounded-full ${DOT[st.tone]}`} />
              {st.label}
              <span aria-hidden className="font-normal text-tenue">·</span>
            </span>
            {MODALITY_LABEL[a.modality]}
            <span className="hidden sm:inline"> · {a.service?.name}</span>
            {web ? ' · solicitud web' : ''}
          </span>
        </span>
        <Badge tone={st.tone} className="shrink-0 max-sm:hidden">
          {st.label}
        </Badge>
        <svg aria-hidden viewBox="0 0 24 24" className="size-4 shrink-0 text-tenue/70 sm:hidden" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M9.5 6 15.5 12l-6 6" />
        </svg>
      </Link>
    </li>
  );
}
