'use client';

import { useEffect, useRef } from 'react';

/**
 * En una fila de pestañas con desplazamiento horizontal, lleva a la vista la
 * pestaña activa (por ejemplo «Pagos», que en el celular queda fuera de la pantalla).
 */
export function ScrollActiveIntoView() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const row = ref.current?.parentElement;
    const active = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row || !active) return;
    const left = active.offsetLeft - (row.clientWidth - active.offsetWidth) / 2;
    row.scrollTo({ left: Math.max(0, left), behavior: 'instant' as ScrollBehavior });
  });
  return <span ref={ref} hidden />;
}
