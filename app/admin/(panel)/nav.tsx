'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const I = {
  hoy: (
    <path d="M12 4v1.5M12 18.5V20M4 12h1.5M18.5 12H20M6.3 6.3l1.1 1.1M16.6 16.6l1.1 1.1M6.3 17.7l1.1-1.1M16.6 7.4l1.1-1.1M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z" />
  ),
  agenda: <path d="M7 3.5v3M17 3.5v3M4.5 9.5h15M6 5.5h12A1.5 1.5 0 0 1 19.5 7v11A1.5 1.5 0 0 1 18 19.5H6A1.5 1.5 0 0 1 4.5 18V7A1.5 1.5 0 0 1 6 5.5Z" />,
  pacientes: (
    <path d="M9 11a3.25 3.25 0 1 0 0-6.5A3.25 3.25 0 0 0 9 11ZM3.5 19c.6-3 2.8-5 5.5-5s4.9 2 5.5 5M15.5 4.8a3.2 3.2 0 0 1 0 6M17 14.2c1.8.6 3.1 2.3 3.5 4.8" />
  ),
  pagos: <path d="M4 7.5h16v10H4zM4 11h16M7.5 14.5h3" />,
  config: <path d="M5 7h9M18 7h1M5 17h3M12 17h7M14 5v4M8 15v4" />,
  bitacora: <path d="M7 4.5h10A1.5 1.5 0 0 1 18.5 6v13l-3-2-3.5 2-3.5-2-3 2V6A1.5 1.5 0 0 1 7 4.5ZM9 9h6M9 12.5h4" />,
};

export type NavItem = { href: string; label: string; icon: keyof typeof I; count?: number };

function isActive(path: string, href: string) {
  return href === '/admin' ? path === '/admin' : path === href || path.startsWith(href + '/');
}

function Icon({ name }: { name: keyof typeof I }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="size-[22px] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {I[name]}
    </svg>
  );
}

export function SideNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <ul className="flex flex-col gap-1">
      {items.map((it) => {
        const on = isActive(path, it.href);
        return (
          <li key={it.href}>
            <Link
              href={it.href}
              aria-current={on ? 'page' : undefined}
              className={`flex min-h-11 items-center gap-3 rounded-2xl px-3.5 text-[15px] transition-colors duration-200 ${
                on ? 'bg-tinta text-hueso' : 'text-tinta hover:bg-[rgb(37_38_44/0.06)]'
              }`}
            >
              <Icon name={it.icon} />
              <span className="flex-1">{it.label}</span>
              {!!it.count && (
                <span
                  className={`min-w-6 rounded-full px-1.5 text-center text-[12.5px] font-medium leading-6 ${on ? 'bg-white/20' : 'bg-ocre-50 text-ocre-700'}`}
                >
                  {it.count}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function BottomNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <ul className="grid grid-cols-5">
      {items.map((it) => {
        const on = isActive(path, it.href);
        return (
          <li key={it.href}>
            <Link
              href={it.href}
              aria-current={on ? 'page' : undefined}
              className={`relative flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-[12px] transition-colors active:text-tinta ${on ? 'font-medium text-tinta' : 'text-tenue'}`}
            >
              <span className={`flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-300 ${on ? 'bg-lavanda' : ''}`}>
                <Icon name={it.icon} />
              </span>
              {it.label}
              {!!it.count && (
                <span className="absolute left-[calc(50%+6px)] top-1 min-w-[18px] rounded-full bg-ocre-700 px-1 text-center text-[11px] font-medium leading-[18px] text-white ring-2 ring-hueso">
                  {it.count > 9 ? '9+' : it.count}
                  <span className="sr-only"> por confirmar</span>
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
