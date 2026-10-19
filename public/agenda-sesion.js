/* ============================================================================
   Agenda tu sesión · Lulu Sevilla
   Reservas reales: los horarios vienen de la agenda de Lulu y la solicitud se
   guarda en la base de datos. Solo se piden los datos mínimos para gestionar
   la cita; nunca información clínica.
   ========================================================================== */
(() => {
  'use strict';
  const root = document.getElementById('agApp');
  if (!root) return;

  const PAGE_DAYS = 14;
  const state = {
    info: null,
    tz: 'America/Mexico_City',
    service: null,
    page: 0,
    slots: new Map(), // "YYYY-MM-DD" -> [iso]
    loaded: new Set(), // páginas cargadas
    day: null,
    time: null,
    contact: 'whatsapp',
    sending: false,
  };

  // ---------- utilidades ----------
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  };
  const fmt = (d, o) => new Intl.DateTimeFormat('es-MX', { timeZone: state.tz, ...o }).format(new Date(d));
  const dayKey = (d) => {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: state.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
    return p; // en-CA da "YYYY-MM-DD"
  };
  const addDays = (key, n) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  };
  const keyToNoon = (key) => new Date(key + 'T18:00:00Z'); // mediodía en México: seguro para formatear el día
  const money = (c) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(c / 100);
  const modality = (m) => (m === 'presencial' ? 'Presencial' : 'En línea');
  const today = () => dayKey(Date.now());
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

  async function api(url, opts) {
    const res = await fetch(url, { headers: { 'content-type': 'application/json' }, credentials: 'same-origin', ...opts });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* sin cuerpo */
    }
    if (!res.ok) {
      const err = new Error((data && data.message) || 'No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.');
      err.code = data && data.error;
      err.field = data && data.field;
      throw err;
    }
    return data;
  }

  // ---------- carga inicial ----------
  async function init() {
    root.replaceChildren(h('p', { class: 'hint', text: 'Cargando horarios disponibles…' }));
    try {
      state.info = await api('/api/publico/info');
    } catch {
      return renderError('No pudimos cargar la agenda. Revisa tu conexión.', init);
    }
    state.tz = state.info.timezone || state.tz;
    enhancePage(state.info);
    if (!state.info.booking_open || !state.info.privacy || !state.info.services.length) return renderClosed();
    state.service = state.info.services.length === 1 ? state.info.services[0] : null;
    render();
    if (state.service) loadPage(0, true);
  }

  async function loadPage(page, autoPick) {
    if (!state.service) return;
    const start = addDays(today(), page * PAGE_DAYS);
    const end = addDays(start, PAGE_DAYS - 1);
    const key = state.service.id + ':' + page;
    if (!state.loaded.has(key)) {
      setDaysBusy(true);
      try {
        const r = await api(`/api/publico/horarios?servicio=${encodeURIComponent(state.service.id)}&desde=${start}&hasta=${end}`);
        for (let i = 0; i < PAGE_DAYS; i++) state.slots.set(addDays(start, i), []);
        for (const iso of r.slots) state.slots.get(dayKey(iso))?.push(iso);
        state.loaded.add(key);
      } catch (e) {
        setDaysBusy(false);
        if (e.code === 'reservas_cerradas') return renderClosed();
        return showError(e.message);
      }
      setDaysBusy(false);
    }
    if (autoPick && !state.day) {
      const first = [...Array(PAGE_DAYS)].map((_, i) => addDays(start, i)).find((k) => (state.slots.get(k) || []).length);
      if (first) state.day = first;
      else if (page < maxPage()) {
        state.page = page + 1;
        return loadPage(page + 1, true);
      }
    }
    render();
  }

  const maxPage = () => Math.max(0, Math.floor((state.info?.max_days_ahead ?? 45) / PAGE_DAYS));

  // ---------- render ----------
  function render() {
    const s = state;
    // Conserva lo escrito y el foco del teclado entre renderizados.
    const prev = root.querySelector('form');
    if (prev && prev.elements.namedItem('nombre')) s.draft = readDraft();
    const a = document.activeElement;
    const focusKey = a && root.contains(a) ? (a.id ? '#' + a.id : a.name ? `[name="${a.name}"]${a.type === 'radio' ? `[value="${CSS.escape(a.value)}"]` : ''}` : a.getAttribute('aria-label') ? `[aria-label="${CSS.escape(a.getAttribute('aria-label'))}"]` : null) : null;
    const form = h('form', { class: 'ag-form', novalidate: true, onsubmit: submit });

    // 1 · Tipo de sesión
    form.append(
      h(
        'fieldset',
        { class: 'ag-step' },
        h('legend', {}, h('span', { class: 'ag-n', 'aria-hidden': 'true', text: '1' }), '¿Qué tipo de sesión?'),
        h(
          'div',
          { class: 'ag-services' },
          s.info.services.map((sv) =>
            h(
              'label',
              { class: 'ag-service' + (s.service?.id === sv.id ? ' on' : '') },
              h('input', {
                type: 'radio',
                name: 'servicio',
                value: sv.id,
                checked: s.service?.id === sv.id,
                onchange: () => {
                  s.service = sv;
                  s.day = null;
                  s.time = null;
                  s.page = 0;
                  s.slots.clear();
                  render();
                  loadPage(0, true);
                },
              }),
              h('span', { class: 'ag-sv-name', text: sv.name }),
              h('span', { class: 'ag-sv-meta', text: `${modality(sv.modality)} · ${sv.duration_min} min${sv.price_cents != null ? ' · ' + money(sv.price_cents) : ''}` }),
              sv.description ? h('span', { class: 'ag-sv-desc', text: sv.description }) : null,
            ),
          ),
        ),
      ),
    );

    // 2 · Día
    if (s.service) {
      const start = addDays(today(), s.page * PAGE_DAYS);
      const days = [...Array(PAGE_DAYS)].map((_, i) => addDays(start, i));
      const loaded = s.loaded.has(s.service.id + ':' + s.page);
      const anyInPage = days.some((k) => (s.slots.get(k) || []).length);
      form.append(
        h(
          'fieldset',
          { class: 'ag-step' },
          h('legend', {}, h('span', { class: 'ag-n', 'aria-hidden': 'true', text: '2' }), '¿Qué día?'),
          h(
            'div',
            { class: 'ag-days-nav' },
            h('span', { class: 'ag-month', text: cap(fmt(keyToNoon(days[0]), { month: 'long', year: 'numeric' })) }),
            h(
              'span',
              { class: 'ag-arrows' },
              h('button', { type: 'button', class: 'ghost', 'aria-label': 'Días anteriores', disabled: s.page === 0, onclick: () => ((s.page -= 1), render(), loadPage(s.page)) }, '←'),
              h('button', { type: 'button', class: 'ghost', 'aria-label': 'Días siguientes', disabled: s.page >= maxPage(), onclick: () => ((s.page += 1), render(), loadPage(s.page)) }, '→'),
            ),
          ),
          h(
            'div',
            { class: 'ag-days', id: 'agDays', role: 'group', 'aria-label': 'Días', 'aria-busy': !loaded },
            days.map((k) => {
              const n = (s.slots.get(k) || []).length;
              const on = s.day === k;
              return h(
                'button',
                {
                  type: 'button',
                  class: 'ag-day' + (on ? ' on' : ''),
                  'aria-pressed': on ? 'true' : 'false',
                  disabled: !loaded || !n,
                  'aria-label': `${fmt(keyToNoon(k), { weekday: 'long', day: 'numeric', month: 'long' })}${n ? `, ${n} horarios` : ', sin horarios'}`,
                  onclick: () => {
                    s.day = k;
                    s.time = null;
                    render();
                    document.getElementById('agTimes')?.querySelector('input')?.focus();
                  },
                },
                h('span', { class: 'ag-wd', text: fmt(keyToNoon(k), { weekday: 'short' }).replace('.', '') }),
                h('span', { class: 'ag-dn', text: fmt(keyToNoon(k), { day: 'numeric' }) }),
              );
            }),
          ),
          loaded && !anyInPage ? h('p', { class: 'hint ag-note', text: 'No hay horarios libres en estos días. Prueba con los siguientes.' }) : null,
        ),
      );
    }

    // 3 · Hora
    if (s.service && s.day) {
      const times = s.slots.get(s.day) || [];
      form.append(
        h(
          'fieldset',
          { class: 'ag-step' },
          h('legend', {}, h('span', { class: 'ag-n', 'aria-hidden': 'true', text: '3' }), '¿A qué hora?'),
          h('p', { class: 'hint ag-note', text: fmt(keyToNoon(s.day), { weekday: 'long', day: 'numeric', month: 'long' }) + tzNote() }),
          h(
            'div',
            { class: 'ag-times', id: 'agTimes' },
            times.map((iso) =>
              h(
                'label',
                { class: 'ag-time' + (s.time === iso ? ' on' : '') },
                h('input', { type: 'radio', name: 'hora', value: iso, checked: s.time === iso, onchange: () => ((s.time = iso), render(), document.getElementById('agNombre')?.focus()) }),
                fmt(iso, { hour: '2-digit', minute: '2-digit', hour12: false }),
              ),
            ),
          ),
        ),
      );
    }

    // 4 · Datos
    if (s.time) {
      const c = s.contact;
      form.append(
        h(
          'fieldset',
          { class: 'ag-step' },
          h('legend', {}, h('span', { class: 'ag-n', 'aria-hidden': 'true', text: '4' }), 'Tus datos'),
          h('p', { class: 'hint ag-note', text: 'Solo lo necesario para confirmar tu cita. Aquí no se pide información sobre lo que te trae a consulta.' }),
          field('agNombre', 'Tu nombre', h('input', { id: 'agNombre', name: 'nombre', autocomplete: 'name', required: true, maxlength: '120', value: s.draft?.nombre ?? '' })),
          h(
            'div',
            { class: 'ag-field' },
            h('span', { class: 'ag-label', id: 'agPrefL', text: '¿Cómo prefieres que te contacten?' }),
            h(
              'div',
              { class: 'ag-seg', role: 'radiogroup', 'aria-labelledby': 'agPrefL' },
              [
                ['whatsapp', 'WhatsApp'],
                ['telefono', 'Llamada'],
                ['correo', 'Correo'],
              ].map(([v, l]) =>
                h(
                  'label',
                  { class: 'ag-time' + (c === v ? ' on' : '') },
                  h('input', { type: 'radio', name: 'contacto', value: v, checked: c === v, onchange: () => ((s.contact = v), render()) }),
                  l,
                ),
              ),
            ),
          ),
          field(
            'agTel',
            c === 'correo' ? 'Teléfono (opcional)' : 'Teléfono',
            h('input', { id: 'agTel', name: 'telefono', type: 'tel', autocomplete: 'tel', inputmode: 'tel', maxlength: '20', required: c !== 'correo', value: s.draft?.telefono ?? '' }),
          ),
          field(
            'agMail',
            c === 'correo' ? 'Correo' : 'Correo (opcional)',
            h('input', { id: 'agMail', name: 'correo', type: 'email', autocomplete: 'email', maxlength: '254', required: c === 'correo', value: s.draft?.correo ?? '' }),
            c === 'correo' ? null : 'Si lo escribes, te llega la confirmación y un enlace para cambiar o cancelar.',
          ),
          h(
            'label',
            { class: 'ag-check' },
            h('input', { type: 'checkbox', name: 'acepta', id: 'agAcepta', required: true, checked: !!s.draft?.acepta }),
            h(
              'span',
              {},
              'Leí el ',
              h('button', { type: 'button', class: 'ag-link', onclick: openPrivacy, text: 'aviso de privacidad' }),
              ' y acepto que mis datos se usen para gestionar mi cita.',
            ),
          ),
          h(
            'label',
            { class: 'ag-check' },
            h('input', { type: 'checkbox', name: 'menor', checked: !!s.draft?.menor }),
            h('span', { text: 'La sesión es para una persona menor de edad y la solicito como su madre, padre o tutor.' }),
          ),
          // Campo trampa para robots: no lo verás.
          h('div', { class: 'ag-hp', 'aria-hidden': 'true' }, h('label', {}, 'Sitio web', h('input', { name: 'sitio', tabindex: '-1', autocomplete: 'off' }))),
        ),
      );
      form.append(
        h(
          'div',
          { class: 'ag-summary' },
          h(
            'p',
            { class: 'note' },
            `${s.service.name} · ${fmt(s.time, { weekday: 'long', day: 'numeric', month: 'long' })}, ${fmt(s.time, { hour: '2-digit', minute: '2-digit', hour12: false })}`,
          ),
          h('div', { class: 'ag-err', id: 'agErr', role: 'alert' }),
          h('button', { type: 'submit', class: 'pill solid', id: 'agSend', disabled: s.sending }, s.sending ? 'Enviando…' : 'Solicitar mi cita'),
          h('p', { class: 'hint', text: 'Tu cita queda pendiente hasta que Lulu la confirme.' }),
        ),
      );
    }

    root.replaceChildren(form);
    if (focusKey) {
      try {
        root.querySelector(focusKey)?.focus({ preventScroll: true });
      } catch {
        /* selector inválido: se ignora */
      }
    }
  }

  function field(id, label, input, help) {
    const helpId = help ? id + 'H' : null;
    if (helpId) input.setAttribute('aria-describedby', helpId);
    return h('div', { class: 'ag-field' }, h('label', { class: 'ag-label', for: id, text: label }), input, help ? h('p', { class: 'hint', id: helpId, text: help }) : null);
  }

  function tzNote() {
    try {
      const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (local && local !== state.tz) return ' · horario del centro de México';
    } catch {
      /* nada */
    }
    return '';
  }

  function readDraft() {
    const f = root.querySelector('form');
    if (!f) return {};
    const d = new FormData(f);
    return { nombre: d.get('nombre') || '', telefono: d.get('telefono') || '', correo: d.get('correo') || '', acepta: !!d.get('acepta'), menor: !!d.get('menor') };
  }

  function setDaysBusy(b) {
    const el = document.getElementById('agDays');
    if (el) el.setAttribute('aria-busy', b ? 'true' : 'false');
  }

  function showError(msg, fieldName) {
    const el = document.getElementById('agErr');
    if (el) {
      el.textContent = msg;
    } else {
      root.prepend(h('p', { class: 'ag-err', role: 'alert', text: msg }));
    }
    const map = { nombre: 'agNombre', telefono: 'agTel', correo: 'agMail', acepta: 'agAcepta' };
    const target = fieldName && document.getElementById(map[fieldName]);
    root.querySelectorAll('[aria-invalid]').forEach((n) => n.removeAttribute('aria-invalid'));
    if (target) {
      target.setAttribute('aria-invalid', 'true');
      target.focus();
    }
  }

  async function submit(e) {
    e.preventDefault();
    if (state.sending) return;
    const f = e.currentTarget;
    const d = new FormData(f);
    const nombre = String(d.get('nombre') || '').trim();
    const telefono = String(d.get('telefono') || '').trim();
    const correo = String(d.get('correo') || '').trim();
    if (nombre.length < 2) return showError('Escribe tu nombre.', 'nombre');
    if (state.contact !== 'correo' && !telefono) return showError('Escribe tu número para que te puedan contactar.', 'telefono');
    if (state.contact === 'correo' && !correo) return showError('Escribe tu correo para que te puedan contactar.', 'correo');
    if (correo && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(correo)) return showError('Revisa tu correo; parece incompleto.', 'correo');
    if (!d.get('acepta')) return showError('Para continuar, lee y acepta el aviso de privacidad.', 'acepta');

    state.draft = readDraft();
    state.sending = true;
    const btn = document.getElementById('agSend');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Enviando…';
    }
    try {
      const r = await api('/api/publico/reservar', {
        method: 'POST',
        body: JSON.stringify({
          servicio: state.service.id,
          inicio: state.time,
          nombre,
          correo,
          telefono,
          contacto: state.contact,
          aviso: state.info.privacy.id,
          acepta: true,
          menor: !!d.get('menor'),
          sitio: String(d.get('sitio') || ''),
        }),
      });
      state.sending = false;
      renderDone(r);
    } catch (err) {
      state.sending = false;
      if (err.code === 'horario_no_disponible') {
        // Alguien más lo tomó: recargamos el día y pedimos elegir otro.
        state.loaded.delete(state.service.id + ':' + state.page);
        state.time = null;
        await loadPage(state.page);
        return showError(err.message);
      }
      if (err.code === 'aviso_desactualizado') {
        state.info = await api('/api/publico/info').catch(() => state.info);
        enhancePage(state.info);
      }
      render();
      showError(err.message, err.field);
    }
  }

  function renderDone(r) {
    const when = `${fmt(r.cita.inicio, { weekday: 'long', day: 'numeric', month: 'long' })}, ${fmt(r.cita.inicio, { hour: '2-digit', minute: '2-digit', hour12: false })}`;
    const medio = { whatsapp: 'WhatsApp', telefono: 'teléfono', correo: 'correo' }[state.contact];
    const linkInput = h('input', { class: 'ag-copy-in', readonly: true, value: r.enlace, 'aria-label': 'Enlace privado de tu cita', onfocus: (e) => e.target.select() });
    const copyBtn = h('button', {
      type: 'button',
      class: 'ghost',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(r.enlace);
          copyBtn.textContent = 'Copiado';
        } catch {
          linkInput.select();
        }
      },
      text: 'Copiar enlace',
    });
    const done = h(
      'div',
      { class: 'ag-done', tabindex: '-1' },
      h('span', { class: 'ag-orb', 'aria-hidden': 'true' }),
      h('p', { class: 'mid', text: 'Tu solicitud quedó registrada.' }),
      h('p', { class: 'note ag-when', text: when }),
      h('p', { class: 'lead', text: `Lulu la revisará y te confirmará por ${medio}. Mientras tanto, el horario queda apartado para ti.` }),
      h('div', { class: 'ag-copy' }, h('p', { class: 'hint', text: 'Guarda este enlace privado: con él puedes revisar, cambiar o cancelar tu solicitud.' }), h('div', { class: 'ag-copy-row' }, linkInput, copyBtn)),
      h(
        'button',
        {
          type: 'button',
          class: 'ghost',
          onclick: () => {
            Object.assign(state, { day: null, time: null, draft: null, page: 0 });
            state.loaded.clear();
            state.slots.clear();
            render();
            loadPage(0, true);
          },
        },
        'Solicitar otra cita',
      ),
    );
    root.replaceChildren(done);
    done.focus({ preventScroll: false });
  }

  function renderClosed() {
    const c = state.info?.contact || {};
    const kids = [h('p', { class: 'mid', text: 'La agenda en línea abrirá pronto.' })];
    if (c.whatsapp) {
      kids.push(h('p', { class: 'lead', text: 'Mientras tanto, puedes escribir directamente para agendar.' }));
      kids.push(h('a', { class: 'pill solid', href: `https://wa.me/${c.whatsapp}?text=${encodeURIComponent('Hola Lulu, me gustaría agendar una sesión.')}`, target: '_blank', rel: 'noopener' }, 'Escribir por WhatsApp'));
    } else if (c.email) {
      kids.push(h('a', { class: 'pill solid', href: `mailto:${c.email}` }, 'Escribir un correo'));
    }
    root.replaceChildren(h('div', { class: 'ag-done' }, kids));
  }

  function renderError(msg, retry) {
    root.replaceChildren(h('div', { class: 'ag-done' }, h('p', { class: 'lead', text: msg }), h('button', { type: 'button', class: 'ghost', onclick: retry }, 'Reintentar')));
  }

  // ---------- aviso de privacidad y datos públicos de la página ----------
  function openPrivacy() {
    const d = document.getElementById('privacy');
    if (d && d.showModal) d.showModal();
    else if (d) d.setAttribute('open', '');
  }

  function enhancePage(info) {
    // Aviso de privacidad vigente
    const dlg = document.getElementById('privacy');
    const slot = document.getElementById('privacyBody');
    if (dlg && slot && info.privacy) {
      const t = dlg.querySelector('h2');
      if (t) t.textContent = info.privacy.title;
      slot.replaceChildren(
        ...info.privacy.body.split(/\n{2,}/).map((p) => h('p', { text: p.trim() })),
        h('p', { class: 'hint', text: `Versión ${info.privacy.version} · publicada el ${fmt(info.privacy.published_at, { day: 'numeric', month: 'long', year: 'numeric' })}` }),
      );
    }
    // Datos profesionales que Lulu decidió publicar (si no, quedan los marcadores)
    const p = info.profile || {};
    const set = (sel, v) => {
      const el = document.querySelector(sel);
      if (el && v) {
        el.textContent = v;
        el.classList.remove('ph');
      }
    };
    set('[data-public="intro"]', p.intro);
    set('[data-public="education"]', p.education);
    set('[data-public="license"]', p.license);
    set('[data-public="approach"]', p.approach);
    set('[data-public="modality"]', p.modality);
    // Contacto: "Escríbeme" abre WhatsApp o correo; si no hay ninguno, se oculta.
    const w = document.getElementById('cWrite');
    const c = info.contact || {};
    if (w) {
      if (c.whatsapp) w.href = `https://wa.me/${c.whatsapp}?text=${encodeURIComponent('Hola Lulu, me gustaría escribirte.')}`;
      else if (c.email) {
        w.href = `mailto:${c.email}`;
        w.removeAttribute('target');
      } else w.hidden = true;
    }
  }

  // Carga perezosa: solo cuando la sección se acerca a la vista.
  const section = document.getElementById('agenda');
  let started = false;
  const go = () => {
    if (!started) {
      started = true;
      init();
    }
  };
  if ('IntersectionObserver' in window && section) {
    new IntersectionObserver((es) => es.some((x) => x.isIntersecting) && go(), { rootMargin: '600px 0px' }).observe(section);
  } else go();
  // El aviso de privacidad debe estar completo aunque nunca se baje hasta la agenda.
  document.querySelectorAll('[data-privacy]').forEach((b) => b.addEventListener('click', () => !started && fetch('/api/publico/info').then((r) => r.json()).then(enhancePage).catch(() => {}), { once: true }));
  if (location.hash === '#agenda') go();
})();
