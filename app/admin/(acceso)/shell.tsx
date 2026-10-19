import Link from 'next/link';

/** Composición de las pantallas de acceso: la esfera de luz de la página, en calma. */
export function AuthShell({ title, children, footer }: { title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main className="relative isolate grid min-h-svh place-items-center overflow-hidden px-5 py-14">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-[20vmax] top-[-10vmax] size-[70vmax] rounded-full bg-[radial-gradient(circle,rgb(205_197_228/0.7),rgb(205_197_228/0)_62%)]" />
        <div className="absolute -right-[25vmax] bottom-[-20vmax] size-[70vmax] rounded-full bg-[radial-gradient(circle,rgb(186_204_182/0.5),rgb(186_204_182/0)_62%)]" />
      </div>
      <div className="aparecer w-full max-w-[420px]">
        <div className="mb-10 flex items-center gap-4">
          <span
            aria-hidden
            className="size-12 rounded-[46%_54%_52%_48%/50%_46%_54%_50%] bg-[radial-gradient(circle_at_36%_32%,#fff_0,#fcf5e7_28%,#e8dff4_68%,#cdc4e2_100%)] shadow-[0_0_24px_6px_rgb(255_248_232/0.8),0_0_60px_20px_rgb(214_204_238/0.45)]"
          />
          <div>
            <p className="display text-[26px] italic leading-none">Lulu Sevilla</p>
            <p className="mt-1 text-[14px] text-tenue">Panel privado</p>
          </div>
        </div>
        <h1 className="display mb-6 text-[40px]">{title}</h1>
        {children}
        {footer && <div className="mt-8 text-[14px] text-tenue">{footer}</div>}
        <p className="mt-12 text-[13px] text-tenue">
          <Link href="/" className="hover:text-tinta">
            ← Volver a la página
          </Link>
        </p>
      </div>
    </main>
  );
}
