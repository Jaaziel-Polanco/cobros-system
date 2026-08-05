# Diseño — Módulo de Tickets / Boletería

**Fecha:** 2026-07-29
**Estado:** Aprobado para planificación
**Sistema:** cobros-system (Inversiones Cordero)

---

## 1. Objetivo

Añadir un módulo de boletería que emite boletos de sorteo a los clientes cuando pagan,
los entrega por WhatsApp o impresos en una impresora POS de la sucursal, y permite
seleccionar ganadores de forma aleatoria, auditable y reproducible sobre un rango de fechas.

**Restricción central:** la base de datos **nunca almacena el PDF**. El ticket guarda un
*snapshot* de los datos que aparecieron impresos, y el PDF se regenera al vuelo desde ese
snapshot cada vez que se necesita.

---

## 2. Decisiones tomadas

| # | Decisión |
|---|---|
| A1 | El ticket es **solo un boleto de rifa**: un número de participación. No muestra montos ni detalle de deuda. |
| A2 | **1 ticket fijo por pago**, más tickets manuales adicionales con motivo obligatorio. |
| A3 | Numeración **correlativa legible** (`PREFIJO-000123`). No requiere ser impredecible. |
| B1 | Existe la entidad **`sorteos`** (nombre, premio, rango, estado, prefijo, correlativo). |
| B2 | Un cliente **no puede ganar dos veces** en el mismo sorteo. El sorteo **se puede re-ejecutar**. Los ganadores **no** se notifican automáticamente por WhatsApp. |
| B3 | El sorteo es **auditable y reproducible**: se guarda semilla, algoritmo, participantes y ganadores. |
| C1 | **Cola en base de datos + agente local** que consulta. |
| C2 | La sucursal sale del **perfil del usuario** (`profiles.sucursal_id`). **Una sola estación por sucursal.** |
| C3 | Impresora de red: **TCP `ip:9100`, ESC/POS, 80 mm = 48 columnas** (confirmado contra `printer-service` de referencia). |
| D1 | WhatsApp = texto + PDF adjunto + link externo a términos y condiciones. El **modo de adjunto es configurable** (`base64` por defecto, `url`, `ambos`, `ninguno`) porque la capacidad depende del proveedor de WhatsApp, que vive fuera de este repositorio. Un botón de boleto de prueba permite determinarlo empíricamente. |
| D2 | El PDF descargable es un **documento** (tamaño carta), distinto de la tirilla impresa. |
| D3 | Datos del negocio en una **tabla de configuración editable**. |
| E1 | Se corrige `registrarPago()` para que **ambas rutas de pago registren fila en `pagos`**. |
| E2 | **Snapshot JSONB** obligatorio en cada ticket. |
| E3 | **Idempotencia** ticket ↔ pago por índice único parcial. |
| E4 | Cliente sin teléfono: el modal deshabilita el envío por WhatsApp **mostrando el motivo** y deja imprimir/descargar. |
| E5 | Los tickets **se pueden anular** y salen del pool del sorteo. **No se bloquea** anular un ticket que ya ganó; el ganador queda marcado con una advertencia. |
| E6 | Se puede **reenviar y reimprimir**; cada intento queda registrado y la reimpresión lleva marca `*** COPIA ***`. |
| E7 | **5 permisos granulares nuevos.** `realizar_sorteo` disponible para admin **y** agentes con permiso. |
| E8 | Todos los rangos de fecha se evalúan en **hora de República Dominicana** (`America/Santo_Domingo`). |
| E9 | El ticket manual se ata **al cliente**, no a una deuda. |
| E10 | Se añade **Vitest** al agente local y al repo principal, acotado a funciones puras. |
| — | **QR** impreso en la tirilla, apuntando al enlace público del ticket. |

---

## 3. Arquitectura

```
┌────────────────── cobros-system (Next.js, servidor local) ───────────────────┐
│                                                                              │
│  Pago registrado ──► Modal confirmación ──► emitir_ticket()  [RPC atómico]   │
│                                                   │                          │
│                        ┌──────────────────────────┼───────────────────┐      │
│                        ▼                          ▼                   ▼      │
│                Webhook WhatsApp            Cola print_jobs      PDF on-demand│
│                (evento='ticket')           (por sucursal)       (no se guarda)│
│                        │                          │                          │
│  Sorteos ──► ejecución determinista (semilla) ──► ganadores auditables       │
└────────────────────────┼──────────────────────────┼──────────────────────────┘
                         ▼                          ▼
                 n8n / proveedor WA        print-agent (PC de la sucursal)
                                            └─► TCP ip:9100 ESC/POS 2Connect
```

### 3.1 Principio rector de la impresión

**El servidor renderiza los bytes ESC/POS; el agente local solo abre el socket y los escribe.**

En el `printer-service` de referencia (sistema de restaurante) el formato de la tirilla vive
en la PC. Con varias sucursales, cambiar el diseño obliga a actualizar cada máquina. Aquí el
agente es un tubo tonto (~200 líneas) que no hay que volver a tocar: el formato, los acentos,
el ancho de papel y el codepage se ajustan desde el servidor y aplican al instante en todas
las sucursales.

Beneficio secundario: el builder ESC/POS vive en el repo principal y se puede probar con
snapshots byte a byte en Vitest, sin hardware.

---

## 4. Modelo de datos

### 4.1 Tablas nuevas

#### `sucursales`
```
id              UUID PK
nombre          TEXT NOT NULL
direccion       TEXT
telefono        TEXT
activo          BOOLEAN NOT NULL DEFAULT TRUE
created_at, updated_at
```

