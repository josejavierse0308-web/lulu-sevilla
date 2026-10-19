'use client';

import { useEffect, useState } from 'react';

type Toast = { id: number; text: string; ok: boolean };

/** Avisa de un resultado aunque el formulario que lo originó ya no exista. */
export function announce(text: string, ok = true) {
  window.dispatchEvent(new CustomEvent('lulu:aviso', { detail: { text, ok } }));
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    let n = 0;
    const on = (e: Event) => {
      const { text, ok } = (e as CustomEvent<{ text: string; ok: boolean }>).detail;
      const id = ++n;
      setItems((xs) => [...xs.slice(-2), { id, text, ok }]);
      window.setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 6000);
    };
    window.addEventListener('lulu:aviso', on);
    return () => window.removeEventListener('lulu:aviso', on);
  }, []);
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-24 z-50 flex flex-col items-center gap-2 md:bottom-8 md:left-auto md:right-8 md:items-end"
    >
      {items.map((t) => (
        <p
          key={t.id}
          className={`aparecer pointer-events-auto max-w-sm rounded-2xl px-4 py-3 text-[15px] shadow-[0_20px_40px_-20px_rgb(30_30_50/0.5)] ${
            t.ok ? 'bg-tinta text-hueso' : 'bg-rosa-50 text-rosa-700'
          }`}
        >
          {t.text}
        </p>
      ))}
    </div>
  );
}
