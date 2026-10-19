import 'server-only';

function required(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`Falta la variable de entorno ${name}. Revisa .env.example.`);
  }
  return v.trim();
}

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export const env = {
  get supabaseUrl() {
    return required('NEXT_PUBLIC_SUPABASE_URL');
  },
  get supabaseAnonKey() {
    return required('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  },
  get siteUrl() {
    return required('NEXT_PUBLIC_SITE_URL').replace(/\/+$/, '');
  },
  get manageLinkSecret() {
    const v = required('MANAGE_LINK_SECRET');
    if (v.length < 32) throw new Error('MANAGE_LINK_SECRET debe tener al menos 32 caracteres.');
    return v;
  },
  get clientKeySecret() {
    const v = required('CLIENT_KEY_SECRET');
    if (v.length < 32) throw new Error('CLIENT_KEY_SECRET debe tener al menos 32 caracteres.');
    return v;
  },
  /** Solo para el procesador de notificaciones. */
  get serviceRoleKey() {
    return required('SUPABASE_SERVICE_ROLE_KEY');
  },
  get cronSecret() {
    const v = required('CRON_SECRET');
    if (v.length < 24) throw new Error('CRON_SECRET debe tener al menos 24 caracteres.');
    return v;
  },
  get resendApiKey() {
    return optional('RESEND_API_KEY');
  },
  get emailFrom() {
    return optional('EMAIL_FROM');
  },
};
