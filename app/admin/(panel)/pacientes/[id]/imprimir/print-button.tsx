'use client';

import { btn } from '@/components/ui';

export function PrintButton() {
  return (
    <button type="button" className={btn('primary')} onClick={() => window.print()}>
      Imprimir o guardar como PDF
    </button>
  );
}
