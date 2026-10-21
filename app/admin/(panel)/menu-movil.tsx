'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { Icon } from '@/components/icons';

/** Menú del encabezado en el celular: bitácora, cuenta y cierre de sesión. */
export function MobileMenu({ email, logout }: { email: string; logout: () => Promise<void> }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const path = usePathname();

  useEffect(() => {
    ref.current?.removeAttribute('open');
  }, [path]);

  useEffect(() => {
    function close(e: Event) {
      const d = ref.current;
      if (d?.open && !d.contains(e.target as Node)) d.removeAttribute('open');
    }
    function esc(e: KeyboardEvent) {
      if (e.key === 'Escape') ref.current?.removeAttribute('open');
    }
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', esc);
    };
  }, []);

  return (
    <details ref={ref} className="group relative">
      <summary
        aria-label="Menú"
        className="flex size-11 cursor-pointer list-none items-center justify-center rounded-full transition-colors hover:bg-[rgb(37_38_44/0.06)] group-open:bg-[rgb(37_38_44/0.08)] [&::-webkit-details-marker]:hidden"
      >
        <Icon name="menu" className="size-6" />
      </summary>
      <div className="aparecer absolute right-0 top-[calc(100%+8px)] z-40 w-[min(84vw,300px)] overflow-hidden rounded-3xl border border-linea bg-superficie shadow-[0_30px_60px_-24px_rgb(30_30_50/0.45)]">
        <p className="truncate border-b border-linea px-5 py-3.5 text-[13.5px] text-tenue">{email}</p>
        <Link href="/admin/bitacora" onClick={() => ref.current?.removeAttribute('open')} className="flex min-h-[52px] items-center gap-3 px-5 text-[15.5px] hover:bg-white">
          <Icon name="bitacora" className="size-[22px] text-tenue" />
          Bitácora de accesos
        </Link>
        <form action={logout} className="border-t border-linea">
          <button type="submit" className="flex min-h-[52px] w-full items-center gap-3 px-5 text-left text-[15.5px] text-rosa-700 hover:bg-white">
            <Icon name="salir" className="size-[22px]" />
            Cerrar sesión
          </button>
        </form>
      </div>
    </details>
  );
}