#### `estaciones_impresion`
```
id                UUID PK
sucursal_id       UUID NOT NULL → sucursales ON DELETE CASCADE
nombre            TEXT NOT NULL
token_hash        TEXT NOT NULL          -- SHA-256 del token; el token plano se muestra una sola vez
token_prefijo     TEXT NOT NULL          -- primeros 8 caracteres, para identificarlo en la UI
impresora_ip      TEXT NOT NULL
impresora_port    INTEGER NOT NULL DEFAULT 9100
ancho_cols        INTEGER NOT NULL DEFAULT 48
codepage          TEXT NOT NULL DEFAULT 'cp850'
activo            BOOLEAN NOT NULL DEFAULT TRUE
ultimo_heartbeat  TIMESTAMPTZ
ultima_ip_agente  TEXT
version_agente    TEXT
created_at, updated_at

UNIQUE (sucursal_id) WHERE activo      -- una sola estación activa por sucursal
UNIQUE (token_hash)
```

#### `configuracion_ticket` (fila única)
```
id                  BOOLEAN PK DEFAULT TRUE CHECK (id)   -- garantiza una sola fila
nombre_comercial    TEXT NOT NULL DEFAULT 'Inversiones Cordero'
rnc                 TEXT
direccion           TEXT
telefono            TEXT
logo_url            TEXT                  -- solo se usa en el PDF, no en la tirilla
texto_legal         TEXT                  -- pie del boleto impreso
url_terminos        TEXT                  -- enlace externo a términos y condiciones
prefijo_numeracion  TEXT NOT NULL DEFAULT 'BOL'   -- para tickets sin sorteo asignado
pie_impresion       TEXT
modo_adjunto        TEXT NOT NULL DEFAULT 'base64'
                      CHECK (modo_adjunto IN ('base64','url','ambos','ninguno'))
updated_at, updated_by
```

#### `sorteos`
```
id                          UUID PK
nombre                      TEXT NOT NULL
descripcion                 TEXT
premio                      TEXT
fecha_inicio                DATE NOT NULL          -- fecha RD
fecha_fin                   DATE NOT NULL          -- fecha RD
estado                      TEXT NOT NULL DEFAULT 'borrador'
                              CHECK (estado IN ('borrador','activo','cerrado'))
prefijo                     TEXT NOT NULL
ultimo_numero               INTEGER NOT NULL DEFAULT 0
cantidad_ganadores_default  INTEGER NOT NULL DEFAULT 1
creado_por                  UUID → profiles
created_at, updated_at

CHECK (fecha_fin >= fecha_inicio)
UNIQUE (prefijo)                             -- evita colisiones de numeración entre sorteos
UNIQUE ((estado)) WHERE estado = 'activo'    -- un solo sorteo activo a la vez
```

#### `tickets`
```
id                 UUID PK
numero             INTEGER NOT NULL
numero_formateado  TEXT NOT NULL
sorteo_id          UUID → sorteos ON DELETE SET NULL      -- NULL = huérfano
cliente_id         UUID NOT NULL → clientes ON DELETE CASCADE
pago_id            UUID → pagos ON DELETE SET NULL
deuda_id           UUID → deudas ON DELETE SET NULL       -- informativo
origen             TEXT NOT NULL CHECK (origen IN ('automatico','manual'))
motivo             TEXT                                    -- obligatorio si manual
estado             TEXT NOT NULL DEFAULT 'valido'
                     CHECK (estado IN ('valido','anulado'))
anulado_por        UUID → profiles
anulado_at         TIMESTAMPTZ
motivo_anulacion   TEXT
token_publico      TEXT NOT NULL          -- 32 bytes aleatorios base64url
snapshot           JSONB NOT NULL
emitido_por        UUID → profiles
emitido_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
veces_enviado      INTEGER NOT NULL DEFAULT 0
veces_impreso      INTEGER NOT NULL DEFAULT 0
created_at

CHECK (origen = 'automatico' OR motivo IS NOT NULL)
UNIQUE (token_publico)
UNIQUE (numero_formateado)
UNIQUE (sorteo_id, numero) WHERE sorteo_id IS NOT NULL
UNIQUE (pago_id) WHERE pago_id IS NOT NULL AND estado <> 'anulado'   -- idempotencia (E3)
INDEX (cliente_id)
INDEX (sorteo_id, emitido_at) WHERE estado = 'valido'
INDEX (emitido_at)
```

**Forma del `snapshot`:**
```json
{
  "cliente":  { "id": "...", "nombre": "...", "apellido": "...", "telefono": "...", "dni_ruc": "..." },
  "sorteo":   { "id": "...", "nombre": "...", "premio": "...", "fecha_fin": "2026-12-31" },
  "negocio":  { "nombre_comercial": "...", "rnc": "...", "direccion": "...", "telefono": "...",
                "texto_legal": "...", "url_terminos": "..." },
  "emitido_at_rd": "29/07/2026 03:14 PM",
  "origen": "automatico",
  "version_snapshot": 1
}
```

El PDF y la reimpresión salen **siempre** del snapshot. Si mañana se corrige el nombre del
cliente o cambia la configuración del negocio, el boleto ya entregado sigue siendo idéntico.

#### `ticket_eventos`
```
id             UUID PK
ticket_id      UUID NOT NULL → tickets ON DELETE CASCADE
tipo           TEXT NOT NULL CHECK (tipo IN
                 ('emitido','enviado_wa','impreso','anulado','asignado_sorteo'))
estado         TEXT NOT NULL DEFAULT 'ok' CHECK (estado IN ('ok','error'))
es_copia       BOOLEAN NOT NULL DEFAULT FALSE     -- reenvío / reimpresión
detalle        TEXT
payload        JSONB                               -- sin el base64 del PDF
respuesta_http INTEGER
respuesta_body TEXT
usuario_id     UUID → profiles
created_at     TIMESTAMPTZ DEFAULT NOW()

INDEX (ticket_id, created_at DESC)
```

