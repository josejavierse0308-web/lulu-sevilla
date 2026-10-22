/**
 * Se muestra al instante al tocar un enlace del panel mientras llega la
 * pantalla. Tiene la forma general de una página (título y bloques) para que
 * el cambio se sienta inmediato y no salte el contenido.
 */
export default function Cargando() {
  return (
    <div role="status" aria-live="polite" className="cargando">
      <span className="sr-only">Cargando…</span>
      <div aria-hidden className="mb-8">
        <div className="hueco h-4 w-28" />
        <div className="hueco mt-3 h-11 w-[min(70%,420px)] rounded-2xl" />
        <div className="hueco mt-3 h-4 w-48" />
      </div>
      <div aria-hidden className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-6">
          <div className="panel p-5 sm:p-7">
            <div className="hueco h-7 w-40 rounded-xl" />
            {[0, 1, 2].map((i) => (
              <div key={i} className="mt-5 flex items-center gap-4">
                <div className="hueco size-11 shrink-0 rounded-full" />
                <div className="flex-1">
                  <div className="hueco h-4 w-3/5" />
                  <div className="hueco mt-2 h-3 w-2/5" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="panel hidden p-5 sm:p-7 lg:block">
          <div className="hueco h-7 w-32 rounded-xl" />
          <div className="hueco mt-5 h-24 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
