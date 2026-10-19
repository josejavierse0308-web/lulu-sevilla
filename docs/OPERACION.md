# Guía de operación

La primera parte es para el uso diario de Lulu. La segunda reúne los procedimientos técnicos (respaldos, derechos ARCO, incidentes), que hace quien administra Supabase.

---

## Parte 1 · Uso diario del panel

### Una solicitud nueva desde la página
1. Aparece en **Hoy → Por confirmar**, y en la Agenda con el color ocre.
2. Ábrela. Si la persona ya es paciente, elige su expediente; si no, deja **«Crear expediente nuevo»**.
3. Para sesiones en línea, escribe el enlace de la videollamada; para presenciales, la dirección.
4. Pulsa **Confirmar cita**. Si el paciente dejó correo, recibe la confirmación y, si los activaste, un recordatorio.
5. Si dejó solo teléfono, usa **«Confirmación por WhatsApp»**: abre WhatsApp con el mensaje ya escrito.

### Después de una sesión
1. En la cita, pulsa **Registrar como realizada**. Se genera el cargo con el precio del paciente o el del servicio.
2. Pulsa **Escribir nota de sesión**. La nota queda vinculada a esa sesión.
3. Registra el pago en **Expediente → Pagos**:
   - Si ya verificaste el dinero, márcalo **«Recibido y verificado»**.
   - Si aún no lo verificas (por ejemplo, una transferencia por revisar), márcalo **«Por confirmar»**. No cuenta como ingreso hasta que pulses **Confirmar recepción**.

### Corregir información
- **Registros clínicos:** «Editar» guarda la versión anterior en el historial. Si un registro se escribió en el expediente equivocado, **anúlalo** con el motivo. No se borra.
- **Pagos:** no se editan. Si hubo un error, **anula** el pago con el motivo y regístralo de nuevo.
- **Horario de una cita:** se cambia con **Reprogramar**, no editando la cita.

### Privacidad en el día a día
- **Modo discreto** (en el expediente) difumina las notas clínicas. Pasa el cursor para leerlas.
- La sesión se cierra sola tras 30 minutos sin actividad. Aun así, cierra sesión si el equipo es compartido.
- No escribas información clínica en el motivo de cancelación, en las notas de pago ni en las plantillas de mensajes.
- **Copia del expediente** (en el Resumen) genera una versión imprimible para atender una solicitud de acceso. La exportación queda en la bitácora.

---

## Parte 2 · Procedimientos técnicos

### Respaldos
**Automáticos.** El plan Pro de Supabase hace respaldos diarios: *Database → Backups*. Para poder restaurar a cualquier minuto, activa la recuperación a un punto en el tiempo (*Point in Time Recovery*).

**Copia propia cifrada (recomendada cada mes).** Necesitas PostgreSQL 16 (`pg_dump`) y `gpg`.
```bash
# Cadena de conexión: Supabase → Project Settings → Database → Connection string (URI)
export DATABASE_URL='postgresql://postgres:CONTRASEÑA@db.xxxx.supabase.co:5432/postgres'
bash scripts/respaldo.sh        # pide una frase de cifrado; crea respaldos/lulu-AAAAMMDD-HHMM.dump.gpg
```
Guarda el archivo cifrado y la frase **en lugares distintos**, nunca en el repositorio. La carpeta `respaldos/` ya está excluida en `.gitignore`.

Los **documentos** del bucket `expedientes` no van en el respaldo de la base. Para respaldarlos:
```bash
npx supabase storage cp -r ss:///expedientes ./respaldos/expedientes --experimental
```
Después comprime y cifra esa carpeta igual que el respaldo.

**Restaurar** (hazlo primero en un proyecto de prueba):
```bash
gpg -d respaldos/lulu-AAAAMMDD-HHMM.dump.gpg > /tmp/lulu.dump
pg_restore --no-owner --no-privileges -d "$DATABASE_URL_DESTINO" /tmp/lulu.dump && shred -u /tmp/lulu.dump
```
Haz una restauración de prueba al menos dos veces al año.

