import Link from 'next/link';
import type { Tone } from '@/lib/labels';

type BtnVariant = 'primary' | 'secondary' | 'quiet' | 'danger';
type BtnSize = 'md' | 'sm';

export function btn(variant: BtnVariant = 'secondary', size: BtnSize = 'md', extra = '') {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap select-none ' +
    'transition-[transform,background-color,box-shadow,border-color] duration-200 ease-[var(--ease-out-quint)] ' +
    'active:scale-[0.97] disabled:opacity-55 disabled:pointer-events-none';
  const sizes = { md: 'min-h-11 px-5 text-[15px]', sm: 'min-h-9 px-3.5 text-[14px]' };
  const variants: Record<BtnVariant, string> = {
    primary:
      'bg-[linear-gradient(180deg,#3a3c46,#24252c)] text-[#f6f3ee] shadow-[inset_0_1px_0_rgb(255_255_255/0.16),0_10px_22px_-12px_rgb(30_28_45/0.6)] hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_14px_26px_-12px_rgb(30_28_45/0.7)]',
    secondary: 'border border-linea-fuerte bg-superficie text-tinta hover:border-[rgb(37_38_44/0.4)] hover:bg-white',
    quiet: 'text-tinta hover:bg-[rgb(37_38_44/0.06)]',
    danger: 'border border-rosa-700/40 bg-rosa-50 text-rosa-700 hover:border-rosa-700/70',
  };
  return `${base} ${sizes[size]} ${variants[variant]} ${extra}`;
}

const TONES: Record<Tone, string> = {
  ocre: 'bg-ocre-50 text-ocre-700',
  lavanda: 'bg-lavanda-50 text-lavanda-700',
  salvia: 'bg-salvia-50 text-salvia-700',
  rosa: 'bg-rosa-50 text-rosa-700',
  pizarra: 'bg-pizarra-50 text-pizarra-700',
  neutro: 'bg-[rgb(37_38_44/0.07)] text-tenue',
};

export function Badge({ tone, children, className = '' }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-medium leading-6 ${TONES[tone]} ${className}`}>
      <span aria-hidden className="size-1.5 rounded-full bg-current opacity-80" />
      {children}
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-3 inline-flex min-h-9 items-center gap-1.5 text-[14px] text-tenue hover:text-tinta">
            <span aria-hidden>←</span> {back.label}
          </Link>
        )}
        <h1 className="display text-[clamp(34px,6vw,52px)]">{title}</h1>
        {subtitle && <div className="mt-2 text-[15px] text-tenue">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  className = '',
  id,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`panel min-w-0 p-5 sm:p-7 ${className}`}>
      {(title || actions) && (
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="display text-[28px]">{title}</h2>}
            {description && <p className="mt-1 max-w-[62ch] text-[15px] text-tenue">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-linea-fuerte px-5 py-8 sm:px-7">
      <span aria-hidden className="size-9 rounded-full bg-[radial-gradient(circle_at_40%_35%,#fff,#e4dfee_70%)] shadow-[0_8px_20px_-10px_rgb(60_55_90/0.5)]" />
      <p className="display text-[24px]">{title}</p>
      {children && <div className="max-w-[56ch] text-[15px] text-tenue">{children}</div>}
      {action}
    </div>
  );
}

export function KeyValue({ items }: { items: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="divide-y divide-linea">
      {items.map(([k, v]) => (
        <div key={k} className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-[minmax(150px,1fr)_2fr] sm:gap-4">
          <dt className="text-[14px] text-tenue">{k}</dt>
          <dd className="min-w-0 break-words text-[15px]">{v ?? <span className="text-tenue">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Notice({ tone = 'neutro', children }: { tone?: Tone; children: React.ReactNode }) {
  return <div className={`rounded-2xl px-4 py-3 text-[15px] ${TONES[tone]}`}>{children}</div>;
}

/** Pestañas como enlaces (funcionan sin JavaScript y con teclado). */
export function Tabs({ items, current }: { items: Array<{ key: string; label: string; href: string; count?: number }>; current: string }) {
  return (
    <nav aria-label="Secciones" className="no-print -mx-1 mb-6 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
      {items.map((t) => {
        const on = t.key === current;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={on ? 'page' : undefined}
            className={`flex min-h-10 shrink-0 items-center gap-2 rounded-full px-4 text-[15px] transition-colors ${
              on ? 'bg-tinta text-hueso' : 'text-tinta hover:bg-[rgb(37_38_44/0.06)]'
            }`}
          >
            {t.label}
            {t.count != null && t.count > 0 && (
              <span className={`rounded-full px-1.5 text-[12px] ${on ? 'bg-white/20' : 'bg-[rgb(37_38_44/0.08)]'}`}>{t.count}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
