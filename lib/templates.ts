// Plantillas de mensajes. Solo existen estas variables; ninguna permite
// insertar información clínica. La base de datos valida lo mismo.

export const TEMPLATE_VARS = ['nombre', 'fecha', 'hora', 'servicio', 'modalidad', 'lugar', 'enlace'] as const;
export type TemplateVar = (typeof TEMPLATE_VARS)[number];

export function templateIsValid(tpl: string): boolean {
  if (tpl.length > 1500) return false;
  for (const m of tpl.matchAll(/\{([^}]*)\}/g)) {
    if (!(TEMPLATE_VARS as readonly string[]).includes(m[1] ?? '')) return false;
  }
  return true;
}

export function renderTemplate(tpl: string, vars: Partial<Record<TemplateVar, string | null | undefined>>): string {
  return tpl
    .replace(/\{([a-z]+)\}/g, (_, k: string) => {
      const v = (vars as Record<string, string | null | undefined>)[k];
      return v == null ? '' : String(v);
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
}