Tabla propia en vez de reutilizar `envios_log`, porque `envios_log.deuda_id` es `NOT NULL`
y un ticket manual no tiene deuda asociada (decisión E9).

**El base64 del PDF nunca se guarda en `payload`** — solo un resumen (`nombre_archivo`, `bytes`).

#### `print_jobs`
```
id              UUID PK
ticket_id       UUID NOT NULL → tickets ON DELETE CASCADE
sucursal_id     UUID NOT NULL → sucursales ON DELETE CASCADE
estado          TEXT NOT NULL DEFAULT 'pendiente'
                  CHECK (estado IN ('pendiente','reclamado','impreso','error','cancelado'))
es_copia        BOOLEAN NOT NULL DEFAULT FALSE
payload_escpos  TEXT                       -- base64 de los bytes ESC/POS; se purga a los 7 días
preview_texto   TEXT                       -- versión legible, para depurar desde la UI
intentos        INTEGER NOT NULL DEFAULT 0
max_intentos    INTEGER NOT NULL DEFAULT 3
estacion_id     UUID → estaciones_impresion ON DELETE SET NULL
claimed_at      TIMESTAMPTZ
impreso_at      TIMESTAMPTZ
error_mensaje   TEXT
solicitado_por  UUID → profiles
created_at      TIMESTAMPTZ DEFAULT NOW()

INDEX (sucursal_id, estado, created_at) WHERE estado IN ('pendiente','reclamado')
```

#### `sorteo_ejecuciones`
```
id                  UUID PK
sorteo_id           UUID NOT NULL → sorteos ON DELETE CASCADE
rango_desde         DATE NOT NULL          -- fecha RD
rango_hasta         DATE NOT NULL          -- fecha RD
cantidad_ganadores  INTEGER NOT NULL CHECK (cantidad_ganadores > 0)
semilla             TEXT NOT NULL
algoritmo           TEXT NOT NULL DEFAULT 'mulberry32-fisher-yates-v1'
pool_count          INTEGER NOT NULL
pool_hash           TEXT NOT NULL          -- SHA-256 de los ticket_id ordenados
vigente             BOOLEAN NOT NULL DEFAULT TRUE
ejecutado_por       UUID → profiles
ejecutado_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
notas               TEXT

UNIQUE (sorteo_id) WHERE vigente           -- una sola ejecución vigente por sorteo
```

#### `sorteo_participantes`
```
ejecucion_id  UUID NOT NULL → sorteo_ejecuciones ON DELETE CASCADE
ticket_id     UUID NOT NULL → tickets ON DELETE CASCADE
orden         INTEGER NOT NULL           -- posición después del shuffle
PRIMARY KEY (ejecucion_id, ticket_id)
```

#### `sorteo_ganadores`
```
id            UUID PK
ejecucion_id  UUID NOT NULL → sorteo_ejecuciones ON DELETE CASCADE
ticket_id     UUID NOT NULL → tickets ON DELETE CASCADE
cliente_id    UUID NOT NULL → clientes ON DELETE CASCADE
posicion      INTEGER NOT NULL
premio        TEXT
snapshot      JSONB NOT NULL             -- cliente y ticket al momento del sorteo
entregado     BOOLEAN NOT NULL DEFAULT FALSE
entregado_at  TIMESTAMPTZ
notas         TEXT
created_at

UNIQUE (ejecucion_id, posicion)
UNIQUE (ejecucion_id, cliente_id)        -- refuerza B2 a nivel de base de datos
```

### 4.2 Alteraciones a tablas existentes

| Tabla | Cambio | Razón |
|---|---|---|
| `webhooks` | `+ evento TEXT NOT NULL DEFAULT 'cobranza' CHECK (evento IN ('cobranza','ticket'))` | **Obligatorio.** Ver landmine L1. |
| `plantillas_mensaje` | El `CHECK` de `etapa` pasa a aceptar `'ticket'` | Plantilla de WhatsApp del boleto |
| `profiles` | `+ sucursal_id UUID → sucursales ON DELETE SET NULL` | Origen de la sucursal de impresión |
| `registrar_pago_atomico` | Nueva firma; inserta la fila en `pagos` dentro de la transacción | Corrige L2 y L3 |

### 4.3 Numeración

| Caso | Origen del número | Formato |
|---|---|---|
| Hay sorteo activo | `sorteos.ultimo_numero + 1` (bloqueo de fila) | `{sorteos.prefijo}-000123` |
| Sin sorteo activo | `tickets_numero_huerfano_seq` | `{configuracion_ticket.prefijo_numeracion}-SN-000123` |

```sql
CREATE SEQUENCE IF NOT EXISTS tickets_numero_huerfano_seq;
```

El infijo `-SN-` (sin sorteo) y el `UNIQUE (prefijo)` en `sorteos` garantizan juntos que
`numero_formateado` nunca colisione entre un boleto de sorteo y uno huérfano, ni entre dos
sorteos distintos. Sin estas dos piezas, un sorteo cuyo prefijo coincida con el de la
configuración produciría una violación del índice único al emitir.

Asignar un boleto huérfano a un sorteo **no lo renumera**: conserva su `numero_formateado`
original, para no invalidar un boleto ya impreso o enviado.

### 4.4 Helper SQL de permisos

Varias policies necesitan consultar los permisos granulares. Se añade, siguiendo el patrón de
`public.get_my_rol()`:

