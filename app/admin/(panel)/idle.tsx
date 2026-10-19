'use client';

import { useEffect, useRef, useState } from 'react';
import { btn } from '@/components/ui';

const LIMIT_MS = 30 * 60 * 1000; // 30 minutos sin actividad
const WARN_MS = 25 * 60 * 1000;

/**
 * Cierra la sesión tras 30 minutos sin actividad (con aviso a los 25), para
 * que el panel no quede abierto en un equipo desatendido.
 */
export function IdleGuard({ logout }: { logout: () => Promise<void> }) {
  const last = useRef(Date.now());
  const [warn, setWarn] = useState(false);

  useEffect(() => {
    const bump = () => {
      last.current = Date.now();
      setWarn(false);
    };
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const t = window.setInterval(() => {
      const idle = Date.now() - last.current;
      if (idle >= LIMIT_MS) {
        window.clearInterval(t);
        void logout();
      } else if (idle >= WARN_MS) {
        setWarn(true);
      }
    }, 15_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      window.clearInterval(t);
    };
  }, [logout]);

  if (!warn) return null;
  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      className="aparecer fixed inset-x-4 bottom-24 z-40 mx-auto max-w-md rounded-3xl border border-linea bg-superficie p-5 shadow-[0_30px_60px_-30px_rgb(30_30_50/0.5)] md:bottom-8"
    >
      <p className="text-[15px]">Tu sesión se cerrará en unos minutos por inactividad.</p>
      <button type="button" className={btn('primary', 'sm', 'mt-3')} onClick={() => setWarn(false)}>
        Sigo aquí
      </button>
    </div>
  );
}
