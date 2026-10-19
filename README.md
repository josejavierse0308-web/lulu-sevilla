# Lulu Sevilla · Página y panel privado

La página de Lulu Sevilla, psicóloga, ampliada con:

- **Agenda tu sesión**: reservas reales dentro de la página original.
- Un **panel privado** (`/admin`) con agenda, expedientes, historial clínico, documentos, pagos y configuración.

La página original **se conserva intacta** en `public/inicio.html`, con sus 18 escenas interactivas. Solo se le agregó la escena «Agenda tu sesión». Además se conectaron el botón «Agendar una sesión», el aviso de privacidad y los datos profesionales que Lulu publique desde el panel.

> **Datos de desarrollo:** todo lo que hay en las pruebas es ficticio. Nunca importes expedientes reales a un entorno de pruebas.

---

## 1. Qué incluye

### Página pública
- **Agenda tu sesión.** El paciente elige servicio, día y hora libres según la disponibilidad real, y deja solo nombre, medio de contacto preferido y teléfono o correo. No se pide información clínica.
  - Lee el aviso de privacidad vigente y lo acepta. Queda registrada la versión aceptada, la fecha y si lo solicita su madre, padre o tutor.
  - Su solicitud queda *pendiente* hasta que Lulu la confirma. Recibe en pantalla, y por correo si lo dejó, un **enlace privado** para ver, reprogramar o cancelar dentro del plazo configurado.
  - Protecciones: candado contra reservas duplicadas (probado con 20 solicitudes simultáneas al mismo horario), límite de intentos por origen, límite de solicitudes pendientes por persona y campo trampa contra robots.
- El aviso de privacidad del pie de página muestra el texto real publicado desde el panel. Se corrigió además la frase «esta página no guarda nada», que ya no era cierta.
- Formación, cédula, enfoque, modalidad y presentación se rellenan con lo que Lulu publique. Si un campo está vacío, se conserva el marcador original. Nada se inventa.
- «Escríbeme» usa el WhatsApp o correo configurado.

### Panel privado (`/admin`)
| Sección | Qué permite |
|---|---|
| **Hoy** | Próxima sesión (con acceso a la videollamada), citas del día, solicitudes por confirmar, próximos 7 días, cambios recientes (cancelaciones y reprogramaciones), pacientes activos, pagos pendientes, ingresos por periodo y accesos rápidos. |
| **Agenda** | Vistas de día, semana y mes. Detalle de cita para confirmar (vinculando o creando el expediente), reprogramar (conserva el historial), cancelar, registrar sesión realizada o inasistencia, enlace o lugar de la sesión, mensajes de WhatsApp prellenados y estado de los correos automáticos. |
| **Pacientes** | Búsqueda por nombre o identificador (`LS-0001`) y filtros por estado, última sesión y próxima cita. **Expediente** con resumen, historial cronológico, registros clínicos, documentos, consentimientos y pagos. Modo discreto para difuminar las notas en pantalla y copia imprimible para solicitudes de acceso. |
| **Registros clínicos** | Notas de sesión, observaciones, objetivos (con estado) y evolución. Solo los escribe y valida Lulu. Cada edición guarda la versión anterior. No se borran: se anulan con motivo. |
| **Pagos** | Cargos automáticos al registrar una sesión realizada, cargos manuales, pagos totales y parciales, pagos «por confirmar» (no cuentan como ingreso) y anulaciones. Saldos por paciente, resumen por periodo y gráfica mensual. No procesa cobros ni guarda datos de tarjetas: la base de datos rechaza números de tarjeta. |
| **Configuración** | Apertura de la agenda en línea y sus reglas, servicios y precios, horario semanal con descansos, días no disponibles, perfil público y contacto, notificaciones y plantillas, aviso de privacidad y consentimiento versionados, y seguridad (verificación en dos pasos, contraseña, sesiones). |
| **Bitácora** | Quién consultó, exportó o modificó qué y cuándo. Registra solo los nombres de los campos, nunca el contenido clínico. |

---

## 2. Arquitectura

```
Navegador ──► Netlify (Next.js 16)
               ├─ /                  → public/inicio.html (página original) + /agenda-sesion.js
               ├─ /api/publico/*     → funciones públicas de la base (sin acceso a tablas)
               ├─ /cita/[token]      → enlace privado del paciente
               ├─ /admin/*           → panel (sesión de Supabase Auth verificada en el servidor)
               └─ /api/tareas/notificaciones ◄── función programada de Netlify (cada 10 min)
                          │
                          ▼
               Supabase: PostgreSQL + RLS · Auth · Storage privado
```

- **Next.js 16 + TypeScript + Tailwind CSS 4**, publicado en **Netlify**.
- **Supabase:** PostgreSQL, autenticación con verificación en dos pasos opcional y almacenamiento privado.
- **Resend** (opcional) para los correos.