```sql
CREATE OR REPLACE FUNCTION public.tiene_permiso(p_permiso TEXT)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT rol = 'admin' OR (permisos ->> p_permiso)::BOOLEAN
     FROM public.profiles WHERE id = auth.uid()),
    FALSE
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;
```

Nota: cuando `permisos` es `NULL` o le falta la clave, la expresión devuelve `NULL` y el
`COALESCE` lo convierte en `FALSE`. Los defaults de `DEFAULT_PERMISOS_AGENTE` se aplican en la
capa de aplicación (`getPermisos()`, §9.2); las policies son deliberadamente más estrictas.
La migración de la fase 0 rellena la clave en los perfiles existentes para que ambas capas
coincidan.

---

## 5. Emisión de tickets

### 5.1 RPC `emitir_ticket`

Todo ocurre en una sola transacción:

```
emitir_ticket(
  p_cliente_id, p_pago_id, p_deuda_id, p_origen, p_motivo, p_emitido_por
) RETURNS jsonb
```

1. Valida que el cliente exista y esté activo.
2. Si `p_pago_id` no es nulo y ya existe un ticket válido para ese pago → **devuelve el
   ticket existente** con `{ ya_existia: true }`. Nunca lanza error por doble clic.
3. Busca el sorteo `activo`. Si existe, toma el correlativo con
   `UPDATE sorteos SET ultimo_numero = ultimo_numero + 1 WHERE id = ... RETURNING ultimo_numero`
   — el bloqueo de fila serializa las emisiones concurrentes. Si no existe, usa
   `tickets_numero_huerfano_seq`.
4. Construye el `snapshot` leyendo cliente, sorteo y configuración.
5. Genera `token_publico` (32 bytes aleatorios, base64url).
6. Inserta el ticket y un `ticket_eventos` de tipo `emitido`.
7. Devuelve el ticket completo.

La condición `UNIQUE (pago_id) WHERE pago_id IS NOT NULL AND estado <> 'anulado'` es la red
de seguridad ante carreras: si dos peticiones simultáneas pasan el paso 2, la segunda choca
con el índice y el RPC reintenta la lectura devolviendo el ticket ganador.

### 5.2 Modal de confirmación posterior al pago

Componente compartido `components/tickets/ticket-confirm-dialog.tsx`, usado desde los dos
puntos donde hoy se marca un pago:

- `components/layout/pagos-pendientes-panel.tsx` (panel flotante)
- `components/cuentas/cuentas-view.tsx` (diálogo de pago)

Flujo:

1. El agente marca el pago. La acción de pago devuelve `{ pagoId, clienteId, cliente, tieneTelefono }`.
2. Se abre el modal: *"Pago registrado. ¿Generar boleto para Juan Pérez?"*
3. Acciones disponibles:
   - **Generar y enviar por WhatsApp** — deshabilitada con motivo visible si no hay teléfono válido (E4)
   - **Generar e imprimir** — muestra la sucursal destino y su estado en línea/fuera de línea
   - **Solo generar**
   - **No generar**

**El pago ya está registrado antes de abrir el modal.** Cerrarlo nunca revierte el pago.

**Recuperación de tickets perdidos:** si el agente cierra el modal o se le cae el navegador,
el pago queda sin ticket. Para eso el perfil del cliente muestra un aviso
*"N pagos sin boleto"* con acción para emitirlos después. Sin esta pieza se pierden tickets
en silencio.

### 5.3 Ticket manual

Desde el perfil del cliente (`/clientes/[id]`), con permiso `generar_ticket_manual`:
un diálogo pide **motivo obligatorio** y ofrece las mismas tres vías de entrega.
Se ata al cliente, con `pago_id = NULL` (decisión E9).

### 5.4 Anulación

Cualquier usuario con `generar_ticket_manual` puede anular indicando motivo. El ticket sale
del pool de futuros sorteos. **No se bloquea anular un ticket que ya ganó** (decisión E5):
la pantalla de ganadores muestra una advertencia visible
*"Boleto anulado después del sorteo"* en esa fila.

### 5.5 Tickets huérfanos

Los tickets emitidos sin sorteo activo aparecen filtrados en `/tickets` con una acción masiva
**"Asignar a sorteo"**, que registra un `ticket_eventos` de tipo `asignado_sorteo`.
La asignación **no renumera** el ticket: conserva su `numero_formateado` original.

---

## 6. Impresión

### 6.1 Ciclo de vida de un trabajo

```
pendiente ──claim──► reclamado ──ack ok──► impreso
                          │
                          ├──ack error, intentos < max──► pendiente
                          └──ack error, intentos = max──► error
```

Los trabajos en `reclamado` con más de 90 segundos vuelven a `pendiente` si les quedan
intentos (barrido ejecutado de forma perezosa al inicio de cada `poll`). Reimprimir el mismo
boleto es inofensivo: lleva marca `*** COPIA ***`.

### 6.2 API del agente

Tres endpoints, autenticados con un **token por estación**, nunca con la service-role key
de Supabase.

> Esto se aparta a propósito de la referencia. El `printer-service` del restaurante lleva un
> `serviceAccountKey.json` con acceso total a Firestore en cada PC de tienda. El equivalente
> aquí sería poner la llave maestra de toda la base de cobros en una PC de mostrador.

```
POST /api/print/hello   { token, version }
     → { estacion, sucursal, impresora: { ip, port }, ancho_cols, codepage }
       Registra heartbeat.

POST /api/print/poll    { token, max? }
     → long-poll de hasta 25 s; devuelve [] o los trabajos reclamados
       { jobs: [{ id, payload_escpos, es_copia, ticket_numero }] }
       Con POLL_TIMEOUT_MS=0 el agente cae a sondeo simple cada 3 s, por si el
       long-poll da problemas con algún proxy inverso intermedio.

POST /api/print/ack     { token, jobId, ok, error? }
     → { estado }
```

