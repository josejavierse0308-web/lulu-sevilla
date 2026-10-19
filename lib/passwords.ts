// Reglas de contraseña del panel (se valida igual en el servidor).
export function passwordProblems(p: string): string | null {
  if (p.length < 12) return 'Usa al menos 12 caracteres.';
  if (p.length > 128) return 'Usa como máximo 128 caracteres.';
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length;
  if (kinds < 3) return 'Combina al menos tres tipos: minúsculas, mayúsculas, números o símbolos.';
  return null;
}