### Seguridad, por capas
1. **Base de datos.** RLS activado en todas las tablas.
   - El rol anónimo no puede leer ni escribir **ninguna** tabla. Lo público pasa por funciones `SECURITY DEFINER` que validan todo y solo devuelven horarios libres.
   - Una sesión autenticada solo ve datos si es **la única cuenta** registrada en `admin_users`; un índice único impide una segunda cuenta.
   - Con la verificación en dos pasos activa, la base exige además una sesión verificada (`aal2`). Así, una contraseña robada no basta, ni siquiera llamando a la API directamente.
2. **Servidor.** Cada página y acción del panel verifica la sesión con Supabase Auth (`getUser`) antes de hacer nada. El proxy de Next solo hace una redirección optimista.
3. **Datos que nunca se guardan.**
   - **Enlace del paciente:** se guarda solo el *hash* SHA-256 del token, que se deriva con HMAC de un secreto del servidor.
   - **Origen de las solicitudes:** se guarda un HMAC de la IP, nunca la IP.
4. **Inmutabilidad.**
   - Registros clínicos, versiones, consentimientos, pagos, documentos legales publicados y bitácora no se pueden reescribir ni borrar desde la aplicación.
   - La única vía para eliminar un expediente es una función de depuración que solo ejecuta un operador de la base (ver `docs/OPERACION.md`).
5. **Navegador.**
   - **Encabezados:** CSP por zona, `X-Frame-Options: DENY`, HSTS, `noindex` y `no-store` en el panel, y `no-referrer` en el enlace del paciente.
   - **Sesión:** se cierra tras 30 minutos de inactividad.
   - **Fuentes del panel:** se sirven localmente, sin peticiones a Google.
6. **Secretos.** La clave `service_role` solo existe en el servidor y solo la usa el procesador de notificaciones. Se verificó que ningún secreto aparece en los archivos que se envían al navegador.

---

## 3. Estructura

```
app/
  admin/(acceso)/        ingresar, verificar (2 pasos), recuperar, restablecer
  admin/(panel)/         hoy, agenda, pacientes, pagos, configuracion, bitacora
  api/publico/           info, horarios, reservar
  api/tareas/            notificaciones (protegido con CRON_SECRET)
  auth/confirmar/        destino de los enlaces de correo de Supabase
  cita/[token]/          enlace privado del paciente
components/              formularios, interfaz y avisos
lib/                     autenticación, clientes de Supabase, tokens, formato, notificaciones
public/inicio.html       página original + escena «Agenda tu sesión»
public/agenda-sesion.js  lógica de la agenda pública (JavaScript sin dependencias)
netlify/functions/       función programada de notificaciones
supabase/migrations/     11 migraciones (esquema, RLS, funciones, storage, depuración)
supabase/tests/          pruebas de base de datos y de concurrencia
supabase/todo-en-uno.sql todas las migraciones en un archivo (para el editor SQL)
tests/                   pruebas unitarias (Vitest)
docs/OPERACION.md        guía de uso y procedimientos (respaldos, ARCO, depuración)
scripts/respaldo.sh      respaldo cifrado de la base
```

---

## 4. Variables de entorno

Configúralas en Netlify en *Site configuration → Environment variables*. Para desarrollo, cópialas a `.env.local` a partir de `.env.example`.

| Variable | Obligatoria | Dónde se usa | Descripción |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Sí | servidor | URL pública sin `/` final, ej. `https://lulusevilla.netlify.app`. Se usa en los enlaces de los correos. |
| `NEXT_PUBLIC_SUPABASE_URL` | Sí | servidor y navegador | *Project Settings → API → Project URL*. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Sí | servidor y navegador | Clave `anon` / *publishable*. Es pública por diseño. |
| `SUPABASE_SERVICE_ROLE_KEY` | Sí | **solo servidor** | Clave `service_role` / *secret*. Solo la usa el procesador de notificaciones. **Nunca** con prefijo `NEXT_PUBLIC_`. |
| `MANAGE_LINK_SECRET` | Sí | solo servidor | ≥ 32 caracteres aleatorios. Firma los enlaces de los pacientes. Si cambia, los enlaces enviados dejan de funcionar. |
| `CLIENT_KEY_SECRET` | Sí | solo servidor | ≥ 32 caracteres aleatorios, distinto del anterior. |
| `CRON_SECRET` | Sí | solo servidor y función programada | ≥ 24 caracteres. Protege `/api/tareas/notificaciones`. |
| `RESEND_API_KEY` | No | solo servidor | Sin ella no se envían correos. El paciente ve su confirmación en pantalla y Lulu puede avisar por WhatsApp. |
| `EMAIL_FROM` | Con Resend | solo servidor | Remitente verificado, ej. `Lulu Sevilla <citas@tudominio.mx>`. |