### Derechos ARCO (Ley Federal de Protección de Datos Personales)
1. Recibe la solicitud por el medio que indique el aviso de privacidad.
2. **Verifica la identidad** de quien la hace (o de su representante legal).
3. Responde dentro de **20 días hábiles**. Si procede, hazlo efectivo dentro de los 15 días hábiles siguientes.
4. Según el derecho:
   - **Acceso:** *Expediente → Resumen → Copia del expediente*. Imprime o guarda en PDF y entrégalo por un medio seguro.
   - **Rectificación:** *Editar datos*. Para registros clínicos, agrega un registro aclaratorio o edita; el historial conserva la versión anterior.
   - **Cancelación:** cambia el expediente a **Archivado**, que equivale al bloqueo. Al terminar el plazo de conservación, elimínalo con la *Depuración* (abajo).
   - **Oposición / revocación del consentimiento:** registra la revocación en *Resumen → Consentimientos*.
5. Guarda constancia de la solicitud y de tu respuesta, fuera del panel.

### Depuración de un expediente (solo al terminar el plazo de conservación)
Los registros clínicos deben conservarse al menos **5 años** desde el último acto registrado (NOM-004-SSA3-2012). Para depurar:
1. En el panel, elimina los **documentos** del expediente; así se borran también los archivos.
2. Cambia el estado del expediente a **Archivado**.
3. En *Supabase → SQL Editor* (rol `postgres`), ejecuta:
   ```sql
   select private.purge_patient(
     'UUID-DEL-PACIENTE',
     'LS-0007',                                    -- identificador interno, como confirmación
     'Solicitud ARCO de cancelación del 03/02/2032; plazo de conservación cumplido'
   );
   ```
   La función se niega a depurar si el expediente no está archivado, si quedan documentos o si el último registro tiene menos de 5 años. Al terminar deja una constancia en la bitácora **sin datos personales**.

### Bitácora: conservación
La bitácora no se puede borrar desde la aplicación. Si decides depurar registros muy antiguos, por ejemplo de más de 6 años, ejecuta en el editor SQL:
```sql
begin;
set local app.allow_audit_purge = 'on';
delete from public.audit_log where occurred_at < now() - interval '6 years';
commit;
```

### Incidentes
| Situación | Qué hacer |
|---|---|
| Lulu olvidó su contraseña | *Ingresar → ¿Olvidaste tu contraseña?* |
| Perdió el teléfono con la verificación en dos pasos | En el editor SQL: `delete from auth.mfa_factors where user_id = (select id from auth.users where email = 'CORREO');`. Después debe iniciar sesión y volver a activarla con el teléfono nuevo. |
| Sospecha de acceso indebido | 1) Cambia la contraseña y pulsa «Cerrar sesiones en otros dispositivos». 2) Revisa la **Bitácora**. 3) En Supabase, rota la clave `service_role` (*Project Settings → API*) y actualízala en Netlify. 4) Cambia `CRON_SECRET` y `CLIENT_KEY_SECRET`. 5) Si se vulneraron datos personales, informa a los pacientes afectados de forma inmediata, como exige la LFPDPPP. |
| Se filtró `MANAGE_LINK_SECRET` | Cámbialo en Netlify y vuelve a desplegar. Los enlaces ya enviados dejan de funcionar, así que avisa a los pacientes con citas próximas. |
| Los correos no llegan | Revisa en la cita la sección «Mensajes automáticos». Verifica `RESEND_API_KEY`, `EMAIL_FROM` y el dominio en Resend, y los registros de la función `notificaciones` en Netlify. |

### Mantenimiento
- **Cada mes:** respaldo propio cifrado y revisión rápida de la bitácora.
- **Cada 6 meses:** actualizar dependencias (`npm outdated`, `npm update`), correr las pruebas y desplegar. Restauración de prueba.
- **Al cambiar el aviso de privacidad:** publica una **nueva versión** desde el panel. Las anteriores se conservan con la constancia de quién aceptó cuál.