El reclamo es atómico:

```sql
UPDATE print_jobs SET estado = 'reclamado', estacion_id = $1,
                      claimed_at = NOW(), intentos = intentos + 1
WHERE id IN (
  SELECT id FROM print_jobs
  WHERE sucursal_id = $2 AND estado = 'pendiente' AND intentos < max_intentos
  ORDER BY created_at
  LIMIT $3
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

`FOR UPDATE SKIP LOCKED` garantiza que dos instancias del agente jamás impriman el mismo
trabajo. La referencia lee la bandera `printedComanda` en JavaScript y luego escribe; con dos
instancias corriendo imprime doble.

El token se valida por hash SHA-256 contra `estaciones_impresion.token_hash`.

### 6.3 Autenticación en el middleware

`middleware.ts` protege todo salvo `/login`. Hay que añadir:

```ts
const OPEN_PATHS = ['/t/', '/terminos', '/api/tickets/', '/api/print/']
```

evaluado **antes** de la lógica de sesión y **sin** el redirect a `/dashboard` que hoy aplica
`PUBLIC_PATHS`. Ver landmine L4. La autenticación de `/api/print/*` ocurre dentro de cada
route handler, no en el middleware.

### 6.4 Formato de la tirilla (80 mm, 48 columnas)

```
                                                  ← ESC @ (init), ESC t (codepage)
────────────────────────────────────────────────
            INVERSIONES CORDERO                   ← ESC ! 0x11 (doble ancho y alto), centrado
────────────────────────────────────────────────
              BOLETO DE SORTEO
                                                  ← si es copia: *** COPIA ***

                 BOL-000123                       ← ESC ! 0x30 (tamaño máximo), centrado

Cliente:  Juan Pérez Muñoz
Cédula:   001-1234567-8
Fecha:    29/07/2026 03:14 PM
Sorteo:   Gran Sorteo Navideño 2026
Premio:   Televisor 55"
────────────────────────────────────────────────
                  [ QR ]                          ← GS ( k, apunta al enlace público
             Verifica tu boleto
────────────────────────────────────────────────
<texto_legal desde configuracion_ticket>
<pie_impresion>
────────────────────────────────────────────────
                                                  ← GS V 0 (corte)
```

Comandos ESC/POS, tomados del builder de referencia y ampliados:

| Comando | Bytes | Uso |
|---|---|---|
| Inicializar | `1B 40` | Reset |
| Codepage | `1B 74 n` | CP850 (`n=2`), configurable por estación |
| Interlineado | `1B 33 n` | 30 puntos, igual que la referencia |
| Alineación | `1B 61 n` | 0 izquierda, 1 centro |
| Tamaño de fuente | `1B 21 n` | `0x00` normal, `0x08` negrita, `0x11` doble, `0x30` máximo |
| QR | `1D 28 6B ...` | Modelo 2, tamaño 6, corrección M |
| Corte | `1D 56 00` | Corte total |

**Acentos.** La referencia esquiva el problema escribiendo "Telefono" y "Metodo" sin tildes.
Con nombres de clientes reales ("Muñoz", "Peña", "García") no es una opción: `Buffer.from(str)`
emite UTF-8 y la impresora interpreta CP437, produciendo basura. Solución: seleccionar CP850
con `ESC t` y codificar con `iconv-lite`, con *fold* a ASCII para cualquier carácter no
mapeable. Como el render es server-side, el codepage se ajusta por estación sin tocar las PCs.

El logo raster (`GS v 0`) queda **fuera del alcance de la v1**; el encabezado es texto en doble
tamaño, igual que la referencia. El logo sí aparece en el PDF.

### 6.5 El agente local (`print-agent/`)

Paquete nuevo dentro de este repositorio, con su propio `package.json`. Excluido de la imagen
Docker vía `.dockerignore` y del build de Next.

```
print-agent/
  package.json          — sin Supabase, sin Firebase; solo node:net + fetch nativo
  tsconfig.json
  vitest.config.ts
  .env.example          — API_URL, ESTACION_TOKEN, POLL_TIMEOUT_MS, LOG_LEVEL
  src/index.ts          — bucle principal: hello → poll → imprimir → ack
  src/api.ts            — cliente HTTP con reintentos y backoff exponencial
  src/printer.ts        — socket TCP; propaga errores de verdad
  src/logger.ts         — log rotativo a archivo + consola
  src/__tests__/        — Vitest
  README.md             — instalación como servicio de Windows con NSSM
```

**Bug de la referencia que no se replica.** En `printer-service/services/escpos.ts:14-25`,
`printToPrinter` hace `resolve()` tanto en `error` como en `timeout`. El resultado es que
`index.ts` marca `printedFactura: true` aunque la impresora esté apagada y no haya salido
nada. Aquí `printer.ts` rechaza la promesa, el `ack` reporta el fallo, el trabajo queda en
`error` con el mensaje y la UI lo muestra.

Comportamiento ante caída de red: reintentos con backoff (1 s → 30 s máximo), sin perder
trabajos — quedan en la cola del servidor hasta que el agente vuelve.

### 6.6 Purga de payloads

Los `print_jobs` en estado `impreso` o `cancelado` con más de 7 días pierden su
`payload_escpos` (se pone a `NULL`), conservando el resto del registro para auditoría.
Se ejecuta en el `node-cron` ya embebido en `server.js`.

---

## 7. PDF y entrega por WhatsApp

### 7.1 Generación del PDF

`@react-pdf/renderer` en `app/api/tickets/[token]/pdf/route.ts` con `export const runtime = 'nodejs'`.
Se genera al vuelo desde el `snapshot`; **nada se almacena**.

Se usan las fuentes estándar del formato PDF (Helvetica, codificación WinAnsi, que cubre ñ y
vocales acentuadas) para no tener que empaquetar archivos TTF en el build `standalone` de
Docker. Una fuente personalizada exigiría copiarla explícitamente en el `Dockerfile`.

Formato: documento tamaño carta con logo, datos del negocio, el número de boleto grande,
datos del cliente, datos del sorteo, QR y texto legal.

### 7.2 Entrega por WhatsApp

El modo de adjunto es **configurable**, porque la capacidad real depende del proveedor de
WhatsApp que haya detrás del webhook, y ese proveedor vive fuera de este repositorio.

`configuracion_ticket.modo_adjunto`:

| Valor | Comportamiento | Requisito |
|---|---|---|
| `base64` **(por defecto)** | El PDF viaja en `adjunto.base64` dentro del payload | El proveedor debe aceptar binario o base64 |
| `url` | Solo se envía `url_publica`; sin base64 | El servidor debe ser alcanzable desde internet |
| `ambos` | Se envían los dos campos | Para migrar o depurar |
| `ninguno` | Solo texto | — |

**Por qué `base64` es el valor por defecto:** este sistema corre en un servidor local
(`node server.js`, `HOSTNAME=0.0.0.0`), no en internet. Una URL pública exigiría Cloudflare
Tunnel, port forwarding con DDNS o mudarse a un VPS. El POST del webhook es *saliente*, así
que el base64 atraviesa una red local sin exponer nada. Un boleto de una página pesa 20-60 KB,
unos 30-80 KB codificado.

**Lado n8n.** El nodo *Convert to File* (operación **Base64 to File**; en versiones anteriores
*Move Binary Data* en modo JSON→Binary) convierte `adjunto.base64` en datos binarios
adjuntables. De ahí en adelante depende del proveedor:

| Proveedor | Soporte |
|---|---|
| Evolution API | Directo: `/message/sendMedia` acepta `media` como base64 o URL |
| WhatsApp Business Cloud (Meta) | Dos pasos: subir el binario a `/media` (multipart) → `media_id` → enviar |
| Baileys / WPPConnect | Base64 nativo |
| Twilio | **No admite base64.** Requiere `modo_adjunto = 'url'` y servidor expuesto |

**Botón de prueba.** La pantalla `/configuracion/tickets` incluye *"Enviar boleto de prueba"*,
que emite un ticket ficticio (no persistido) y lo manda al webhook de tickets con el modo
configurado, mostrando el código y cuerpo de la respuesta. Sirve para determinar
empíricamente qué acepta el proveedor **antes** de depender de ello, en lugar de asumirlo.

Si la prueba falla con `base64`, cambiar a `url` es un cambio de configuración, no de código:
la ruta pública ya está implementada. Lo único que haría falta entonces es exponer el
servidor.

Los **términos y condiciones** van como URL externa configurable
(`configuracion_ticket.url_terminos`) — puede apuntar a cualquier sitio y nunca necesita que
este servidor esté expuesto, sea cual sea el modo de adjunto.

La ruta pública `/t/[token]` se implementa siempre. Sirve una página ligera con el boleto y
botón de descarga.

**Payload:**

```ts
interface TicketWebhookPayload {
  evento: 'ticket_emitido'
  timestamp: string
  enviado_por: 'sistema' | 'manual'
  reenvio: boolean
  cliente: { id: string; nombre: string; apellido: string; telefono: string }
  ticket: { id: string; numero: string; sorteo: string | null; emitido_at: string }
  mensaje: string
  url_terminos: string | null
  url_publica: string | null
  adjunto: { tipo: 'pdf'; nombre: string; base64: string } | null
}
```

**Plantilla** (`plantillas_mensaje` con `etapa = 'ticket'`), variables disponibles:
`{{nombre}}`, `{{apellido}}`, `{{ticket_numero}}`, `{{sorteo}}`, `{{premio}}`, `{{fecha}}`,
`{{url_terminos}}`.

**Dependencia externa:** el flujo de n8n (o el proveedor de WhatsApp que se use) debe
ajustarse para convertir `adjunto.base64` en binario y adjuntarlo al mensaje. Eso vive fuera
de este repositorio y es responsabilidad del usuario.

### 7.3 Separación de webhooks

`enviarRecordatorioManual()` e `intentarEnvioInmediato()` pasan a filtrar por
`.eq('evento', 'cobranza')`. El envío de tickets usa `.eq('evento', 'ticket')`.
**Sin este cambio, agregar un segundo webhook activo rompe la cobranza** (ver L1).

---

## 8. Sorteos

### 8.1 Algoritmo determinista

```
lib/utils/sorteo.ts   (funciones puras, con tests)

  hashSemilla(s: string): number                 -- cyrb128 → entero de 32 bits
  mulberry32(seed: number): () => number         -- PRNG determinista
  barajarDeterminista<T>(items, rng): T[]        -- Fisher-Yates
  seleccionarGanadores(pool, n, semilla): {
    ganadores: Ticket[]
    ordenParticipantes: { ticketId, orden }[]
  }
```

Selección:

1. Pool = tickets con `sorteo_id = X`, `estado = 'valido'`, y `emitido_at` dentro del rango
   convertido a UTC desde fechas RD. Ordenado por `numero` ascendente (orden determinista).
2. `rng = mulberry32(hashSemilla(semilla))`.
3. Fisher-Yates sobre el pool.
4. Recorrer el resultado saltando clientes ya premiados hasta juntar N ganadores
   (regla B2), o hasta agotar el pool.

**Prohibido `Math.random()`** en cualquier punto de este camino.

Si hay menos clientes distintos que ganadores solicitados, la UI avisa antes de ejecutar y el
sorteo se guarda con los ganadores que sí se pudieron obtener.

### 8.2 Auditoría

Cada ejecución guarda semilla, versión del algoritmo, rango, `pool_count`, `pool_hash`
(SHA-256 de los `ticket_id` ordenados), la lista completa de participantes con su orden tras
el barajado, y los ganadores con snapshot.

Botón **"Verificar ejecución"**: recalcula desde la semilla y los participantes almacenados y
confirma que salen exactamente los mismos ganadores. Es lo que permite demostrarle a un
cliente que no hubo manipulación.

### 8.3 Re-ejecución

Re-ejecutar crea una **ejecución nueva** y marca la anterior `vigente = false`.
Nunca se borra nada. Un sorteo se puede **cerrar** (`estado = 'cerrado'`) para sellarlo y
bloquear más ejecuciones.

### 8.4 Zona horaria

`lib/utils/fecha-rd.ts` (funciones puras, con tests):

```ts
export const TZ_RD = 'America/Santo_Domingo'
hoyRD(): string                                       // 'YYYY-MM-DD'
rangoRDaUTC(desde, hasta): { desdeISO, hastaISO }     // [00:00:00, 23:59:59.999] RD → UTC
formatearFechaHoraRD(iso: string): string             // para tirilla y PDF
```

Un ticket emitido a las 9 PM del día 30 pertenece al día 30, no al 31 (decisión E8).

---

## 9. Permisos y seguridad

### 9.1 Permisos nuevos

Añadidos a `PermisosAgente` y a `DEFAULT_PERMISOS_AGENTE`:

| Permiso | Por defecto | Alcance |
|---|---|---|
| `ver_tickets` | `true` | Ver la sección de boletos y los del cliente |
| `generar_ticket_manual` | `true` | Emitir boletos manuales y anular |
| `imprimir_ticket` | `true` | Encolar trabajos de impresión |
| `ver_sorteos` | `false` | Ver sorteos y ganadores |
| `realizar_sorteo` | `false` | Crear sorteos y ejecutar la selección de ganadores |

`realizar_sorteo` está disponible tanto para admin como para agentes con el permiso otorgado
(decisión E7).

### 9.2 Helper de fusión de permisos

`app-sidebar.tsx:58` hace hoy `profile.permisos ?? {}` sin fusionar defaults. Los permisos
nuevos aparecerían como `undefined` (= denegados) para los agentes que ya tienen un objeto de
permisos guardado. Se añade:

```ts
export function getPermisos(profile: Profile): PermisosAgente {
  return { ...DEFAULT_PERMISOS_AGENTE, ...(profile.permisos ?? {}) }
}
```

aplicado consistentemente en el sidebar, en las páginas y en las server actions.

### 9.3 RLS

- `sucursales`, `estaciones_impresion`, `configuracion_ticket`: lectura para autenticados,
  escritura solo admin.
- `sorteos`, `sorteo_*`: lectura según `ver_sorteos`; escritura según `realizar_sorteo`.
- `tickets`: el agente ve los de sus clientes asignados (mismo patrón que `pagos`);
  el admin, todos.
- `ticket_eventos`: sigue la visibilidad del ticket.
- `print_jobs`:
  - `INSERT` permitido a quien cumpla `tiene_permiso('imprimir_ticket')`
  - `SELECT` de los propios (`solicitado_por = auth.uid()`) y todos para admin
  - `UPDATE` denegado a sesiones de usuario: el ciclo de vida del trabajo
    (reclamo, `ack`, reintentos) lo maneja exclusivamente la API `/api/print/*` con el
    cliente admin, siguiendo el patrón ya presente en `lib/actions/envios.ts`

El agente local **nunca** habla con Supabase: solo con la API, autenticado por token de
estación.

### 9.4 Superficie pública

- `token_publico`: 32 bytes aleatorios (256 bits) → no enumerable.
- `/t/[token]` y el PDF devuelven **410 Gone** si el ticket está anulado.
- Limitación básica de tasa por IP en las rutas públicas.
- La service-role key nunca sale del servidor.

---

## 10. Superficies de interfaz

| Ruta | Contenido | Permiso |
|---|---|---|
| `/tickets` | Listado con filtros (sorteo, cliente, estado, rango, origen, huérfanos). Acciones: ver, PDF, reenviar, reimprimir, anular, asignar a sorteo | `ver_tickets` |
| `/sorteos` | Lista de sorteos con su estado | `ver_sorteos` |
| `/sorteos/[id]` | Detalle, ejecutar sorteo, ganadores, verificar, marcar premio entregado | `ver_sorteos` / `realizar_sorteo` |
| `/clientes/[id]` | Nueva sección "Boletos del cliente" + botón de boleto manual + aviso de pagos sin boleto | `ver_tickets` |
| `/configuracion/tickets` | Datos del negocio, texto legal, URL de términos, prefijo, modo de adjunto, **botón de boleto de prueba** | admin |
| `/estaciones` | Alta y edición de **sucursales**, estaciones, estado en línea/fuera de línea, token, botón de página de prueba | admin |
| `/t/[token]` | Página pública del boleto con descarga | público |
| `/terminos` | Redirige a `url_terminos` o muestra el texto configurado | público |

Sidebar: entradas nuevas **Boletos** y **Sorteos**, más **Estaciones** y
**Configuración de boletos** para admin. Se respeta el patrón de filtrado por permiso que ya
existe en `ALL_NAV`.

El botón de imprimir muestra el estado de la estación de la sucursal (en línea si el
`ultimo_heartbeat` es de hace menos de 60 s) **antes** de hacer clic. Sin eso, el usuario
imprime al vacío y no se entera.

---

## 11. Landmines en el código actual

| # | Hallazgo | Impacto | Tratamiento |
|---|---|---|---|
| **L1** | `lib/actions/envios.ts:96-102` y `:258-267` usan `.maybeSingle()` sobre webhooks activos | **Crítico.** Al agregar un segundo webhook activo, la cobranza deja de enviar con error de múltiples filas | Columna `webhooks.evento` + filtrado explícito. No es opcional |
| **L2** | `registrarPago()` no inserta en `pagos`; solo `marcarPagoPeriodo()` lo hace | Esa ruta de pago se quedaría sin boleto | Fase 1 |
| **L3** | `marcarPagoPeriodo()` inserta el pago y *después* llama al RPC | Si el RPC falla queda una fila de pago huérfana | Mover el insert dentro del RPC |
| **L4** | `middleware.ts:20-26` redirige a `/dashboard` a quien esté logueado y visite una ruta pública | Un admin logueado no podría abrir el boleto de un cliente | Lista `OPEN_PATHS` separada de `PUBLIC_PATHS` |
| **L5** | `envios_log.deuda_id` es `NOT NULL` | Un boleto manual no tiene deuda | Tabla `ticket_eventos` propia |
| **L6** | `app-sidebar.tsx:58` hace `profile.permisos ?? {}` sin fusionar defaults | Los permisos nuevos quedan denegados para agentes existentes | Helper `getPermisos()` |
| **L7** | `next.config.ts:7` tiene `typescript.ignoreBuildErrors: true` | El build no falla ante errores de tipos | Ejecutar `npx tsc --noEmit` como verificación explícita en cada fase |
| **L8** | `printer-service/services/escpos.ts:14-25` resuelve la promesa en error y timeout | Marca como impreso lo que nunca salió | El agente nuevo propaga el error |
| **L9** | La referencia comprueba `printedComanda` en JS y luego escribe | Dos instancias imprimen doble | `FOR UPDATE SKIP LOCKED` |
| **L10** | La referencia envía UTF-8 crudo a la impresora | Los acentos salen como basura | `ESC t` + `iconv-lite` a CP850 |

---

## 12. Pruebas

Se añade **Vitest** en dos lugares, acotado a lo que aporta valor real:

**Repo principal** — solo funciones puras:
- `lib/utils/sorteo.ts` — misma semilla produce los mismos ganadores; ningún cliente repetido;
  pool más pequeño que N; pool vacío
- `lib/utils/fecha-rd.ts` — límites de rango en hora RD; ticket de las 9 PM cae en su día
- `lib/escpos/builder.ts` — snapshots byte a byte; acentos en CP850; ajuste a 48 columnas;
  cabecera de copia; secuencia del QR

**`print-agent/`**:
- Parseo de la respuesta de `poll`
- El error del socket se propaga y produce un `ack` de fallo (regresión directa de L8)
- Backoff ante caída de la API
- No se pierden trabajos al reconectar

**Fuera de alcance:** tests de componentes, E2E, y tests que requieran hardware.
La impresión real se verifica manualmente contra la 2Connect en la fase 7.

---

## 13. Fases de implementación

| Fase | Contenido | Criterio de verificación |
|---|---|---|
| **0** | Migraciones SQL y tipos TypeScript. Sin interfaz | Migraciones aplicadas; `npx tsc --noEmit` limpio |
| **1** | Consolidar el registro de pagos (L2, L3): mover el insert dentro del RPC, actualizar ambas rutas | Ambas rutas producen fila en `pagos`; el saldo se actualiza igual que antes |
| **2** | RPC `emitir_ticket`, server actions, snapshot, idempotencia | Vitest de numeración e idempotencia; doble clic no duplica |
| **3** | PDF, ruta `/t/[token]`, `OPEN_PATHS` en middleware | PDF descargable con acentos correctos; admin logueado puede abrir `/t/` |
| **4** | WhatsApp: `webhooks.evento`, plantilla `'ticket'`, modos de adjunto, botón de boleto de prueba | **El botón de prueba llega al WhatsApp con el PDF adjunto**; la cobranza sigue funcionando con dos webhooks activos |
| **5** | Modal post-pago, sección en el perfil del cliente, listado `/tickets`, pagos sin boleto | Flujo completo automático y manual |
| **6** | Builder ESC/POS server-side, cola `print_jobs`, `/api/print/*`, interfaz de estaciones | Snapshots byte a byte; reclamo atómico probado con dos agentes simulados |
| **7** | Paquete `print-agent`, Vitest, servicio de Windows, documentación | Impresión real en la 2Connect; corte, acentos y QR correctos |
| **8** | Sorteos: entidad, ejecución determinista, ganadores, verificación, interfaz | Vitest de determinismo; el botón de verificar confirma |
| **9** | Permisos, RLS, navegación, `DESPLIEGUE.md`, purga de payloads | Prueba con cuenta de agente restringida |

Cada fase deja el sistema en estado desplegable. Las fases 0 y 1 son las de mayor riesgo
—tocan código de dinero que ya funciona— y por eso van aisladas y primero.

---

## 14. Fuera de alcance

- Logo raster en la tirilla impresa (solo en el PDF)
- Notificación automática a los ganadores por WhatsApp (decisión B2)
- Sucursal asignada a los clientes (la sucursal sale del perfil del usuario)
- Varias estaciones de impresión por sucursal
- Tickets ponderados por monto pagado (decisión A2: uno fijo por pago)
- Exponer el servidor a internet
- Tests de componentes y E2E
