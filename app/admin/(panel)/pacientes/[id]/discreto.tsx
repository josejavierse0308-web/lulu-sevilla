'use client';

import { useEffect, useState } from 'react';

const KEY = 'lulu:discreto';

/** Difumina las notas clínicas en pantalla (se recuerda en este navegador). */
export function DiscreetToggle() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let v = false;
    try {
      v = localStorage.getItem(KEY) === '1';
    } catch {
      /* almacenamiento no disponible */
    }
    setOn(v);
  }, []);
  useEffect(() => {
    if (on) document.documentElement.setAttribute('data-discreto', '');
    else document.documentElement.removeAttribute('data-discreto');
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {
      /* nada */
    }
  }, [on]);
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => setOn((v) => !v)}
      className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full text-[14px] transition-colors max-sm:size-11 sm:px-4 ${on ? 'bg-tinta text-hueso' : 'border border-linea-fuerte bg-superficie hover:bg-white'}`}
      title="Difumina el contenido clínico; pasa el cursor o mantén el dedo encima para leerlo."
      aria-label="Modo discreto"
    >
      <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        {on ? (
          <path d="M3 3l18 18M10.6 6.2A9.6 9.6 0 0 1 12 6c5 0 9 6 9 6a16 16 0 0 1-3.2 3.7M6.3 7.8A16 16 0 0 0 3 12s4 6 9 6c1.3 0 2.5-.3 3.6-.8M9.9 9.9a3 3 0 0 0 4.2 4.2" />
        ) : (
          <path d="M3 12s4-6 9-6 9 6 9 6-4 6-9 6-9-6-9-6Zm9 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
        )}
      </svg>
      <span className="max-sm:hidden">Modo discreto</span>
    </button>
  );
}