Para generar secretos:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

---

## 5. Puesta en marcha

### 5.1 Supabase
1. Crea un proyecto en <https://supabase.com>. Elige la región más cercana y una contraseña fuerte para la base. Para datos de salud se recomienda el **plan Pro**, por los respaldos diarios y la opción de recuperación a un punto en el tiempo.
2. **Migraciones.** Hay dos formas:
   - **Editor SQL:** abre *SQL Editor*, pega el contenido de `supabase/todo-en-uno.sql` y ejecútalo una sola vez.
   - **CLI:** `npx supabase login`, `npx supabase init` (si pregunta, conserva la carpeta `supabase/migrations`), `npx supabase link --project-ref <ref>` y luego `npx supabase db push`.
3. **Authentication → Sign In / Providers → Email:** desactiva **«Allow new users to sign up»**. Nadie más podrá crear cuentas.
4. **Authentication → URL Configuration:**
   - *Site URL:* tu `NEXT_PUBLIC_SITE_URL`.
   - *Redirect URLs:* `https://TU-SITIO/auth/confirmar`.
5. **Authentication → Emails → Reset password.** Para que el enlace funcione aunque se abra en otro dispositivo, cambia el enlace de la plantilla por:
   ```
   {{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&type=recovery&siguiente=/admin/restablecer
   ```
   Recomendado: en *Authentication → SMTP Settings* configura un SMTP propio (Resend ofrece uno), porque el SMTP de prueba de Supabase tiene un límite muy bajo de envíos.
6. **Crea la cuenta de Lulu.** En *Authentication → Users → Add user → Create new user*, usa su correo y una contraseña temporal y marca *Auto Confirm User*. Después, en el editor SQL:
   ```sql
   insert into public.admin_users (user_id)
   select id from auth.users where email = 'CORREO-DE-LULU';
   ```
   La base solo admite **una** cuenta administradora.
7. **Authentication → Multi-Factor:** confirma que TOTP esté habilitado. Lulu lo activa después desde *Configuración → Seguridad*.
8. El bucket privado `expedientes` lo crea la migración `1000`. Verifica en *Storage* que aparezca como **privado**.

### 5.2 Netlify
1. Sube este proyecto a un repositorio de GitHub. `.gitignore` ya excluye `.env*`.
2. En Netlify, *Add new site → Import an existing project* y elige el repositorio. Netlify detecta Next.js; `netlify.toml` ya define el build (`npm run build`), Node 22 y el adaptador `@netlify/plugin-nextjs`.
3. Agrega las variables de la sección 4 y despliega.
4. La función programada `netlify/functions/notificaciones.mts` se activa sola, cada 10 minutos según `netlify.toml`, y llama al endpoint protegido con `CRON_SECRET`.
5. Si el dominio anterior (`lulusevilla92.netlify.app`) es otro sitio de Netlify, apunta el dominio definitivo al nuevo sitio y actualiza `NEXT_PUBLIC_SITE_URL` y las URLs de Supabase.

### 5.3 Correo (opcional)
1. Crea una cuenta en <https://resend.com>.
2. Verifica tu dominio en Resend, con los registros DNS que indica.
3. Crea una API key y ponla en `RESEND_API_KEY` y `EMAIL_FROM`.

### 5.4 Primer uso, en el panel
Sigue este orden en *Configuración*:

1. Publica el **aviso de privacidad** (y, si lo usas, el consentimiento informado).
2. Crea tus **servicios** con su duración, margen y precio.
3. Define tu **horario de atención**.
4. Llena tu **perfil público y contacto**.
5. En *Agenda en línea*, activa **«Aceptar solicitudes»**. No se puede activar sin aviso, servicio y horario.
6. Recomendado: activa la **verificación en dos pasos**.

### 5.5 Comprobaciones después de publicar
Haz estas pruebas una vez con datos ficticios y luego bórralos desde el panel. Son las partes que en este entorno no se pudieron probar contra los servicios reales de la nube (ver sección 7).
- [ ] Haz una reserva desde la página y confírmala desde el panel.
- [ ] Recibes el aviso de nueva solicitud y el paciente recibe el acuse (si configuraste Resend).
- [ ] Sube un PDF a un expediente de prueba, descárgalo y elimínalo.
- [ ] Recupera la contraseña desde *¿Olvidaste tu contraseña?*.

---

## 6. Migraciones

