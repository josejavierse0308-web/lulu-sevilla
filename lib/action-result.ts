export type ActionResult = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  redirectTo?: string;
  resetForm?: boolean;
  /** La acción ya devolvió la pantalla actualizada; no hace falta refrescar. */
  revalidated?: boolean;
} | null;

export type FormAction = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

export const ok = (message?: string, extra: Partial<NonNullable<ActionResult>> = {}): ActionResult => ({ ok: true, message, ...extra });
export const fail = (message: string, fieldErrors?: Record<string, string>): ActionResult => ({ ok: false, message, fieldErrors });
