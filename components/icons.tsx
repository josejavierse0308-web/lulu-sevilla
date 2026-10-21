/** Íconos de trazo fino, del mismo estilo que la navegación del panel. */
const PATHS = {
  telefono: (
    <path d="M6.6 4.5h2.2l1.4 3.6-1.7 1.1a10.5 10.5 0 0 0 5.3 5.3l1.1-1.7 3.6 1.4v2.2a2 2 0 0 1-2.2 2A14.5 14.5 0 0 1 4.6 6.7a2 2 0 0 1 2-2.2Z" />
  ),
  mensaje: (
    <path d="M5 18.8 6 15.6A7.3 7.3 0 1 1 8.6 18l-3.6.8ZM9 10.5h6M9 13.5h3.5" />
  ),
  correo: <path d="M4.5 6.5h15v11h-15zM5 7l7 5.5L19 7" />,
  mas: <path d="M12 5.5v13M5.5 12h13" />,
  buscar: <path d="M10.8 17a6.2 6.2 0 1 0 0-12.4 6.2 6.2 0 0 0 0 12.4ZM15.3 15.3 19.5 19.5" />,
  menu: <path d="M5 8h14M5 12h14M5 16h9" />,
  filtros: <path d="M4.5 7h9M17.5 7h2M4.5 17h3M11.5 17h8M15.5 5v4M9.5 15v4" />,
  flecha: <path d="M9.5 6 15.5 12l-6 6" />,
  atras: <path d="M14.5 6 8.5 12l6 6" />,
  bitacora: <path d="M7 4.5h10A1.5 1.5 0 0 1 18.5 6v13l-3-2-3.5 2-3.5-2-3 2V6A1.5 1.5 0 0 1 7 4.5ZM9 9h6M9 12.5h4" />,
  salir: <path d="M14 5.5H7A1.5 1.5 0 0 0 5.5 7v10A1.5 1.5 0 0 0 7 18.5h7M11 12h8.5M16.5 9l3 3-3 3" />,
  agenda: <path d="M7 3.5v3M17 3.5v3M4.5 9.5h15M6 5.5h12A1.5 1.5 0 0 1 19.5 7v11A1.5 1.5 0 0 1 18 19.5H6A1.5 1.5 0 0 1 4.5 18V7A1.5 1.5 0 0 1 6 5.5Z" />,
  video:<path d="M4.5 7.5h10v9h-10zM14.5 10.5l5-3v9l-5-3" />,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = 'size-5' }: { name: IconName; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name]}
    </svg>
  );
}