| Archivo | Contenido |
|---|---|
| `0100_base` | Esquema `private`, tipos, utilidades (validación de correo y teléfono, detección de tarjetas), cuenta administradora única, `is_admin()` con verificación en dos pasos. |
| `0200_configuracion` | Ajustes, plantillas validadas, servicios, horario semanal, días no disponibles, documentos legales versionados e inmutables. |
| `0300_pacientes_citas` | Pacientes (identificador `LS-0001`), citas con **restricción de exclusión** contra empalmes, transiciones de estado válidas. |
| `0400_expediente` | Registros clínicos con historial de versiones, anulación sin borrado, consentimientos, documentos. |
| `0500_pagos` | Cargos, pagos, cargo automático al completar una sesión, vistas de saldos y resumen financiero. |
| `0600_auditoria` | Bitácora de solo escritura (nombres de campos, sin contenido) y registro de consultas. |
| `0700_notificaciones` | Cola de mensajes, recordatorios y límites de uso. |
| `0800_reservas` | Disponibilidad, solicitud pública, enlace privado (ver, cancelar, reprogramar), funciones del panel. |
| `0900_permisos_rls` | Retiro de privilegios por defecto, RLS y permisos mínimos por tabla y función. |
| `1000_storage` | Bucket privado `expedientes` y sus políticas. |
| `1100_depuracion` | Depuración controlada de un expediente (solo operador de la base). |

---

## 7. Pruebas realizadas

Todas con datos ficticios.

| Prueba | Resultado |
|---|---|
| **Base de datos** (`supabase/tests/10_pruebas.sql`, PostgreSQL 16 con roles de Supabase simulados) | **130 comprobaciones**. Incluyen: el rol anónimo no lee ninguna tabla; una sesión ajena ve 0 filas y no puede escribir; la verificación en dos pasos se exige en la base; no hay reservas encimadas; límites de intentos; plazos de cambio; transiciones de estado; cargo automático; pagos parciales, por confirmar y anulados; rechazo de números de tarjeta; historial de versiones; bitácora sin contenido clínico; documentos legales inmutables; plantillas restringidas; depuración controlada. |
| **Concurrencia** (`concurrencia.sh`) | 20 conexiones simultáneas reservan el mismo horario: **1 aceptada, 19 rechazadas**. |
| **Extremo a extremo** con Chrome real contra el build de producción, servidor oficial de autenticación de Supabase (GoTrue v2.180) y PostgREST v12 | **51 comprobaciones**, 0 fallos. Cubren: inicio y cierre de sesión; reserva completa en escritorio y celular; enlace privado (reprogramar y cancelar); confirmación que crea el expediente; sesión realizada con su cargo; nota clínica y su edición con historial; pagos parciales y por confirmar; configuración; activación, uso y desactivación de la verificación en dos pasos con códigos TOTP reales. |
| **API como atacante** | Con la clave pública y con una sesión válida de otra cuenta: todos los intentos de leer, escribir, ejecutar funciones del panel, borrar la bitácora o volverse administrador fueron bloqueados. El registro público está desactivado. |
| **Página original** | Las 19 escenas siguen presentes, la respiración guiada funciona, el menú y los botones llevan a la agenda y no hay desbordamiento en celular. |
| **Accesibilidad** (axe-core, WCAG 2.1 AA) | 0 problemas graves en 14 pantallas del panel, el acceso, el enlace del paciente y la agenda pública. |
| **Unitarias** (Vitest) | 12 pruebas: plantillas, zona horaria, montos, tokens, mensajes y contraseñas. |
| **Correos** | Probados contra un servidor que simula Resend. El paciente recibe su acuse con el enlace privado; el aviso para Lulu no incluye datos del paciente. |

**No se pudo probar aquí y conviene verificar tras publicar** (lista en 5.5):
- La subida y descarga de documentos contra Supabase Storage. El código usa la API oficial de URLs firmadas, pero no hay servidor de Storage local.
- El envío real con Resend.
- El despliegue en Netlify.

Para correr las pruebas de base de datos:
```bash
npm run test:db   # necesita PostgreSQL 16 local en el puerto 54322
npm test          # pruebas unitarias
```

---

## 8. Lo que queda por decidir o redactar (lo hace Lulu)

- **Textos legales:** aviso de privacidad y, si aplica, consentimiento informado. Lo ideal es revisarlos con asesoría legal. El panel indica qué debe contener según la LFPDPPP.
- **Datos profesionales reales:** formación, cédula, enfoque, modalidad y presentación. Se publican desde el panel.
- **Fotografía y testimonios.** Siguen como marcadores en `public/inicio.html`, sin inventar. Para la foto, reemplaza el contenido de `.photo` como indica el comentario del HTML.
- **Políticas** de cancelación y reprogramación, **precios** y si se muestran en la página.

### Posibles mejoras futuras
- Mensajes automáticos por WhatsApp (requiere un proveedor como la API de WhatsApp Business). Hoy el panel prepara el mensaje y Lulu lo envía con un clic.
- Cobro en línea con un proveedor de pagos certificado.
