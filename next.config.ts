import type { NextConfig } from 'next';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseOrigin = (() => {
  try {
    return new URL(supabaseUrl).origin;
  } catch {
    return '';
  }
})();

// Encabezados de seguridad comunes a todo el sitio.
const common = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

// La página pública conserva su CSS/JS en línea y sus fuentes de Google.
const cspPublic = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

// Panel y enlace de citas: el navegador solo habla con este sitio y, para
// subir documentos con URL firmada, con el almacenamiento de Supabase.
const cspApp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  `connect-src 'self'${supabaseOrigin ? ' ' + supabaseOrigin : ''}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    return {
      beforeFiles: [],
      // La página principal original se sirve tal cual desde /public.
      afterFiles: [{ source: '/', destination: '/inicio.html' }],
      fallback: [],
    };
  },
  async headers() {
    return [
      { source: '/:path*', headers: [...common, { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }] },
      { source: '/', headers: [{ key: 'Content-Security-Policy', value: cspPublic }] },
      { source: '/inicio.html', headers: [{ key: 'Content-Security-Policy', value: cspPublic }] },
      {
        source: '/admin/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: cspApp },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
      {
        // El token viaja en la ruta: nunca debe filtrarse en el Referer.
        source: '/cita/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: cspApp },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    ];
  },
};

export default nextConfig;
