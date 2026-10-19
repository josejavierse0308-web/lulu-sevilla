import Link from 'next/link';
import { Badge } from '@/components/ui';
import { apptName, type ApptRow } from '@/lib/admin-types';
import { APPOINTMENT_STATUS, type Tone } from '@/lib/labels';
import { fmtDate, fmtTime, MODALITY_LABEL } from '@/lib/format';

export function ApptLine({ a, showDate = false }: { a: ApptRow; showDate?: boolean }) {
  const st = APPOINTMENT_STATUS[a.status] ?? { label: a.status, tone: 'neutro' as Tone };
  return (
    <li>
      <Link href={`/admin/agenda/${a.id}`} className="flex min-h-16 items-center gap-4 px-4 py-3 transition-colors hover:bg-white/70 sm:px-5">
        <span className="w-14 shrink-0 tabular-nums">
          {showDate && (
            <span className="block text-[12.5px] capitalize text-tenue">{fmtDate(a.starts_at, { weekday: 'short', day: 'numeric' }).replace('.', '')}</span>
          )}
          <span className="text-[16px] font-medium">{fmtTime(a.starts_at)}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15.5px]">{apptName(a)}</span>
          <span className="block truncate text-[13.5px] text-tenue">
            {a.service?.name} · {MODALITY_LABEL[a.modality]}
            {a.source === 'publica' && !a.patient ? ' · solicitud web' : ''}
          </span>
        </span>
        <Badge tone={st.tone} className="shrink-0">
          {st.label}
        </Badge>
      </Link>
    </li>
  );
}
