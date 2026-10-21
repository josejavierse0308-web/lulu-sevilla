import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { cerrarSesion, cerrarSesionPorInactividad } from '../(acceso)/actions';
import { BottomNav, SideNav, type NavItem } from './nav';
import { IdleGuard } from './idle';
import { MobileMenu } from './menu-movil';
import { Toaster } from '@/components/toaster';

export const dynamic = 'force-dynamic';

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user } = await requireAdmin();
  const { count: pending } = await supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pendiente')
    .gt('starts_at', new Date().toISOString());

  const items: NavItem[] = [
    { href: '/admin', label: 'Hoy', icon: 'hoy' },
    { href: '/admin/agenda', label: 'Agenda', icon: 'agenda', count: pending ?? 0 },
    { href: '/admin/pacientes', label: 'Pacientes', icon: 'pacientes' },
    { href: '/admin/pagos', label: 'Pagos', icon: 'pagos' },
    { href: '/admin/configuracion', label: 'Configuración', icon: 'config' },
  ];
  const mobile = items.slice(0, 4).concat({ href: '/admin/configuracion', label: 'Ajustes', icon: 'config' });

  return (
    <div className="relative z-[2] min-h-svh md:grid md:grid-cols-[248px_1fr]">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-tinta focus:px-4 focus:py-2 focus:text-hueso"
      >
        Saltar al contenido
      </a>

      <aside className="no-print sticky top-0 hidden h-svh flex-col border-r border-linea px-4 py-6 md:flex">
        <Link href="/admin" className="mb-8 flex items-center gap-3 px-2">
          <span
            aria-hidden
            className="size-8 rounded-[46%_54%_52%_48%/50%_46%_54%_50%] bg-[radial-gradient(circle_at_36%_32%,#fff_0,#fcf5e7_28%,#e8dff4_68%,#cdc4e2_100%)] shadow-[0_0_16px_4px_rgb(255_248_232/0.8)]"
          />
          <span className="display text-[22px] italic">Lulu Sevilla</span>
        </Link>
        <nav aria-label="Panel">
          <SideNav items={items} />
          <div className="mt-2 border-t border-linea pt-2">
            <SideNav items={[{ href: '/admin/bitacora', label: 'Bitácora', icon: 'bitacora' }]} />
          </div>
        </nav>
        <div className="mt-auto px-2">
          <p className="truncate text-[13px] text-tenue" title={user.email ?? ''}>
            {user.email}
          </p>
          <form action={cerrarSesion}>
            <button type="submit" className="mt-1 min-h-10 text-[14px] text-tinta underline-offset-4 hover:underline">
              Cerrar sesión
            </button>
          </form>
        </div>
      </aside>

      <header className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-linea bg-hueso/85 py-1.5 pl-4 pr-2 pt-[max(6px,env(safe-area-inset-top))] backdrop-blur-md md:hidden">
        <Link href="/admin" className="flex min-h-11 items-center gap-2.5">
          <span
            aria-hidden
            className="size-6 rounded-[46%_54%_52%_48%/50%_46%_54%_50%] bg-[radial-gradient(circle_at_36%_32%,#fff_0,#fcf5e7_28%,#e8dff4_68%,#cdc4e2_100%)] shadow-[0_0_12px_3px_rgb(255_248_232/0.8)]"
          />
          <span className="display text-[21px] italic">Lulu Sevilla</span>
        </Link>
        <MobileMenu email={user.email ?? ''} logout={cerrarSesion} />
      </header>

      <main id="contenido" className="min-w-0 px-4 pb-44 pt-6 sm:px-8 md:px-12 md:pb-16 md:pt-12">
        <div className="mx-auto max-w-[1120px]">{children}</div>
      </main>

      <nav
        aria-label="Panel"
        className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-linea bg-hueso/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      >
        <BottomNav items={mobile} />
      </nav>

      <IdleGuard logout={cerrarSesionPorInactividad} />
      <Toaster />
    </div>
  );
}
