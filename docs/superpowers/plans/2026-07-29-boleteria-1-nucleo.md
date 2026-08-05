# Boletería — Plan 1: Núcleo de boletos

> **Para trabajadores agénticos:** SUB-SKILL REQUERIDA: usa `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para implementar este plan tarea por tarea. Los pasos usan sintaxis de checkbox (`- [ ]`) para el seguimiento.

**Goal:** Emitir boletos de sorteo al registrar un pago o manualmente desde el perfil del cliente, entregarlos por WhatsApp con el PDF adjunto, y permitir descargarlos generándolos al vuelo sin guardar el PDF en la base de datos.

**Architecture:** Todo el estado vive en Supabase. La emisión ocurre en un único RPC de PostgreSQL que serializa la numeración con un bloqueo de fila y es idempotente respecto al pago. Cada boleto congela sus datos en un `snapshot` JSONB, y tanto el PDF como la futura tirilla impresa se generan siempre desde ese snapshot, nunca desde las tablas vivas. Las Server Actions de Next.js son la única puerta de escritura desde la interfaz.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Supabase (Postgres + RLS), Tailwind v4, shadcn/ui, `@react-pdf/renderer`, Vitest, Zod, `sonner` para toasts.

**Spec:** `docs/superpowers/specs/2026-07-29-tickets-boleteria-design.md`

**Planes siguientes:** Plan 2 (impresión POS) y Plan 3 (sorteos) dependen de este. No los empieces antes de terminar éste.

## Global Constraints

- **Zona horaria:** todo cálculo de fechas de negocio usa `America/Santo_Domingo`. Nunca uses `new Date().toISOString().split('T')[0]` para obtener "hoy".
- **Idioma:** todo el texto visible para el usuario va en español. Los identificadores de código en español siguen el patrón existente del repo (`deudas`, `envios`, `plantillas`).
- **El PDF nunca se persiste.** Ni en la base de datos, ni en disco, ni en Supabase Storage. Se genera en cada petición desde `tickets.snapshot`.
- **`next.config.ts` tiene `typescript.ignoreBuildErrors: true`.** `npm run build` NO falla ante errores de tipos. Ejecuta `npx tsc --noEmit` como verificación explícita en cada tarea que toque TypeScript.
- **No uses `Math.random()`** para nada relacionado con boletos o sorteos.
- **Server Actions** siempre llevan `'use server'` en la primera línea del archivo y validan permisos antes de escribir.
- **Cliente admin de Supabase** (`SUPABASE_SERVICE_ROLE_KEY`) solo en código de servidor y solo cuando RLS impida la operación legítima. El patrón existente está en `lib/actions/envios.ts:189-193`.
- **Migraciones:** un archivo por tarea en `supabase/migrations/`, con prefijo numérico, idempotentes (`IF NOT EXISTS` donde aplique). Se ejecutan a mano en Supabase Studio → SQL Editor; no hay CLI de migraciones en este proyecto.
- **Commits:** en español, formato `feat:` / `fix:` / `chore:` / `test:`.

---

## Estructura de archivos

**Crear:**

| Archivo | Responsabilidad |
|---|---|
| `vitest.config.ts` | Configuración de pruebas para funciones puras |
| `lib/utils/fecha-rd.ts` | Conversión de fechas entre hora RD y UTC |
| `lib/utils/fecha-rd.test.ts` | Pruebas de lo anterior |
| `lib/utils/permisos.ts` | Fusión de permisos con los valores por defecto |
| `lib/utils/permisos.test.ts` | Pruebas de lo anterior |
| `lib/types/tickets.ts` | Tipos del módulo de boletos |
| `lib/validations/tickets.ts` | Esquemas Zod de los formularios |
| `lib/actions/tickets.ts` | Server Actions: emitir, anular, enviar, consultar |
| `lib/actions/configuracion-ticket.ts` | Server Actions de la configuración |
| `lib/pdf/ticket-document.tsx` | Documento PDF del boleto |
| `lib/api-publico/rate-limit.ts` | Limitador de tasa en memoria para rutas públicas |
| `app/api/tickets/[token]/pdf/route.ts` | Descarga pública del PDF |
| `app/t/[token]/page.tsx` | Página pública del boleto |
| `app/terminos/page.tsx` | Términos y condiciones |
| `components/tickets/ticket-confirm-dialog.tsx` | Modal de confirmación tras el pago |
| `components/tickets/ticket-manual-dialog.tsx` | Diálogo de boleto manual |
| `components/tickets/tickets-cliente-panel.tsx` | Boletos dentro del perfil del cliente |
| `components/tickets/tickets-view.tsx` | Listado y filtros de `/tickets` |
| `app/(dashboard)/tickets/page.tsx` | Página del listado |
| `app/(dashboard)/configuracion/tickets/page.tsx` | Página de configuración |
| `components/configuracion/configuracion-ticket-view.tsx` | Formulario de configuración |
| `supabase/migrations/20260729_01_boleteria_base.sql` | Tablas del módulo |
| `supabase/migrations/20260729_02_permisos_boleteria.sql` | Permisos y helper SQL |
| `supabase/migrations/20260729_03_pagos_atomico.sql` | `registrar_pago_atomico` v2 |
| `supabase/migrations/20260729_04_emitir_ticket.sql` | RPC de emisión |
| `supabase/migrations/20260729_05_webhooks_evento.sql` | Separación de webhooks y plantilla |
| `supabase/tests/*.sql` | Guiones de verificación manual de los RPC |

**Modificar:**

| Archivo | Cambio |
|---|---|
| `package.json` | `vitest`, `@react-pdf/renderer`, scripts de prueba |
| `lib/types/index.ts` | 5 permisos nuevos, reexportar tipos de boletos |
| `lib/actions/deudas.ts` | `registrarPago` y `marcarPagoPeriodo` usan el RPC v2 |
| `lib/actions/envios.ts` | Filtrar webhooks por `evento = 'cobranza'` |
| `middleware.ts` | Lista `OPEN_PATHS` |
| `components/layout/app-sidebar.tsx` | Usar `getPermisos()`, entradas nuevas |
| `components/layout/pagos-pendientes-panel.tsx` | Abrir el modal tras el pago |
| `components/cuentas/cuentas-view.tsx` | Abrir el modal tras el pago |
| `app/(dashboard)/clientes/[id]/page.tsx` | Panel de boletos del cliente |

---

## Tarea 1: Infraestructura de pruebas y fechas de República Dominicana

Es la base de todo lo demás: sin conversión correcta de fechas RD↔UTC, los rangos del sorteo del Plan 3 quedan corridos y los boletos de la noche caen en el día equivocado.

**Files:**
- Create: `vitest.config.ts`
- Create: `lib/utils/fecha-rd.ts`
- Test: `lib/utils/fecha-rd.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: nada
- Produces:
  - `TZ_RD: 'America/Santo_Domingo'`
  - `hoyRD(): string` — `'YYYY-MM-DD'`
  - `rangoRDaUTC(desde: string, hasta: string): { desdeISO: string; hastaISO: string }`
  - `formatearFechaHoraRD(iso: string): string`
  - `formatearFechaRD(iso: string): string`

- [ ] **Paso 1: Instalar Vitest y crear su configuración**

```bash
npm install -D vitest
```

Crea `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
    test: {
        environment: 'node',
        include: ['lib/**/*.test.ts', 'lib/**/*.test.tsx'],
    },
    resolve: {
        alias: { '@': path.resolve(__dirname, '.') },
    },
})
```

En `package.json`, añade a `scripts`:

```json
"test": "vitest run",
"test:watch": "vitest",
"typecheck": "tsc --noEmit"
```

- [ ] **Paso 2: Escribir las pruebas que fallan**

Crea `lib/utils/fecha-rd.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { rangoRDaUTC, formatearFechaHoraRD, formatearFechaRD, TZ_RD } from './fecha-rd'

describe('TZ_RD', () => {
    it('apunta a la zona horaria de República Dominicana', () => {
        expect(TZ_RD).toBe('America/Santo_Domingo')
    })
})

describe('rangoRDaUTC', () => {
    it('convierte el inicio del día RD al instante UTC correcto', () => {
        // RD es UTC-4 todo el año: 00:00 del 29 en RD son las 04:00 UTC del 29
        const { desdeISO } = rangoRDaUTC('2026-07-29', '2026-07-29')
        expect(desdeISO).toBe('2026-07-29T04:00:00.000Z')
    })

    it('convierte el final del día RD al instante UTC correcto', () => {
        // 23:59:59.999 del 29 en RD son las 03:59:59.999 UTC del 30
        const { hastaISO } = rangoRDaUTC('2026-07-29', '2026-07-29')
        expect(hastaISO).toBe('2026-07-30T03:59:59.999Z')
    })

    it('incluye un boleto emitido a las 9 PM hora RD en el día correcto', () => {
        // 2026-07-30T01:30:00Z son las 9:30 PM del 29 en RD
        const emitido = new Date('2026-07-30T01:30:00.000Z')
        const { desdeISO, hastaISO } = rangoRDaUTC('2026-07-29', '2026-07-29')

        expect(emitido >= new Date(desdeISO)).toBe(true)
        expect(emitido <= new Date(hastaISO)).toBe(true)
    })

    it('excluye un boleto emitido a las 00:30 hora RD del día siguiente', () => {
        // 2026-07-30T04:30:00Z son las 00:30 AM del 30 en RD
        const emitido = new Date('2026-07-30T04:30:00.000Z')
        const { hastaISO } = rangoRDaUTC('2026-07-29', '2026-07-29')

        expect(emitido > new Date(hastaISO)).toBe(true)
    })

    it('soporta rangos de varios días', () => {
        const { desdeISO, hastaISO } = rangoRDaUTC('2026-07-01', '2026-07-31')
        expect(desdeISO).toBe('2026-07-01T04:00:00.000Z')
        expect(hastaISO).toBe('2026-08-01T03:59:59.999Z')
    })
})

describe('formatearFechaHoraRD', () => {
    it('muestra la fecha en hora RD, no en UTC', () => {
        // Este instante ya es día 30 en UTC pero sigue siendo día 29 en RD
        expect(formatearFechaHoraRD('2026-07-30T01:30:00.000Z')).toContain('29/07/2026')
    })
})

describe('formatearFechaRD', () => {
    it('formatea solo la fecha en hora RD', () => {
        expect(formatearFechaRD('2026-07-30T01:30:00.000Z')).toBe('29/07/2026')
    })
})
```

- [ ] **Paso 3: Ejecutar las pruebas y confirmar que fallan**

Ejecuta: `npm test`
Esperado: FALLA con `Failed to resolve import "./fecha-rd"`.

- [ ] **Paso 4: Implementar el módulo**

Crea `lib/utils/fecha-rd.ts`:

```ts
/**
 * Utilidades de fecha ancladas a la zona horaria de República Dominicana.
 *
 * Todo cálculo de fechas de negocio (rangos de sorteo, "hoy", fechas impresas)
 * debe pasar por aquí. RD es UTC-4 todo el año, pero el desplazamiento se
 * calcula dinámicamente con Intl en lugar de asumirse, para que el código
 * siga siendo correcto si eso cambiara.
 */

export const TZ_RD = 'America/Santo_Domingo'

/**
 * Desplazamiento de RD respecto a UTC, en minutos, para un instante dado.
 * Devuelve un número negativo (RD va por detrás de UTC).
 */
function offsetMinutosRD(instante: Date): number {
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: TZ_RD,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    })

    const partes: Record<string, string> = {}
    for (const parte of dtf.formatToParts(instante)) {
        if (parte.type !== 'literal') partes[parte.type] = parte.value
    }

    const comoSiFueraUTC = Date.UTC(
        Number(partes.year),
        Number(partes.month) - 1,
        Number(partes.day),
        Number(partes.hour),
        Number(partes.minute),
        Number(partes.second),
    )

    const instanteSinMs = Math.floor(instante.getTime() / 1000) * 1000
    return (comoSiFueraUTC - instanteSinMs) / 60_000
}

/**
 * Convierte una hora de pared de RD al instante UTC equivalente.
 * Itera dos veces para converger si el desplazamiento cambiara en la frontera.
 */
function instanteRDaUTC(
    fecha: string,
    hora: number,
    minuto: number,
    segundo: number,
    ms: number,
): Date {
    const [anio, mes, dia] = fecha.split('-').map(Number)
    const comoUTC = Date.UTC(anio, mes - 1, dia, hora, minuto, segundo, ms)

    let t = comoUTC
    for (let i = 0; i < 2; i++) {
        t = comoUTC - offsetMinutosRD(new Date(t)) * 60_000
    }
    return new Date(t)
}

/** Fecha de hoy en RD, en formato 'YYYY-MM-DD'. */
export function hoyRD(): string {
    // 'en-CA' produce YYYY-MM-DD de forma estable
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ_RD,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date())
}

/**
 * Convierte un rango de fechas RD (inclusivo en ambos extremos) al rango de
 * instantes UTC que hay que usar al consultar columnas `timestamptz`.
 */
export function rangoRDaUTC(
    desde: string,
    hasta: string,
): { desdeISO: string; hastaISO: string } {
    return {
        desdeISO: instanteRDaUTC(desde, 0, 0, 0, 0).toISOString(),
        hastaISO: instanteRDaUTC(hasta, 23, 59, 59, 999).toISOString(),
    }
}

/** Formatea un instante ISO como 'DD/MM/YYYY hh:mm a. m.' en hora RD. */
export function formatearFechaHoraRD(iso: string): string {
    return new Intl.DateTimeFormat('es-DO', {
        timeZone: TZ_RD,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    }).format(new Date(iso))
}

/** Formatea un instante ISO como 'DD/MM/YYYY' en hora RD. */
export function formatearFechaRD(iso: string): string {
    return new Intl.DateTimeFormat('es-DO', {
        timeZone: TZ_RD,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    }).format(new Date(iso))
}
```

- [ ] **Paso 5: Ejecutar las pruebas y confirmar que pasan**

Ejecuta: `npm test`
Esperado: 8 pruebas en verde.

Ejecuta: `npx tsc --noEmit`
Esperado: sin errores nuevos.

- [ ] **Paso 6: Commit**

```bash
git add vitest.config.ts package.json package-lock.json lib/utils/fecha-rd.ts lib/utils/fecha-rd.test.ts
git commit -m "feat: utilidades de fecha en hora RD con pruebas"
```

---

## Tarea 2: Migración base del módulo de boletería

Crea todas las tablas del módulo de una vez. Las tablas de sorteo se crean aquí aunque su lógica llegue en el Plan 3, porque `tickets.sorteo_id` las referencia.

**Files:**
- Create: `supabase/migrations/20260729_01_boleteria_base.sql`
- Create: `lib/types/tickets.ts`
- Modify: `lib/types/index.ts`

**Interfaces:**
- Consumes: nada
- Produces: tablas `sucursales`, `estaciones_impresion`, `configuracion_ticket`, `sorteos`, `tickets`, `ticket_eventos`, `print_jobs`, `sorteo_ejecuciones`, `sorteo_participantes`, `sorteo_ganadores`; secuencia `tickets_numero_huerfano_seq`; tipos TS `Sucursal`, `EstacionImpresion`, `ConfiguracionTicket`, `Sorteo`, `Ticket`, `TicketSnapshot`, `TicketEvento`, `PrintJob`

- [ ] **Paso 1: Escribir la migración**

Crea `supabase/migrations/20260729_01_boleteria_base.sql`:

```sql
-- ══════════════════════════════════════════════════════════════
-- Migración: Módulo de Boletería — tablas base
-- Ejecutar en: Supabase Studio → SQL Editor
-- ══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ─── sucursales ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sucursales (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre     TEXT NOT NULL,
  direccion  TEXT,
  telefono   TEXT,
  activo     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS sucursal_id UUID
  REFERENCES public.sucursales(id) ON DELETE SET NULL;

-- ─── estaciones_impresion ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.estaciones_impresion (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sucursal_id      UUID NOT NULL REFERENCES public.sucursales(id) ON DELETE CASCADE,
  nombre           TEXT NOT NULL,
  token_hash       TEXT NOT NULL,
  token_prefijo    TEXT NOT NULL,
  impresora_ip     TEXT NOT NULL,
  impresora_port   INTEGER NOT NULL DEFAULT 9100,
  ancho_cols       INTEGER NOT NULL DEFAULT 48,
  codepage         TEXT NOT NULL DEFAULT 'cp850',
  activo           BOOLEAN NOT NULL DEFAULT TRUE,
  ultimo_heartbeat TIMESTAMPTZ,
  ultima_ip_agente TEXT,
  version_agente   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_estacion_activa_por_sucursal
  ON public.estaciones_impresion(sucursal_id) WHERE activo;
CREATE UNIQUE INDEX IF NOT EXISTS uq_estacion_token
  ON public.estaciones_impresion(token_hash);

-- ─── configuracion_ticket (fila única) ────────────────────────
CREATE TABLE IF NOT EXISTS public.configuracion_ticket (
  id                 BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  nombre_comercial   TEXT NOT NULL DEFAULT 'Inversiones Cordero',
  rnc                TEXT,
  direccion          TEXT,
  telefono           TEXT,
  logo_url           TEXT,
  texto_legal        TEXT,
  url_terminos       TEXT,
  prefijo_numeracion TEXT NOT NULL DEFAULT 'BOL',
  pie_impresion      TEXT,
  modo_adjunto       TEXT NOT NULL DEFAULT 'base64'
                       CHECK (modo_adjunto IN ('base64','url','ambos','ninguno')),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by         UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

INSERT INTO public.configuracion_ticket (id) VALUES (TRUE)
ON CONFLICT (id) DO NOTHING;

-- ─── sorteos ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sorteos (
  id                         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre                     TEXT NOT NULL,
  descripcion                TEXT,
  premio                     TEXT,
  fecha_inicio               DATE NOT NULL,
  fecha_fin                  DATE NOT NULL,
  estado                     TEXT NOT NULL DEFAULT 'borrador'
                               CHECK (estado IN ('borrador','activo','cerrado')),
  prefijo                    TEXT NOT NULL,
  ultimo_numero              INTEGER NOT NULL DEFAULT 0,
  cantidad_ganadores_default INTEGER NOT NULL DEFAULT 1,
  creado_por                 UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_sorteo_rango CHECK (fecha_fin >= fecha_inicio)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sorteo_prefijo ON public.sorteos(prefijo);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sorteo_activo
  ON public.sorteos((estado)) WHERE estado = 'activo';

-- ─── secuencia para boletos sin sorteo ────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.tickets_numero_huerfano_seq;

-- ─── tickets ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tickets (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  numero            INTEGER NOT NULL,
  numero_formateado TEXT NOT NULL,
  sorteo_id         UUID REFERENCES public.sorteos(id) ON DELETE SET NULL,
  cliente_id        UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  pago_id           UUID REFERENCES public.pagos(id) ON DELETE SET NULL,
  deuda_id          UUID REFERENCES public.deudas(id) ON DELETE SET NULL,
  origen            TEXT NOT NULL CHECK (origen IN ('automatico','manual')),
  motivo            TEXT,
  estado            TEXT NOT NULL DEFAULT 'valido'
                      CHECK (estado IN ('valido','anulado')),
  anulado_por       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  anulado_at        TIMESTAMPTZ,
  motivo_anulacion  TEXT,
  token_publico     TEXT NOT NULL,
  snapshot          JSONB NOT NULL,
  emitido_por       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  emitido_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  veces_enviado     INTEGER NOT NULL DEFAULT 0,
  veces_impreso     INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_ticket_motivo_manual
    CHECK (origen = 'automatico' OR (motivo IS NOT NULL AND btrim(motivo) <> ''))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tickets_token
  ON public.tickets(token_publico);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tickets_numero_fmt
  ON public.tickets(numero_formateado);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tickets_numero_sorteo
  ON public.tickets(sorteo_id, numero) WHERE sorteo_id IS NOT NULL;
-- Idempotencia: un solo boleto vigente por pago
CREATE UNIQUE INDEX IF NOT EXISTS uq_tickets_pago
  ON public.tickets(pago_id) WHERE pago_id IS NOT NULL AND estado <> 'anulado';
CREATE INDEX IF NOT EXISTS idx_tickets_cliente ON public.tickets(cliente_id);
CREATE INDEX IF NOT EXISTS idx_tickets_emitido_at ON public.tickets(emitido_at);
CREATE INDEX IF NOT EXISTS idx_tickets_sorteo_validos
  ON public.tickets(sorteo_id, emitido_at) WHERE estado = 'valido';

-- ─── ticket_eventos ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ticket_eventos (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id      UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  tipo           TEXT NOT NULL CHECK (tipo IN
                   ('emitido','enviado_wa','impreso','anulado','asignado_sorteo')),
  estado         TEXT NOT NULL DEFAULT 'ok' CHECK (estado IN ('ok','error')),
  es_copia       BOOLEAN NOT NULL DEFAULT FALSE,
  detalle        TEXT,
  payload        JSONB,
  respuesta_http INTEGER,
  respuesta_body TEXT,
  usuario_id     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_eventos_ticket
  ON public.ticket_eventos(ticket_id, created_at DESC);

-- ─── print_jobs ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.print_jobs (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id      UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  sucursal_id    UUID NOT NULL REFERENCES public.sucursales(id) ON DELETE CASCADE,
  estado         TEXT NOT NULL DEFAULT 'pendiente'
                   CHECK (estado IN ('pendiente','reclamado','impreso','error','cancelado')),
  es_copia       BOOLEAN NOT NULL DEFAULT FALSE,
  payload_escpos TEXT,
  preview_texto  TEXT,
  intentos       INTEGER NOT NULL DEFAULT 0,
  max_intentos   INTEGER NOT NULL DEFAULT 3,
  estacion_id    UUID REFERENCES public.estaciones_impresion(id) ON DELETE SET NULL,
  claimed_at     TIMESTAMPTZ,
  impreso_at     TIMESTAMPTZ,
  error_mensaje  TEXT,
  solicitado_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_print_jobs_cola
  ON public.print_jobs(sucursal_id, estado, created_at)
  WHERE estado IN ('pendiente','reclamado');

-- ─── sorteo_ejecuciones / participantes / ganadores ───────────
CREATE TABLE IF NOT EXISTS public.sorteo_ejecuciones (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sorteo_id          UUID NOT NULL REFERENCES public.sorteos(id) ON DELETE CASCADE,
  rango_desde        DATE NOT NULL,
  rango_hasta        DATE NOT NULL,
  cantidad_ganadores INTEGER NOT NULL CHECK (cantidad_ganadores > 0),
  semilla            TEXT NOT NULL,
  algoritmo          TEXT NOT NULL DEFAULT 'mulberry32-fisher-yates-v1',
  pool_count         INTEGER NOT NULL,
  pool_hash          TEXT NOT NULL,
  vigente            BOOLEAN NOT NULL DEFAULT TRUE,
  ejecutado_por      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ejecutado_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notas              TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ejecucion_vigente
  ON public.sorteo_ejecuciones(sorteo_id) WHERE vigente;

CREATE TABLE IF NOT EXISTS public.sorteo_participantes (
  ejecucion_id UUID NOT NULL REFERENCES public.sorteo_ejecuciones(id) ON DELETE CASCADE,
  ticket_id    UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  orden        INTEGER NOT NULL,
  PRIMARY KEY (ejecucion_id, ticket_id)
);

CREATE TABLE IF NOT EXISTS public.sorteo_ganadores (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ejecucion_id UUID NOT NULL REFERENCES public.sorteo_ejecuciones(id) ON DELETE CASCADE,
  ticket_id    UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  cliente_id   UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  posicion     INTEGER NOT NULL,
  premio       TEXT,
  snapshot     JSONB NOT NULL,
  entregado    BOOLEAN NOT NULL DEFAULT FALSE,
  entregado_at TIMESTAMPTZ,
  notas        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ganador_posicion
  ON public.sorteo_ganadores(ejecucion_id, posicion);
-- Regla de negocio: un cliente no gana dos veces en la misma ejecución
CREATE UNIQUE INDEX IF NOT EXISTS uq_ganador_cliente
  ON public.sorteo_ganadores(ejecucion_id, cliente_id);

-- ─── triggers de updated_at ───────────────────────────────────
CREATE OR REPLACE TRIGGER trg_sucursales_updated_at
  BEFORE UPDATE ON public.sucursales
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER trg_estaciones_updated_at
  BEFORE UPDATE ON public.estaciones_impresion
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER trg_sorteos_updated_at
  BEFORE UPDATE ON public.sorteos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── habilitar RLS (las policies llegan en la migración 02) ───
ALTER TABLE public.sucursales           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estaciones_impresion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuracion_ticket ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sorteos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_eventos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_jobs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sorteo_ejecuciones   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sorteo_participantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sorteo_ganadores     ENABLE ROW LEVEL SECURITY;
```

- [ ] **Paso 2: Aplicar la migración**

Abre Supabase Studio → SQL Editor, pega el contenido completo y ejecútalo.

Verifica con:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('sucursales','estaciones_impresion','configuracion_ticket',
                     'sorteos','tickets','ticket_eventos','print_jobs',
                     'sorteo_ejecuciones','sorteo_participantes','sorteo_ganadores')
ORDER BY table_name;
```

Esperado: 10 filas.

```sql
SELECT count(*) FROM public.configuracion_ticket;
```

Esperado: `1`.

- [ ] **Paso 3: Crear los tipos de TypeScript**

Crea `lib/types/tickets.ts`:

```ts
import type { Cliente, Profile } from './index'

// ─── ENUMS ────────────────────────────────────────────────────

export type EstadoTicket = 'valido' | 'anulado'
export type OrigenTicket = 'automatico' | 'manual'
export type EstadoSorteo = 'borrador' | 'activo' | 'cerrado'
export type ModoAdjunto = 'base64' | 'url' | 'ambos' | 'ninguno'
export type EstadoPrintJob =
    | 'pendiente' | 'reclamado' | 'impreso' | 'error' | 'cancelado'
export type TipoTicketEvento =
    | 'emitido' | 'enviado_wa' | 'impreso' | 'anulado' | 'asignado_sorteo'

// ─── SNAPSHOT ─────────────────────────────────────────────────

/**
 * Datos congelados en el momento de emitir el boleto. El PDF y la tirilla
 * impresa se generan SIEMPRE desde aquí, nunca desde las tablas vivas, para
 * que un boleto ya entregado no cambie si luego se corrigen los datos.
 */
export interface TicketSnapshot {
    cliente: {
        id: string
        nombre: string
        apellido: string
        telefono: string | null
        dni_ruc: string | null
    }
    sorteo: {
        id: string
        nombre: string
        premio: string | null
        fecha_fin: string
    } | null
    negocio: {
        nombre_comercial: string
        rnc: string | null
        direccion: string | null
        telefono: string | null
        texto_legal: string | null
        url_terminos: string | null
        pie_impresion: string | null
        logo_url: string | null
    }
    emitido_at_rd: string
    origen: OrigenTicket
    version_snapshot: number
}

// ─── ENTIDADES ────────────────────────────────────────────────

export interface Sucursal {
    id: string
    nombre: string
    direccion: string | null
    telefono: string | null
    activo: boolean
    created_at: string
    updated_at: string
}

export interface EstacionImpresion {
    id: string
    sucursal_id: string
    nombre: string
    token_prefijo: string
    impresora_ip: string
    impresora_port: number
    ancho_cols: number
    codepage: string
    activo: boolean
    ultimo_heartbeat: string | null
    ultima_ip_agente: string | null
    version_agente: string | null
    created_at: string
    updated_at: string
    sucursal?: Sucursal
}

export interface ConfiguracionTicket {
    id: boolean
    nombre_comercial: string
    rnc: string | null
    direccion: string | null
    telefono: string | null
    logo_url: string | null
    texto_legal: string | null
    url_terminos: string | null
    prefijo_numeracion: string
    pie_impresion: string | null
    modo_adjunto: ModoAdjunto
    updated_at: string
    updated_by: string | null
}

export interface Sorteo {
    id: string
    nombre: string
    descripcion: string | null
    premio: string | null
    fecha_inicio: string
    fecha_fin: string
    estado: EstadoSorteo
    prefijo: string
    ultimo_numero: number
    cantidad_ganadores_default: number
    creado_por: string | null
    created_at: string
    updated_at: string
}

export interface Ticket {
    id: string
    numero: number
    numero_formateado: string
    sorteo_id: string | null
    cliente_id: string
    pago_id: string | null
    deuda_id: string | null
    origen: OrigenTicket
    motivo: string | null
    estado: EstadoTicket
    anulado_por: string | null
    anulado_at: string | null
    motivo_anulacion: string | null
    token_publico: string
    snapshot: TicketSnapshot
    emitido_por: string | null
    emitido_at: string
    veces_enviado: number
    veces_impreso: number
    created_at: string
    // Joins opcionales
    cliente?: Cliente
    sorteo?: Sorteo
    emisor?: Profile
}

export interface TicketEvento {
    id: string
    ticket_id: string
    tipo: TipoTicketEvento
    estado: 'ok' | 'error'
    es_copia: boolean
    detalle: string | null
    payload: Record<string, unknown> | null
    respuesta_http: number | null
    respuesta_body: string | null
    usuario_id: string | null
    created_at: string
    usuario?: Profile
}

export interface PrintJob {
    id: string
    ticket_id: string
    sucursal_id: string
    estado: EstadoPrintJob
    es_copia: boolean
    payload_escpos: string | null
    preview_texto: string | null
    intentos: number
    max_intentos: number
    estacion_id: string | null
    claimed_at: string | null
    impreso_at: string | null
    error_mensaje: string | null
    solicitado_por: string | null
    created_at: string
}

// ─── PAYLOAD DEL WEBHOOK DE BOLETOS ───────────────────────────

export interface TicketWebhookPayload {
    evento: 'ticket_emitido'
    timestamp: string
    enviado_por: 'sistema' | 'manual'
    reenvio: boolean
    cliente: {
        id: string
        nombre: string
        apellido: string
        telefono: string
    }
    ticket: {
        id: string
        numero: string
        sorteo: string | null
        emitido_at: string
    }
    mensaje: string
    url_terminos: string | null
    url_publica: string | null
    adjunto: { tipo: 'pdf'; nombre: string; base64: string } | null
}

// ─── ETIQUETAS ────────────────────────────────────────────────

export const ESTADO_TICKET_LABELS: Record<EstadoTicket, string> = {
    valido: 'Válido',
    anulado: 'Anulado',
}

export const ESTADO_TICKET_COLORS: Record<EstadoTicket, string> = {
    valido: 'bg-green-500/20 text-green-300',
    anulado: 'bg-red-500/20 text-red-300',
}

export const ORIGEN_TICKET_LABELS: Record<OrigenTicket, string> = {
    automatico: 'Automático',
    manual: 'Manual',
}

export const ESTADO_SORTEO_LABELS: Record<EstadoSorteo, string> = {
    borrador: 'Borrador',
    activo: 'Activo',
    cerrado: 'Cerrado',
}
```

- [ ] **Paso 4: Reexportar desde el índice de tipos**

Al final de `lib/types/index.ts`, añade:

```ts
// ─── MÓDULO DE BOLETERÍA ─────────────────────────────────────
export * from './tickets'
```

- [ ] **Paso 5: Verificar tipos**

Ejecuta: `npx tsc --noEmit`
Esperado: sin errores nuevos.

- [ ] **Paso 6: Commit**

```bash
git add supabase/migrations/20260729_01_boleteria_base.sql lib/types/tickets.ts lib/types/index.ts
git commit -m "feat: tablas y tipos base del módulo de boletería"
```

---

## Tarea 3: Permisos granulares y helper de fusión

Corrige el defecto L6 del spec: hoy `app-sidebar.tsx:58` hace `profile.permisos ?? {}` sin fusionar los valores por defecto, así que cualquier permiso nuevo queda denegado para los agentes que ya tienen permisos guardados.

**Files:**
- Create: `supabase/migrations/20260729_02_permisos_boleteria.sql`
- Create: `lib/utils/permisos.ts`
- Test: `lib/utils/permisos.test.ts`
- Modify: `lib/types/index.ts:8-19` (interfaz `PermisosAgente`), `:57-68` (`DEFAULT_PERMISOS_AGENTE`)
- Modify: `components/layout/app-sidebar.tsx:32-65`

**Interfaces:**
- Consumes: tablas de la Tarea 2
- Produces:
  - `getPermisos(profile): PermisosAgente`
  - `tienePermiso(profile, permiso): boolean`
  - Función SQL `public.tiene_permiso(TEXT) RETURNS BOOLEAN`
  - Policies RLS de `tickets`, `ticket_eventos`, `sucursales`, `configuracion_ticket`, `sorteos`

- [ ] **Paso 1: Escribir las pruebas que fallan**

Crea `lib/utils/permisos.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getPermisos, tienePermiso } from './permisos'
import { DEFAULT_PERMISOS_AGENTE } from '@/lib/types'

describe('getPermisos', () => {
    it('da todos los permisos al admin, aunque su columna esté vacía', () => {
        const permisos = getPermisos({ rol: 'admin', permisos: null })
        for (const clave of Object.keys(DEFAULT_PERMISOS_AGENTE)) {
            expect(permisos[clave as keyof typeof permisos]).toBe(true)
        }
    })

    it('usa los valores por defecto cuando el agente no tiene permisos guardados', () => {
        const permisos = getPermisos({ rol: 'agente', permisos: null })
        expect(permisos).toEqual(DEFAULT_PERMISOS_AGENTE)
    })

    it('rellena con los valores por defecto las claves que faltan', () => {
        // Un agente guardado antes de que existieran los permisos de boletos
        const permisos = getPermisos({
            rol: 'agente',
            permisos: { ver_logs: true, ver_webhooks: false } as never,
        })
        expect(permisos.ver_tickets).toBe(DEFAULT_PERMISOS_AGENTE.ver_tickets)
        expect(permisos.ver_logs).toBe(true)
        expect(permisos.ver_webhooks).toBe(false)
    })

    it('respeta un false explícito por encima del valor por defecto', () => {
        const permisos = getPermisos({
            rol: 'agente',
            permisos: { ver_tickets: false } as never,
        })
        expect(permisos.ver_tickets).toBe(false)
    })
})

describe('tienePermiso', () => {
    it('devuelve true para el admin en cualquier permiso', () => {
        expect(tienePermiso({ rol: 'admin', permisos: null }, 'realizar_sorteo')).toBe(true)
    })

    it('devuelve false para un agente sin el permiso', () => {
        expect(tienePermiso({ rol: 'agente', permisos: null }, 'realizar_sorteo')).toBe(false)
    })
})
```

- [ ] **Paso 2: Ejecutar y confirmar que falla**

Ejecuta: `npm test -- permisos`
Esperado: FALLA con `Failed to resolve import "./permisos"`.

- [ ] **Paso 3: Añadir los permisos nuevos a los tipos**

En `lib/types/index.ts`, dentro de `interface PermisosAgente` añade:

```ts
    ver_tickets: boolean
    generar_ticket_manual: boolean
    imprimir_ticket: boolean
    ver_sorteos: boolean
    realizar_sorteo: boolean
```

Y en `DEFAULT_PERMISOS_AGENTE` añade:

```ts
    ver_tickets: true,
    generar_ticket_manual: true,
    imprimir_ticket: true,
    ver_sorteos: false,
    realizar_sorteo: false,
```

- [ ] **Paso 4: Implementar el helper**

Crea `lib/utils/permisos.ts`:

```ts
import {
    DEFAULT_PERMISOS_AGENTE,
    type PermisosAgente,
    type Rol,
} from '@/lib/types'

type PerfilMinimo = {
    rol: Rol
    permisos?: Partial<PermisosAgente> | null
}

/**
 * Devuelve los permisos efectivos de un perfil.
 *
 * El admin siempre los tiene todos. Para agentes, los valores guardados se
 * fusionan SOBRE los valores por defecto: así, al añadir un permiso nuevo al
 * sistema, los agentes ya existentes lo heredan en vez de quedar bloqueados.
 */
export function getPermisos(profile: PerfilMinimo): PermisosAgente {
    if (profile.rol === 'admin') {
        const todos = {} as PermisosAgente
        for (const clave of Object.keys(DEFAULT_PERMISOS_AGENTE) as (keyof PermisosAgente)[]) {
            todos[clave] = true
        }
        return todos
    }
    return { ...DEFAULT_PERMISOS_AGENTE, ...(profile.permisos ?? {}) }
}

export function tienePermiso(
    profile: PerfilMinimo,
    permiso: keyof PermisosAgente,
): boolean {
    return getPermisos(profile)[permiso] === true
}
```

- [ ] **Paso 5: Ejecutar las pruebas y confirmar que pasan**

Ejecuta: `npm test -- permisos`
Esperado: 6 pruebas en verde.

- [ ] **Paso 6: Escribir la migración de permisos y RLS**

Crea `supabase/migrations/20260729_02_permisos_boleteria.sql`:

```sql
-- ══════════════════════════════════════════════════════════════
-- Migración: Permisos de boletería, helper SQL y policies RLS
-- ══════════════════════════════════════════════════════════════

-- ─── Helper: consultar un permiso granular ────────────────────
CREATE OR REPLACE FUNCTION public.tiene_permiso(p_permiso TEXT)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT rol = 'admin' OR COALESCE((permisos ->> p_permiso)::BOOLEAN, FALSE)
       FROM public.profiles WHERE id = auth.uid()),
    FALSE
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public;

-- ─── Rellenar los permisos nuevos en los perfiles existentes ──
-- Los agentes que ya tienen objeto de permisos reciben los defaults del
-- módulo de boletos; sin esto, las policies los bloquearían aunque la capa
-- de aplicación (getPermisos) sí se los conceda.
UPDATE public.profiles
SET permisos = COALESCE(permisos, '{}'::jsonb) || jsonb_build_object(
      'ver_tickets',           COALESCE((permisos ->> 'ver_tickets')::BOOLEAN, TRUE),
      'generar_ticket_manual', COALESCE((permisos ->> 'generar_ticket_manual')::BOOLEAN, TRUE),
      'imprimir_ticket',       COALESCE((permisos ->> 'imprimir_ticket')::BOOLEAN, TRUE),
      'ver_sorteos',           COALESCE((permisos ->> 'ver_sorteos')::BOOLEAN, FALSE),
      'realizar_sorteo',       COALESCE((permisos ->> 'realizar_sorteo')::BOOLEAN, FALSE)
    )
WHERE rol = 'agente';

-- ─── Policies: sucursales ─────────────────────────────────────
CREATE POLICY "sucursales: lectura autenticados"
  ON public.sucursales FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "sucursales: escritura admin"
  ON public.sucursales FOR ALL
  USING (public.get_my_rol() = 'admin')
  WITH CHECK (public.get_my_rol() = 'admin');

-- ─── Policies: estaciones_impresion ───────────────────────────
CREATE POLICY "estaciones: lectura autenticados"
  ON public.estaciones_impresion FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "estaciones: escritura admin"
  ON public.estaciones_impresion FOR ALL
  USING (public.get_my_rol() = 'admin')
  WITH CHECK (public.get_my_rol() = 'admin');

-- ─── Policies: configuracion_ticket ───────────────────────────
CREATE POLICY "config_ticket: lectura autenticados"
  ON public.configuracion_ticket FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "config_ticket: escritura admin"
  ON public.configuracion_ticket FOR ALL
  USING (public.get_my_rol() = 'admin')
  WITH CHECK (public.get_my_rol() = 'admin');

-- ─── Policies: sorteos ────────────────────────────────────────
CREATE POLICY "sorteos: lectura con permiso"
  ON public.sorteos FOR SELECT
  USING (public.tiene_permiso('ver_sorteos'));

CREATE POLICY "sorteos: escritura con permiso"
  ON public.sorteos FOR ALL
  USING (public.tiene_permiso('realizar_sorteo'))
  WITH CHECK (public.tiene_permiso('realizar_sorteo'));

-- ─── Policies: tickets ────────────────────────────────────────
-- Mismo criterio de visibilidad que `pagos`: el agente ve los boletos de los
-- clientes que tiene asignados.
CREATE POLICY "tickets: admin acceso total"
  ON public.tickets FOR ALL
  USING (public.get_my_rol() = 'admin')
  WITH CHECK (public.get_my_rol() = 'admin');

CREATE POLICY "tickets: agente ve los de sus clientes"
  ON public.tickets FOR SELECT
  USING (
    public.tiene_permiso('ver_tickets')
    AND EXISTS (
      SELECT 1 FROM public.clientes c
      WHERE c.id = cliente_id AND c.agente_id = auth.uid()
    )
  );

-- ─── Policies: ticket_eventos ─────────────────────────────────
CREATE POLICY "ticket_eventos: admin acceso total"
  ON public.ticket_eventos FOR ALL
  USING (public.get_my_rol() = 'admin')
  WITH CHECK (public.get_my_rol() = 'admin');

CREATE POLICY "ticket_eventos: sigue la visibilidad del boleto"
  ON public.ticket_eventos FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tickets t
      JOIN public.clientes c ON c.id = t.cliente_id
      WHERE t.id = ticket_id AND c.agente_id = auth.uid()
    )
  );

-- ─── Policies: print_jobs ─────────────────────────────────────
-- El ciclo de vida (reclamo, ack, reintentos) lo maneja la API /api/print/*
-- con el cliente admin. Las sesiones de usuario solo encolan y leen.
CREATE POLICY "print_jobs: admin acceso total"
  ON public.print_jobs FOR ALL
  USING (public.get_my_rol() = 'admin')
  WITH CHECK (public.get_my_rol() = 'admin');

CREATE POLICY "print_jobs: encolar con permiso"
  ON public.print_jobs FOR INSERT
  WITH CHECK (public.tiene_permiso('imprimir_ticket'));

CREATE POLICY "print_jobs: ver los propios"
  ON public.print_jobs FOR SELECT
  USING (solicitado_por = auth.uid());

-- ─── Policies: sorteo_ejecuciones / participantes / ganadores ─
CREATE POLICY "sorteo_ejecuciones: lectura con permiso"
  ON public.sorteo_ejecuciones FOR SELECT
  USING (public.tiene_permiso('ver_sorteos'));

CREATE POLICY "sorteo_ejecuciones: escritura con permiso"
  ON public.sorteo_ejecuciones FOR ALL
  USING (public.tiene_permiso('realizar_sorteo'))
  WITH CHECK (public.tiene_permiso('realizar_sorteo'));

CREATE POLICY "sorteo_participantes: lectura con permiso"
  ON public.sorteo_participantes FOR SELECT
  USING (public.tiene_permiso('ver_sorteos'));

CREATE POLICY "sorteo_participantes: escritura con permiso"
  ON public.sorteo_participantes FOR ALL
  USING (public.tiene_permiso('realizar_sorteo'))
  WITH CHECK (public.tiene_permiso('realizar_sorteo'));

CREATE POLICY "sorteo_ganadores: lectura con permiso"
  ON public.sorteo_ganadores FOR SELECT
  USING (public.tiene_permiso('ver_sorteos'));

CREATE POLICY "sorteo_ganadores: escritura con permiso"
  ON public.sorteo_ganadores FOR ALL
  USING (public.tiene_permiso('realizar_sorteo'))
  WITH CHECK (public.tiene_permiso('realizar_sorteo'));
```

- [ ] **Paso 7: Aplicar la migración y verificar**

Ejecuta el SQL en Supabase Studio. Luego verifica:

```sql
SELECT public.tiene_permiso('ver_tickets');
```

Esperado: `true` o `false` sin error (el valor depende del usuario de la sesión del editor; lo importante es que la función exista y no lance).

```sql
SELECT id, rol, permisos ->> 'ver_tickets' AS ver_tickets
FROM public.profiles WHERE rol = 'agente';
```

Esperado: todos los agentes con la clave presente.

- [ ] **Paso 8: Usar el helper en el sidebar**

En `components/layout/app-sidebar.tsx`:

Añade el import:

```ts
import { getPermisos } from '@/lib/utils/permisos'
```

Añade a `ALL_NAV`, después de la entrada de `/cuentas`:

```ts
    { href: '/tickets', label: 'Boletos', icon: Ticket, permiso: 'ver_tickets' },
    { href: '/sorteos', label: 'Sorteos', icon: Gift, permiso: 'ver_sorteos' },
```

Importa los iconos nuevos desde `lucide-react`: `Ticket`, `Gift`.

Reemplaza las líneas 57-65 por:

```ts
    const isAdmin = profile.rol === 'admin'
    const permisos = getPermisos(profile)

    const navItems = ALL_NAV.filter(item => {
        if (item.permiso === null) return true          // Siempre visible
        if (item.permiso === 'admin_only') return isAdmin
        return permisos[item.permiso as keyof typeof permisos] === true
    })
```

Nota: la rama `if (isAdmin) return true` desaparece porque `getPermisos` ya devuelve todo `true` para el admin.

- [ ] **Paso 9: Verificar**

Ejecuta: `npm test && npx tsc --noEmit`
Esperado: todo en verde.

Levanta el servidor (`npm run dev`), entra como admin y confirma que aparecen "Boletos" y "Sorteos" en el sidebar. Ambas rutas darán 404 todavía — es lo esperado.

- [ ] **Paso 10: Commit**

```bash
git add supabase/migrations/20260729_02_permisos_boleteria.sql lib/utils/permisos.ts lib/utils/permisos.test.ts lib/types/index.ts components/layout/app-sidebar.tsx
git commit -m "feat: permisos de boletería con fusión de valores por defecto"
```

---

## Tarea 4: Registro de pagos atómico

Corrige los defectos L2 y L3 del spec. Es la tarea de mayor riesgo del plan porque toca código de dinero que ya funciona en producción. Va aislada y antes de que nada dependa de ella.

**Estado actual:**
- `marcarPagoPeriodo()` (`lib/actions/deudas.ts:163-231`) inserta en `pagos` y **después** llama al RPC. Si el RPC falla, queda una fila de pago huérfana. Además duplica en JavaScript la lógica de avance de `fecha_corte` que el RPC ya tiene.
- `registrarPago()` (`lib/actions/deudas.ts:147-161`) **nunca** inserta en `pagos`.

**Cambio de comportamiento deliberado:** el avance de `fecha_corte` pasa a hacerse siempre con `INTERVAL '1 month'` de Postgres en lugar de `setMonth()` de JavaScript. Difieren a fin de mes: `setMonth()` sobre el 31 de enero da el 3 de marzo, mientras que Postgres da el 28 de febrero. El comportamiento de Postgres es el correcto.

**Files:**
- Create: `supabase/migrations/20260729_03_pagos_atomico.sql`
- Create: `supabase/tests/pagos_atomico.sql`
- Modify: `lib/actions/deudas.ts:147-231`

**Interfaces:**
- Consumes: nada
- Produces: `registrar_pago_atomico(UUID, NUMERIC, TEXT, TEXT, UUID) RETURNS JSONB` con `pago_id` en la respuesta; `registrarPago(deudaId, monto, nota?)`; `marcarPagoPeriodo(deudaId, periodo, nota?)` — ambas devuelven `{ pagoId, clienteId }`

- [ ] **Paso 1: Escribir el guion de verificación**

Crea `supabase/tests/pagos_atomico.sql`. Se ejecuta dentro de una transacción con `ROLLBACK`, así que no deja rastro.

```sql
-- ══════════════════════════════════════════════════════════════
-- Verificación manual de registrar_pago_atomico v2
-- Ejecutar completo en Supabase Studio → SQL Editor.
-- Todo ocurre dentro de una transacción que termina en ROLLBACK.
-- ══════════════════════════════════════════════════════════════
BEGIN;

DO $$
DECLARE
  v_cliente UUID;
  v_deuda   UUID;
  v_res     JSONB;
  v_pagos   INTEGER;
BEGIN
  INSERT INTO public.clientes (nombre, apellido, telefono)
  VALUES ('PruebaPago', 'Temporal', '8090000000')
  RETURNING id INTO v_cliente;

  -- Caso 1: deuda con montos
  INSERT INTO public.deudas (cliente_id, monto_original, saldo_pendiente,
                             cuota_mensual, fecha_corte, frecuencia_pago)
  VALUES (v_cliente, 10000, 10000, 2000, CURRENT_DATE, 'mensual')
  RETURNING id INTO v_deuda;

  v_res := public.registrar_pago_atomico(v_deuda, 2000, '2026-07', 'prueba', NULL);

  ASSERT (v_res ->> 'ok')::BOOLEAN, 'Caso 1: el RPC debió devolver ok';
  ASSERT (v_res ->> 'pago_id') IS NOT NULL, 'Caso 1: debió devolver pago_id';
  ASSERT (v_res ->> 'nuevo_saldo')::NUMERIC = 8000, 'Caso 1: saldo debió bajar a 8000';

  SELECT count(*) INTO v_pagos FROM public.pagos WHERE deuda_id = v_deuda;
  ASSERT v_pagos = 1, 'Caso 1: debió crearse exactamente 1 fila en pagos';

  ASSERT (SELECT fecha_corte FROM public.deudas WHERE id = v_deuda)
         = CURRENT_DATE + INTERVAL '1 month',
         'Caso 1: fecha_corte debió avanzar un mes';

  -- Caso 2: deuda sin montos (marcar como pagado)
  INSERT INTO public.deudas (cliente_id, monto_original, saldo_pendiente,
                             fecha_corte, frecuencia_pago)
  VALUES (v_cliente, 0, 0, CURRENT_DATE, 'semanal')
  RETURNING id INTO v_deuda;

  v_res := public.registrar_pago_atomico(v_deuda, 0, '2026-07-29', NULL, NULL);

  ASSERT (v_res ->> 'ok')::BOOLEAN, 'Caso 2: el RPC debió devolver ok con monto 0';

  SELECT count(*) INTO v_pagos FROM public.pagos WHERE deuda_id = v_deuda;
  ASSERT v_pagos = 1, 'Caso 2: debió crearse fila en pagos aunque el monto sea 0';

  ASSERT (SELECT fecha_corte FROM public.deudas WHERE id = v_deuda)
         = CURRENT_DATE + INTERVAL '7 days',
         'Caso 2: fecha_corte debió avanzar 7 días';

  -- Caso 3: pago que excede el saldo
  INSERT INTO public.deudas (cliente_id, monto_original, saldo_pendiente,
                             cuota_mensual, fecha_corte, frecuencia_pago)
  VALUES (v_cliente, 5000, 5000, 1000, CURRENT_DATE, 'mensual')
  RETURNING id INTO v_deuda;

  v_res := public.registrar_pago_atomico(v_deuda, 9999, '2026-07', NULL, NULL);

  ASSERT NOT (v_res ->> 'ok')::BOOLEAN, 'Caso 3: debió rechazar el pago excesivo';

  SELECT count(*) INTO v_pagos FROM public.pagos WHERE deuda_id = v_deuda;
  ASSERT v_pagos = 0, 'Caso 3: no debió quedar fila de pago huérfana';

  RAISE NOTICE 'TODAS LAS VERIFICACIONES PASARON';
END $$;

ROLLBACK;
```

- [ ] **Paso 2: Ejecutar el guion y confirmar que falla**

Ejecuta el contenido de `supabase/tests/pagos_atomico.sql` en Supabase Studio.
Esperado: FALLA en el caso 1 con un error de función inexistente
(`function public.registrar_pago_atomico(uuid, numeric, unknown, unknown, unknown) does not exist`),
porque la versión actual solo acepta dos parámetros.

- [ ] **Paso 3: Escribir la migración**

Crea `supabase/migrations/20260729_03_pagos_atomico.sql`:

```sql
-- ══════════════════════════════════════════════════════════════
-- Migración: registrar_pago_atomico v2
--   · Inserta la fila de `pagos` DENTRO de la transacción
--   · Devuelve pago_id
--   · Elimina la duplicación de la lógica de avance de fecha_corte
--     que vivía en JavaScript
-- ══════════════════════════════════════════════════════════════

-- La firma antigua se elimina para evitar ambigüedad en las llamadas.
DROP FUNCTION IF EXISTS public.registrar_pago_atomico(UUID, NUMERIC);

CREATE OR REPLACE FUNCTION public.registrar_pago_atomico(
    p_deuda_id       UUID,
    p_monto_pago     NUMERIC,
    p_periodo        TEXT DEFAULT NULL,
    p_nota           TEXT DEFAULT NULL,
    p_registrado_por UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_deuda             public.deudas%ROWTYPE;
    v_nuevo_saldo       NUMERIC;
    v_nueva_fecha_corte DATE;
    v_nuevo_estado      TEXT;
    v_nueva_etapa       TEXT;
    v_dias_atraso       INTEGER;
    v_avance_corte      BOOLEAN := FALSE;
    v_periodo           TEXT;
    v_pago_id           UUID;
BEGIN
    IF p_monto_pago < 0 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'El monto del pago no puede ser negativo');
    END IF;

    SELECT * INTO v_deuda
    FROM public.deudas
    WHERE id = p_deuda_id AND estado = 'activo'
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Deuda no encontrada o no está activa');
    END IF;

    IF v_deuda.monto_original > 0 AND p_monto_pago <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'El monto del pago debe ser mayor a 0');
    END IF;

    IF p_monto_pago > v_deuda.saldo_pendiente AND v_deuda.saldo_pendiente > 0 THEN
        RETURN jsonb_build_object('ok', false, 'error',
            'El pago (' || p_monto_pago || ') excede el saldo pendiente (' || v_deuda.saldo_pendiente || ')');
    END IF;

    v_nuevo_saldo       := GREATEST(0, v_deuda.saldo_pendiente - p_monto_pago);
    v_nueva_fecha_corte := v_deuda.fecha_corte;

    IF v_deuda.cuota_mensual IS NOT NULL
       AND p_monto_pago >= v_deuda.cuota_mensual
       AND v_nuevo_saldo > 0 THEN
        v_avance_corte := TRUE;
    ELSIF v_deuda.monto_original = 0 THEN
        v_avance_corte := TRUE;
    END IF;

    IF v_avance_corte THEN
        CASE v_deuda.frecuencia_pago
            WHEN 'semanal'   THEN v_nueva_fecha_corte := v_deuda.fecha_corte + INTERVAL '7 days';
            WHEN 'quincenal' THEN v_nueva_fecha_corte := v_deuda.fecha_corte + INTERVAL '15 days';
            WHEN 'mensual'   THEN v_nueva_fecha_corte := v_deuda.fecha_corte + INTERVAL '1 month';
        END CASE;
    END IF;

    IF v_nuevo_saldo = 0 AND v_deuda.monto_original > 0 THEN
        v_nuevo_estado := 'saldado';
        v_nueva_etapa  := 'saldado';
        v_dias_atraso  := 0;
    ELSE
        v_nuevo_estado := 'activo';
        v_dias_atraso  := GREATEST(0, CURRENT_DATE - v_nueva_fecha_corte);
        v_nueva_etapa  := public.calcular_etapa_cobranza(v_dias_atraso);
    END IF;

    UPDATE public.deudas
    SET saldo_pendiente = v_nuevo_saldo,
        fecha_corte     = v_nueva_fecha_corte,
        estado          = v_nuevo_estado,
        etapa           = v_nueva_etapa,
        dias_atraso     = v_dias_atraso,
        updated_at      = NOW()
    WHERE id = p_deuda_id;

    -- Fila de pago DENTRO de la misma transacción: si algo falla más arriba,
    -- no queda un pago huérfano (defecto L3 del diseño).
    v_periodo := COALESCE(p_periodo, to_char(CURRENT_DATE, 'YYYY-MM-DD'));

    INSERT INTO public.pagos (deuda_id, cliente_id, monto, periodo, registrado_por, nota)
    VALUES (p_deuda_id, v_deuda.cliente_id, p_monto_pago, v_periodo, p_registrado_por, p_nota)
    RETURNING id INTO v_pago_id;

    RETURN jsonb_build_object(
        'ok',                   true,
        'pago_id',              v_pago_id,
        'cliente_id',           v_deuda.cliente_id,
        'saldo_anterior',       v_deuda.saldo_pendiente,
        'monto_pago',           p_monto_pago,
        'nuevo_saldo',          v_nuevo_saldo,
        'nuevo_estado',         v_nuevo_estado,
        'fecha_corte_anterior', v_deuda.fecha_corte,
        'nueva_fecha_corte',    v_nueva_fecha_corte,
        'avance_corte',         v_avance_corte,
        'frecuencia',           v_deuda.frecuencia_pago
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
```

- [ ] **Paso 4: Aplicar la migración y ejecutar el guion**

Ejecuta la migración en Supabase Studio, luego vuelve a ejecutar `supabase/tests/pagos_atomico.sql`.
Esperado: `NOTICE: TODAS LAS VERIFICACIONES PASARON`.

- [ ] **Paso 5: Actualizar las Server Actions**

En `lib/actions/deudas.ts`, reemplaza `registrarPago` y `marcarPagoPeriodo` completas por:

```ts
export async function registrarPago(id: string, montoPago: number, nota?: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { data, error } = await supabase.rpc('registrar_pago_atomico', {
        p_deuda_id: id,
        p_monto_pago: montoPago,
        p_periodo: hoyRD(),
        p_nota: nota ?? null,
        p_registrado_por: user?.id ?? null,
    })

    if (error) throw new Error(error.message)
    if (!data?.ok) throw new Error(data?.error ?? 'Error al registrar pago')

    revalidatePath('/cuentas')
    revalidatePath('/dashboard')
    revalidatePath(`/clientes/${data.cliente_id}`)

    return { pagoId: data.pago_id as string, clienteId: data.cliente_id as string }
}

export async function marcarPagoPeriodo(deudaId: string, periodo: string, nota?: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { data: deuda } = await supabase
        .from('deudas')
        .select('cuota_mensual')
        .eq('id', deudaId)
        .single()

    if (!deuda) throw new Error('Deuda no encontrada')

    const { data, error } = await supabase.rpc('registrar_pago_atomico', {
        p_deuda_id: deudaId,
        p_monto_pago: deuda.cuota_mensual ?? 0,
        p_periodo: periodo,
        p_nota: nota ?? null,
        p_registrado_por: user?.id ?? null,
    })

    if (error) throw new Error(error.message)
    if (!data?.ok) throw new Error(data?.error ?? 'Error al registrar pago')

    revalidatePath('/cuentas')
    revalidatePath('/dashboard')
    revalidatePath(`/clientes/${data.cliente_id}`)

    return { pagoId: data.pago_id as string, clienteId: data.cliente_id as string }
}
```

Añade el import al inicio del archivo:

```ts
import { hoyRD } from '@/lib/utils/fecha-rd'
```

Nota: el bloque de ~35 líneas que avanzaba `fecha_corte` en JavaScript desaparece. Esa lógica ahora vive únicamente en el RPC.

- [ ] **Paso 6: Verificar en la aplicación**

Ejecuta: `npx tsc --noEmit`
Esperado: sin errores nuevos.

Levanta `npm run dev` y comprueba manualmente:

1. En `/cuentas`, registra un pago por monto en una cuenta con montos. El saldo baja y aparece una fila nueva en la tabla `pagos` (verifícalo en Supabase Studio).
2. En `/cuentas`, marca como pagada una cuenta sin montos. La `fecha_corte` avanza según su frecuencia y aparece fila en `pagos`.
3. Desde el panel flotante de pagos pendientes, pulsa "Pagó". Aparece fila en `pagos`.
4. Intenta un pago mayor al saldo pendiente. Sale el error y **no** queda fila en `pagos`.

- [ ] **Paso 7: Commit**

```bash
git add supabase/migrations/20260729_03_pagos_atomico.sql supabase/tests/pagos_atomico.sql lib/actions/deudas.ts
git commit -m "fix: registrar el pago dentro de la transacción del RPC en ambas rutas"
```

---

## Tarea 5: RPC de emisión y Server Actions de boletos

**Files:**
- Create: `supabase/migrations/20260729_04_emitir_ticket.sql`
- Create: `supabase/tests/emitir_ticket.sql`
- Create: `lib/actions/tickets.ts`
- Create: `lib/validations/tickets.ts`

**Interfaces:**
- Consumes: tablas de la Tarea 2, `hoyRD` de la Tarea 1, `tienePermiso` de la Tarea 3
- Produces:
  - RPC `emitir_ticket(UUID, UUID, UUID, TEXT, TEXT, UUID) RETURNS JSONB` → `{ ok, ya_existia, ticket }`
  - `emitirTicketDePago(pagoId): Promise<{ ticket: Ticket; yaExistia: boolean }>`
  - `emitirTicketManual(input: TicketManualFormData): Promise<{ ticket: Ticket }>`
  - `anularTicket(ticketId, motivo): Promise<void>`
  - `getTicketsCliente(clienteId): Promise<Ticket[]>`
  - `getTicketPorToken(token): Promise<Ticket | null>`
  - `getPagosSinTicket(clienteId): Promise<Pago[]>`

- [ ] **Paso 1: Escribir el guion de verificación**

Crea `supabase/tests/emitir_ticket.sql`:

```sql
-- ══════════════════════════════════════════════════════════════
-- Verificación manual de emitir_ticket
-- Todo dentro de una transacción que termina en ROLLBACK.
-- ══════════════════════════════════════════════════════════════
BEGIN;

DO $$
DECLARE
  v_cliente  UUID;
  v_deuda    UUID;
  v_pago     UUID;
  v_sorteo   UUID;
  v_res      JSONB;
  v_res2     JSONB;
  v_tickets  INTEGER;
BEGIN
  INSERT INTO public.clientes (nombre, apellido, telefono, dni_ruc)
  VALUES ('PruebaBoleto', 'Muñoz', '8091112222', '001-1234567-8')
  RETURNING id INTO v_cliente;

  INSERT INTO public.deudas (cliente_id, monto_original, saldo_pendiente, fecha_corte)
  VALUES (v_cliente, 0, 0, CURRENT_DATE)
  RETURNING id INTO v_deuda;

  INSERT INTO public.pagos (deuda_id, cliente_id, monto, periodo)
  VALUES (v_deuda, v_cliente, 0, '2026-07-29')
  RETURNING id INTO v_pago;

  -- Caso 1: sin sorteo activo → boleto huérfano con infijo -SN-
  v_res := public.emitir_ticket(v_cliente, v_pago, v_deuda, 'automatico', NULL, NULL);

  ASSERT (v_res ->> 'ok')::BOOLEAN, 'Caso 1: debió emitir';
  ASSERT NOT (v_res ->> 'ya_existia')::BOOLEAN, 'Caso 1: no debía existir antes';
  ASSERT (v_res -> 'ticket' ->> 'numero_formateado') LIKE '%-SN-%',
         'Caso 1: sin sorteo activo el número lleva el infijo -SN-';
  ASSERT (v_res -> 'ticket' ->> 'sorteo_id') IS NULL, 'Caso 1: sorteo_id debe ser NULL';
  ASSERT length(v_res -> 'ticket' ->> 'token_publico') >= 40,
         'Caso 1: el token público debe ser largo';
  ASSERT (v_res -> 'ticket' -> 'snapshot' -> 'cliente' ->> 'apellido') = 'Muñoz',
         'Caso 1: el snapshot debe conservar el apellido con eñe';

  -- Caso 2: idempotencia — el mismo pago devuelve el mismo boleto
  v_res2 := public.emitir_ticket(v_cliente, v_pago, v_deuda, 'automatico', NULL, NULL);

  ASSERT (v_res2 ->> 'ya_existia')::BOOLEAN, 'Caso 2: debió reconocer el boleto existente';
  ASSERT (v_res2 -> 'ticket' ->> 'id') = (v_res -> 'ticket' ->> 'id'),
         'Caso 2: debió devolver el mismo boleto';

  SELECT count(*) INTO v_tickets FROM public.tickets WHERE pago_id = v_pago;
  ASSERT v_tickets = 1, 'Caso 2: no debió duplicarse el boleto';

  -- Caso 3: boleto manual sin motivo → rechazado
  v_res := public.emitir_ticket(v_cliente, NULL, NULL, 'manual', NULL, NULL);
  ASSERT NOT (v_res ->> 'ok')::BOOLEAN, 'Caso 3: el motivo es obligatorio en manual';

  -- Caso 4: con sorteo activo → numeración correlativa con el prefijo del sorteo
  INSERT INTO public.sorteos (nombre, fecha_inicio, fecha_fin, estado, prefijo)
  VALUES ('Sorteo de prueba', CURRENT_DATE, CURRENT_DATE + 30, 'activo', 'TSTPRU')
  RETURNING id INTO v_sorteo;

  v_res  := public.emitir_ticket(v_cliente, NULL, NULL, 'manual', 'Promoción', NULL);
  v_res2 := public.emitir_ticket(v_cliente, NULL, NULL, 'manual', 'Promoción', NULL);

  ASSERT (v_res  -> 'ticket' ->> 'numero_formateado') = 'TSTPRU-000001',
         'Caso 4: el primer boleto del sorteo debe ser 000001';
  ASSERT (v_res2 -> 'ticket' ->> 'numero_formateado') = 'TSTPRU-000002',
         'Caso 4: el segundo debe ser 000002';
  ASSERT (v_res -> 'ticket' -> 'snapshot' -> 'sorteo' ->> 'nombre') = 'Sorteo de prueba',
         'Caso 4: el snapshot debe incluir el sorteo';

  -- Caso 5: cada emisión registra su evento
  SELECT count(*) INTO v_tickets
  FROM public.ticket_eventos WHERE tipo = 'emitido';
  ASSERT v_tickets = 4, 'Caso 5: debieron registrarse 4 eventos de emisión';

  RAISE NOTICE 'TODAS LAS VERIFICACIONES PASARON';
END $$;

ROLLBACK;
```

- [ ] **Paso 2: Ejecutar y confirmar que falla**

Ejecuta el guion en Supabase Studio.
Esperado: FALLA con `function public.emitir_ticket(...) does not exist`.

- [ ] **Paso 3: Escribir la migración del RPC**

Crea `supabase/migrations/20260729_04_emitir_ticket.sql`:

```sql
-- ══════════════════════════════════════════════════════════════
-- Migración: RPC de emisión de boletos
--   · Numeración serializada por bloqueo de fila del sorteo
--   · Idempotente respecto al pago
--   · Congela el snapshot de los datos impresos
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.emitir_ticket(
    p_cliente_id  UUID,
    p_pago_id     UUID  DEFAULT NULL,
    p_deuda_id    UUID  DEFAULT NULL,
    p_origen      TEXT  DEFAULT 'automatico',
    p_motivo      TEXT  DEFAULT NULL,
    p_emitido_por UUID  DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_cliente   public.clientes%ROWTYPE;
    v_sorteo    public.sorteos%ROWTYPE;
    v_cfg       public.configuracion_ticket%ROWTYPE;
    v_ticket    public.tickets%ROWTYPE;
    v_existente public.tickets%ROWTYPE;
    v_numero    INTEGER;
    v_fmt       TEXT;
    v_token     TEXT;
    v_snapshot  JSONB;
BEGIN
    IF p_origen NOT IN ('automatico','manual') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Origen inválido');
    END IF;

    IF p_origen = 'manual' AND (p_motivo IS NULL OR btrim(p_motivo) = '') THEN
        RETURN jsonb_build_object('ok', false, 'error',
            'El motivo es obligatorio para boletos manuales');
    END IF;

    SELECT * INTO v_cliente FROM public.clientes WHERE id = p_cliente_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Cliente no encontrado');
    END IF;

    -- Idempotencia: un pago ya boletado devuelve su boleto
    IF p_pago_id IS NOT NULL THEN
        SELECT * INTO v_existente FROM public.tickets
        WHERE pago_id = p_pago_id AND estado <> 'anulado';
        IF FOUND THEN
            RETURN jsonb_build_object('ok', true, 'ya_existia', true,
                                      'ticket', to_jsonb(v_existente));
        END IF;
    END IF;

    SELECT * INTO v_cfg FROM public.configuracion_ticket WHERE id = TRUE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error',
            'Falta configurar el módulo de boletos');
    END IF;

    -- Correlativo del sorteo activo. El UPDATE bloquea la fila, lo que
    -- serializa las emisiones concurrentes sin necesidad de secuencia.
    UPDATE public.sorteos
       SET ultimo_numero = ultimo_numero + 1,
           updated_at    = NOW()
     WHERE estado = 'activo'
    RETURNING * INTO v_sorteo;

    IF FOUND THEN
        v_numero := v_sorteo.ultimo_numero;
        v_fmt    := v_sorteo.prefijo || '-' || lpad(v_numero::TEXT, 6, '0');
    ELSE
        v_numero := nextval('public.tickets_numero_huerfano_seq');
        v_fmt    := v_cfg.prefijo_numeracion || '-SN-' || lpad(v_numero::TEXT, 6, '0');
    END IF;

    -- Token público: 32 bytes aleatorios en base64url, no enumerable
    v_token := rtrim(
        replace(replace(encode(extensions.gen_random_bytes(32), 'base64'), '+', '-'), '/', '_'),
        '='
    );

    v_snapshot := jsonb_build_object(
        'cliente', jsonb_build_object(
            'id',       v_cliente.id,
            'nombre',   v_cliente.nombre,
            'apellido', v_cliente.apellido,
            'telefono', v_cliente.telefono,
            'dni_ruc',  v_cliente.dni_ruc
        ),
        'sorteo', CASE WHEN v_sorteo.id IS NULL THEN NULL ELSE jsonb_build_object(
            'id',        v_sorteo.id,
            'nombre',    v_sorteo.nombre,
            'premio',    v_sorteo.premio,
            'fecha_fin', v_sorteo.fecha_fin
        ) END,
        'negocio', jsonb_build_object(
            'nombre_comercial', v_cfg.nombre_comercial,
            'rnc',              v_cfg.rnc,
            'direccion',        v_cfg.direccion,
            'telefono',         v_cfg.telefono,
            'texto_legal',      v_cfg.texto_legal,
            'url_terminos',     v_cfg.url_terminos,
            'pie_impresion',    v_cfg.pie_impresion,
            'logo_url',         v_cfg.logo_url
        ),
        'emitido_at_rd', to_char(
            NOW() AT TIME ZONE 'America/Santo_Domingo', 'DD/MM/YYYY HH12:MI AM'),
        'origen', p_origen,
        'version_snapshot', 1
    );

    BEGIN
        INSERT INTO public.tickets (
            numero, numero_formateado, sorteo_id, cliente_id, pago_id, deuda_id,
            origen, motivo, token_publico, snapshot, emitido_por
        ) VALUES (
            v_numero, v_fmt, v_sorteo.id, p_cliente_id, p_pago_id, p_deuda_id,
            p_origen, p_motivo, v_token, v_snapshot, p_emitido_por
        ) RETURNING * INTO v_ticket;
    EXCEPTION WHEN unique_violation THEN
        -- Carrera: otra petición boletó el mismo pago entre la comprobación
        -- y el insert. Devolvemos el boleto ganador.
        IF p_pago_id IS NOT NULL THEN
            SELECT * INTO v_existente FROM public.tickets
            WHERE pago_id = p_pago_id AND estado <> 'anulado';
            IF FOUND THEN
                RETURN jsonb_build_object('ok', true, 'ya_existia', true,
                                          'ticket', to_jsonb(v_existente));
            END IF;
        END IF;
        RAISE;
    END;

    INSERT INTO public.ticket_eventos (ticket_id, tipo, estado, detalle, usuario_id)
    VALUES (
        v_ticket.id, 'emitido', 'ok',
        CASE WHEN p_origen = 'manual'
             THEN 'Manual: ' || p_motivo
             ELSE 'Automático por pago' END,
        p_emitido_por
    );

    RETURN jsonb_build_object('ok', true, 'ya_existia', false,
                              'ticket', to_jsonb(v_ticket));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;
```

- [ ] **Paso 4: Aplicar y ejecutar el guion**

Ejecuta la migración, luego `supabase/tests/emitir_ticket.sql`.
Esperado: `NOTICE: TODAS LAS VERIFICACIONES PASARON`.

- [ ] **Paso 5: Crear los esquemas de validación**

Crea `lib/validations/tickets.ts`:

```ts
import { z } from 'zod'

export const TicketManualSchema = z.object({
    cliente_id: z.string().uuid('Cliente inválido'),
    motivo: z.string()
        .trim()
        .min(3, 'El motivo debe tener al menos 3 caracteres')
        .max(200, 'El motivo no puede pasar de 200 caracteres'),
})

export type TicketManualFormData = z.infer<typeof TicketManualSchema>

export const AnularTicketSchema = z.object({
    ticket_id: z.string().uuid(),
    motivo: z.string()
        .trim()
        .min(3, 'Indica el motivo de la anulación')
        .max(200, 'El motivo no puede pasar de 200 caracteres'),
})

export type AnularTicketFormData = z.infer<typeof AnularTicketSchema>

export const ConfiguracionTicketSchema = z.object({
    nombre_comercial: z.string().trim().min(1, 'El nombre comercial es obligatorio'),
    rnc: z.string().trim().optional().nullable(),
    direccion: z.string().trim().optional().nullable(),
    telefono: z.string().trim().optional().nullable(),
    logo_url: z.string().trim().url('URL inválida').optional().or(z.literal('')).nullable(),
    texto_legal: z.string().trim().max(500).optional().nullable(),
    url_terminos: z.string().trim().url('URL inválida').optional().or(z.literal('')).nullable(),
    prefijo_numeracion: z.string().trim().min(1).max(12)
        .regex(/^[A-Z0-9]+$/, 'Solo mayúsculas y números'),
    pie_impresion: z.string().trim().max(300).optional().nullable(),
    modo_adjunto: z.enum(['base64', 'url', 'ambos', 'ninguno']),
})

export type ConfiguracionTicketFormData = z.infer<typeof ConfiguracionTicketSchema>
```

- [ ] **Paso 6: Crear las Server Actions**

Crea `lib/actions/tickets.ts`:

```ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getPermisos } from '@/lib/utils/permisos'
import {
    TicketManualSchema,
    AnularTicketSchema,
    type TicketManualFormData,
} from '@/lib/validations/tickets'
import type { Ticket, TicketEvento } from '@/lib/types'

/** Lee el perfil del usuario de la sesión. Lanza si no hay sesión. */
async function perfilActual() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('No autenticado')

    const { data: profile } = await supabase
        .from('profiles')
        .select('id, rol, permisos')
        .eq('id', user.id)
        .single()

    if (!profile) throw new Error('Perfil no encontrado')
    return { supabase, user, profile, permisos: getPermisos(profile) }
}

// ─── EMISIÓN ──────────────────────────────────────────────────

/**
 * Emite el boleto correspondiente a un pago ya registrado.
 * Es idempotente: si el pago ya tiene boleto vigente, lo devuelve.
 */
export async function emitirTicketDePago(
    pagoId: string,
): Promise<{ ticket: Ticket; yaExistia: boolean }> {
    const { supabase, user } = await perfilActual()

    const { data: pago, error: pagoError } = await supabase
        .from('pagos')
        .select('id, cliente_id, deuda_id')
        .eq('id', pagoId)
        .single()

    if (pagoError || !pago) throw new Error('Pago no encontrado')

    const { data, error } = await supabase.rpc('emitir_ticket', {
        p_cliente_id: pago.cliente_id,
        p_pago_id: pago.id,
        p_deuda_id: pago.deuda_id,
        p_origen: 'automatico',
        p_motivo: null,
        p_emitido_por: user.id,
    })

    if (error) throw new Error(error.message)
    if (!data?.ok) throw new Error(data?.error ?? 'No se pudo emitir el boleto')

    revalidatePath(`/clientes/${pago.cliente_id}`)
    revalidatePath('/tickets')

    return { ticket: data.ticket as Ticket, yaExistia: Boolean(data.ya_existia) }
}

/** Emite un boleto manual atado al cliente, con motivo obligatorio. */
export async function emitirTicketManual(
    input: TicketManualFormData,
): Promise<{ ticket: Ticket }> {
    const { supabase, user, permisos } = await perfilActual()

    if (!permisos.generar_ticket_manual) {
        throw new Error('No tienes permiso para generar boletos manuales')
    }

    const validado = TicketManualSchema.parse(input)

    const { data, error } = await supabase.rpc('emitir_ticket', {
        p_cliente_id: validado.cliente_id,
        p_pago_id: null,
        p_deuda_id: null,
        p_origen: 'manual',
        p_motivo: validado.motivo,
        p_emitido_por: user.id,
    })

    if (error) throw new Error(error.message)
    if (!data?.ok) throw new Error(data?.error ?? 'No se pudo emitir el boleto')

    revalidatePath(`/clientes/${validado.cliente_id}`)
    revalidatePath('/tickets')

    return { ticket: data.ticket as Ticket }
}

// ─── ANULACIÓN ────────────────────────────────────────────────

export async function anularTicket(ticketId: string, motivo: string): Promise<void> {
    const { supabase, user, permisos } = await perfilActual()

    if (!permisos.generar_ticket_manual) {
        throw new Error('No tienes permiso para anular boletos')
    }

    const validado = AnularTicketSchema.parse({ ticket_id: ticketId, motivo })

    const { data: ticket, error: leerError } = await supabase
        .from('tickets')
        .select('id, cliente_id, estado')
        .eq('id', validado.ticket_id)
        .single()

    if (leerError || !ticket) throw new Error('Boleto no encontrado')
    if (ticket.estado === 'anulado') throw new Error('El boleto ya está anulado')

    const { error } = await supabase
        .from('tickets')
        .update({
            estado: 'anulado',
            anulado_por: user.id,
            anulado_at: new Date().toISOString(),
            motivo_anulacion: validado.motivo,
        })
        .eq('id', validado.ticket_id)
        .eq('estado', 'valido')      // bloqueo optimista

    if (error) throw new Error(error.message)

    await supabase.from('ticket_eventos').insert({
        ticket_id: validado.ticket_id,
        tipo: 'anulado',
        estado: 'ok',
        detalle: validado.motivo,
        usuario_id: user.id,
    })

    revalidatePath(`/clientes/${ticket.cliente_id}`)
    revalidatePath('/tickets')
}

// ─── CONSULTAS ────────────────────────────────────────────────

export async function getTicketsCliente(clienteId: string): Promise<Ticket[]> {
    const supabase = await createClient()

    const { data, error } = await supabase
        .from('tickets')
        .select('*, sorteo:sorteos(id, nombre, premio)')
        .eq('cliente_id', clienteId)
        .order('emitido_at', { ascending: false })

    if (error) throw new Error(error.message)
    return (data ?? []) as Ticket[]
}

export async function getEventosTicket(ticketId: string): Promise<TicketEvento[]> {
    const supabase = await createClient()

    const { data, error } = await supabase
        .from('ticket_eventos')
        .select('*, usuario:profiles(id, full_name)')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false })

    if (error) throw new Error(error.message)
    return (data ?? []) as TicketEvento[]
}

/**
 * Pagos del cliente que todavía no tienen boleto vigente.
 * Cubre el caso de que el agente cierre el modal de confirmación.
 */
export async function getPagosSinTicket(clienteId: string) {
    const supabase = await createClient()

    const { data: pagos, error } = await supabase
        .from('pagos')
        .select('id, monto, periodo, created_at, deuda_id')
        .eq('cliente_id', clienteId)
        .order('created_at', { ascending: false })
        .limit(50)

    if (error) throw new Error(error.message)
    if (!pagos?.length) return []

    const { data: conBoleto } = await supabase
        .from('tickets')
        .select('pago_id')
        .in('pago_id', pagos.map(p => p.id))
        .eq('estado', 'valido')

    const boletados = new Set((conBoleto ?? []).map(t => t.pago_id))
    return pagos.filter(p => !boletados.has(p.id))
}
```

- [ ] **Paso 7: Verificar**

Ejecuta: `npx tsc --noEmit`
Esperado: sin errores nuevos.

- [ ] **Paso 8: Commit**

```bash
git add supabase/migrations/20260729_04_emitir_ticket.sql supabase/tests/emitir_ticket.sql lib/actions/tickets.ts lib/validations/tickets.ts
git commit -m "feat: RPC idempotente de emisión de boletos y acciones asociadas"
```

---

## Tarea 6: PDF generado al vuelo y rutas públicas

**Files:**
- Create: `lib/pdf/ticket-document.tsx`
- Create: `app/api/tickets/[token]/pdf/route.ts`
- Create: `app/t/[token]/page.tsx`
- Create: `app/terminos/page.tsx`
- Modify: `middleware.ts:4` y `:17-26`
- Modify: `package.json`

**Interfaces:**
- Consumes: `Ticket`, `TicketSnapshot` (Tarea 2)
- Produces:
  - `TicketDocument({ ticket }: { ticket: Ticket }): JSX.Element`
  - `generarTicketPdf(ticket: Ticket): Promise<Buffer>`
  - `GET /api/tickets/[token]/pdf` → `application/pdf`
  - `GET /t/[token]` → página pública

- [ ] **Paso 1: Instalar la dependencia**

```bash
npm install @react-pdf/renderer
```

- [ ] **Paso 2: Crear el documento PDF**

Crea `lib/pdf/ticket-document.tsx`:

```tsx
import {
    Document, Page, Text, View, StyleSheet, Image, renderToBuffer,
} from '@react-pdf/renderer'
import type { Ticket } from '@/lib/types'

/**
 * Se usan las fuentes estándar del formato PDF (Helvetica, codificación
 * WinAnsi) a propósito: cubren ñ y vocales acentuadas sin tener que
 * empaquetar archivos TTF, que romperían el build `standalone` de Docker.
 */
const estilos = StyleSheet.create({
    pagina: { padding: 48, fontFamily: 'Helvetica', fontSize: 11, color: '#0f172a' },
    cabecera: {
        flexDirection: 'row', justifyContent: 'space-between',
        alignItems: 'flex-start', marginBottom: 24,
        borderBottomWidth: 2, borderBottomColor: '#007EC6', paddingBottom: 12,
    },
    logo: { width: 64, height: 64, objectFit: 'contain' },
    negocio: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: '#007EC6' },
    negocioLinea: { fontSize: 9, color: '#64748b', marginTop: 2 },
    titulo: {
        fontSize: 13, fontFamily: 'Helvetica-Bold', textAlign: 'center',
        letterSpacing: 2, marginBottom: 4, color: '#334155',
    },
    numeroCaja: {
        borderWidth: 2, borderColor: '#0f172a', borderStyle: 'dashed',
        paddingVertical: 20, marginVertical: 16, alignItems: 'center',
    },
    numero: { fontSize: 34, fontFamily: 'Helvetica-Bold', letterSpacing: 3 },
    anulado: {
        fontSize: 13, fontFamily: 'Helvetica-Bold',
        color: '#dc2626', textAlign: 'center', marginTop: 6,
    },
    fila: { flexDirection: 'row', marginBottom: 6 },
    etiqueta: { width: 110, color: '#64748b' },
    valor: { flex: 1, fontFamily: 'Helvetica-Bold' },
    seccion: { marginTop: 18 },
    legal: {
        marginTop: 28, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#e2e8f0',
        fontSize: 8, color: '#64748b', lineHeight: 1.5,
    },
})

export function TicketDocument({ ticket }: { ticket: Ticket }) {
    const s = ticket.snapshot
    const cliente = `${s.cliente.nombre} ${s.cliente.apellido}`

    return (
        <Document
            title={`Boleto ${ticket.numero_formateado}`}
            author={s.negocio.nombre_comercial}
        >
            <Page size="LETTER" style={estilos.pagina}>
                <View style={estilos.cabecera}>
                    <View>
                        <Text style={estilos.negocio}>{s.negocio.nombre_comercial}</Text>
                        {s.negocio.rnc && (
                            <Text style={estilos.negocioLinea}>RNC: {s.negocio.rnc}</Text>
                        )}
                        {s.negocio.direccion && (
                            <Text style={estilos.negocioLinea}>{s.negocio.direccion}</Text>
                        )}
                        {s.negocio.telefono && (
                            <Text style={estilos.negocioLinea}>Tel: {s.negocio.telefono}</Text>
                        )}
                    </View>
                    {s.negocio.logo_url && (
                        <Image style={estilos.logo} src={s.negocio.logo_url} />
                    )}
                </View>

                <Text style={estilos.titulo}>BOLETO DE SORTEO</Text>

                <View style={estilos.numeroCaja}>
                    <Text style={estilos.numero}>{ticket.numero_formateado}</Text>
                    {ticket.estado === 'anulado' && (
                        <Text style={estilos.anulado}>BOLETO ANULADO</Text>
                    )}
                </View>

                <View style={estilos.seccion}>
                    <View style={estilos.fila}>
                        <Text style={estilos.etiqueta}>Cliente</Text>
                        <Text style={estilos.valor}>{cliente}</Text>
                    </View>
                    {s.cliente.dni_ruc && (
                        <View style={estilos.fila}>
                            <Text style={estilos.etiqueta}>Cédula / RNC</Text>
                            <Text style={estilos.valor}>{s.cliente.dni_ruc}</Text>
                        </View>
                    )}
                    <View style={estilos.fila}>
                        <Text style={estilos.etiqueta}>Fecha de emisión</Text>
                        <Text style={estilos.valor}>{s.emitido_at_rd}</Text>
                    </View>
                    {s.sorteo && (
                        <>
                            <View style={estilos.fila}>
                                <Text style={estilos.etiqueta}>Sorteo</Text>
                                <Text style={estilos.valor}>{s.sorteo.nombre}</Text>
                            </View>
                            {s.sorteo.premio && (
                                <View style={estilos.fila}>
                                    <Text style={estilos.etiqueta}>Premio</Text>
                                    <Text style={estilos.valor}>{s.sorteo.premio}</Text>
                                </View>
                            )}
                        </>
                    )}
                </View>

                <View style={estilos.legal}>
                    {s.negocio.texto_legal && <Text>{s.negocio.texto_legal}</Text>}
                    {s.negocio.url_terminos && (
                        <Text>Términos y condiciones: {s.negocio.url_terminos}</Text>
                    )}
                    {s.negocio.pie_impresion && <Text>{s.negocio.pie_impresion}</Text>}
                </View>
            </Page>
        </Document>
    )
}

/** Genera el PDF en memoria. Nunca se escribe a disco ni a la base de datos. */
export async function generarTicketPdf(ticket: Ticket): Promise<Buffer> {
    return renderToBuffer(<TicketDocument ticket={ticket} />)
}
```

- [ ] **Paso 3: Crear el limitador de tasa y la ruta de descarga**

El token de 256 bits ya hace inviable adivinar un boleto, pero generar un PDF cuesta CPU y la
ruta es pública: sin freno, un bucle contra ella tumba el servidor.

Crea `lib/api-publico/rate-limit.ts`:

```ts
/**
 * Limitador de tasa en memoria para las rutas públicas.
 *
 * Deliberadamente simple: este sistema corre en un único proceso Node
 * autohospedado, así que un Map basta y evita añadir Redis. Si algún día se
 * escala a varias instancias, habrá que moverlo a almacenamiento compartido.
 */

interface Ventana {
    conteo: number
    expira: number
}

const ventanas = new Map<string, Ventana>()
const LIMPIEZA_CADA = 5 * 60_000
let ultimaLimpieza = 0

function limpiarVencidas(ahora: number): void {
    if (ahora - ultimaLimpieza < LIMPIEZA_CADA) return
    ultimaLimpieza = ahora
    for (const [clave, v] of ventanas) {
        if (v.expira <= ahora) ventanas.delete(clave)
    }
}

/**
 * Devuelve true si la petición se permite.
 * Por defecto: 30 peticiones por minuto y clave.
 */
export function permitir(
    clave: string,
    limite = 30,
    ventanaMs = 60_000,
): boolean {
    const ahora = Date.now()
    limpiarVencidas(ahora)

    const actual = ventanas.get(clave)

    if (!actual || actual.expira <= ahora) {
        ventanas.set(clave, { conteo: 1, expira: ahora + ventanaMs })
        return true
    }

    actual.conteo++
    return actual.conteo <= limite
}

/** IP del peticionario, mirando primero las cabeceras del proxy inverso. */
export function ipDe(req: Request): string {
    return (
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        req.headers.get('x-real-ip') ||
        'desconocida'
    )
}
```

Crea `app/api/tickets/[token]/pdf/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generarTicketPdf } from '@/lib/pdf/ticket-document'
import { permitir, ipDe } from '@/lib/api-publico/rate-limit'
import type { Ticket } from '@/lib/types'

// @react-pdf/renderer requiere el runtime de Node, no el de Edge.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Descarga pública del boleto. Se autentica por el token aleatorio de 256
 * bits del propio boleto, no por sesión: el cliente final no tiene cuenta.
 */
export async function GET(
    req: Request,
    { params }: { params: Promise<{ token: string }> },
) {
    const { token } = await params

    if (!token || token.length < 20) {
        return NextResponse.json({ error: 'Token inválido' }, { status: 400 })
    }

    // Generar un PDF cuesta CPU y esta ruta es pública
    if (!permitir(`pdf:${ipDe(req)}`, 30, 60_000)) {
        return NextResponse.json(
            { error: 'Demasiadas peticiones. Espera un momento.' },
            { status: 429, headers: { 'Retry-After': '60' } },
        )
    }

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { data: ticket } = await supabase
        .from('tickets')
        .select('*')
        .eq('token_publico', token)
        .maybeSingle()

    if (!ticket) {
        return NextResponse.json({ error: 'Boleto no encontrado' }, { status: 404 })
    }

    if (ticket.estado === 'anulado') {
        return NextResponse.json({ error: 'Este boleto fue anulado' }, { status: 410 })
    }

    const pdf = await generarTicketPdf(ticket as Ticket)

    return new NextResponse(new Uint8Array(pdf), {
        headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition':
                `inline; filename="boleto-${ticket.numero_formateado}.pdf"`,
            'Cache-Control': 'private, max-age=300',
        },
    })
}
```

- [ ] **Paso 4: Crear la página pública del boleto**

Crea `app/t/[token]/page.tsx`:

```tsx
import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import type { Ticket } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function BoletoPublicoPage(
    { params }: { params: Promise<{ token: string }> },
) {
    const { token } = await params

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { data } = await supabase
        .from('tickets')
        .select('*')
        .eq('token_publico', token)
        .maybeSingle()

    if (!data) notFound()

    const ticket = data as Ticket
    const s = ticket.snapshot
    const anulado = ticket.estado === 'anulado'

    return (
        <main className="min-h-screen flex items-center justify-center p-6"
              style={{ background: 'linear-gradient(180deg,#0a1628,#091525)' }}>
            <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900/70 p-8 text-center">
                <p className="text-sm font-semibold" style={{ color: '#007EC6' }}>
                    {s.negocio.nombre_comercial}
                </p>
                <h1 className="mt-6 text-xs uppercase tracking-[0.3em] text-slate-400">
                    Boleto de sorteo
                </h1>

                <p className={`mt-3 text-4xl font-bold tracking-widest ${anulado ? 'text-slate-600 line-through' : 'text-white'}`}>
                    {ticket.numero_formateado}
                </p>

                {anulado && (
                    <p className="mt-3 rounded-lg bg-red-500/20 px-3 py-2 text-sm font-semibold text-red-300">
                        Este boleto fue anulado
                    </p>
                )}

                <dl className="mt-8 space-y-2 text-left text-sm">
                    <div className="flex justify-between gap-4">
                        <dt className="text-slate-400">Cliente</dt>
                        <dd className="font-medium text-white">
                            {s.cliente.nombre} {s.cliente.apellido}
                        </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                        <dt className="text-slate-400">Emitido</dt>
                        <dd className="font-medium text-white">{s.emitido_at_rd}</dd>
                    </div>
                    {s.sorteo && (
                        <div className="flex justify-between gap-4">
                            <dt className="text-slate-400">Sorteo</dt>
                            <dd className="font-medium text-white">{s.sorteo.nombre}</dd>
                        </div>
                    )}
                </dl>

                {!anulado && (
                    <a
                        href={`/api/tickets/${token}/pdf`}
                        className="mt-8 inline-flex w-full items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold text-white"
                        style={{ background: 'linear-gradient(135deg,#007EC6,#0088d4)' }}
                    >
                        Descargar boleto en PDF
                    </a>
                )}

                {s.negocio.url_terminos && (
                    <a href={s.negocio.url_terminos}
                       className="mt-4 block text-xs text-slate-500 underline">
                        Términos y condiciones
                    </a>
                )}
            </div>
        </main>
    )
}
```

- [ ] **Paso 5: Crear la página de términos**

Crea `app/terminos/page.tsx`:

```tsx
import { createClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function TerminosPage() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { data: cfg } = await supabase
        .from('configuracion_ticket')
        .select('nombre_comercial, texto_legal, url_terminos')
        .eq('id', true)
        .maybeSingle()

    // Si hay una URL externa configurada, esa manda.
    if (cfg?.url_terminos) redirect(cfg.url_terminos)

    return (
        <main className="min-h-screen p-8" style={{ background: '#0a1628' }}>
            <div className="mx-auto max-w-2xl">
                <h1 className="text-xl font-bold text-white">
                    Términos y condiciones — {cfg?.nombre_comercial ?? 'Sorteo'}
                </h1>
                <p className="mt-6 whitespace-pre-line text-sm leading-relaxed text-slate-300">
                    {cfg?.texto_legal ?? 'No hay términos y condiciones configurados.'}
                </p>
            </div>
        </main>
    )
}
```

- [ ] **Paso 6: Abrir las rutas en el middleware**

Corrige el defecto L4: `PUBLIC_PATHS` redirige a `/dashboard` a quien ya tenga sesión, así que un admin logueado no podría abrir el boleto de un cliente. Se necesita una lista aparte.

En `middleware.ts`, después de la línea 4, añade:

```ts
/**
 * Rutas sin autenticación que, a diferencia de PUBLIC_PATHS, NO redirigen al
 * dashboard cuando ya hay sesión: un admin logueado debe poder abrir el
 * boleto de un cliente. `/api/print/*` se autentica por token de estación
 * dentro de su propio route handler.
 */
const OPEN_PATHS = ['/t/', '/terminos', '/api/tickets/', '/api/print/']
```

Y dentro de `middleware()`, justo después de `const { pathname } = request.nextUrl`:

```ts
    if (OPEN_PATHS.some(p => pathname.startsWith(p))) {
        return NextResponse.next()
    }
```

- [ ] **Paso 7: Verificar**

Ejecuta: `npx tsc --noEmit`
Esperado: sin errores nuevos.

Con `npm run dev` levantado:

1. Emite un boleto de prueba desde Supabase Studio:
   ```sql
   SELECT public.emitir_ticket(
     (SELECT id FROM public.clientes LIMIT 1),
     NULL, NULL, 'manual', 'Prueba de PDF', NULL
   );
   ```
2. Copia el `token_publico` del resultado.
3. Abre `http://localhost:3000/t/<TOKEN>` **con sesión iniciada**. Debe mostrar el boleto,
   no redirigir al dashboard.
4. Abre la misma URL en una ventana de incógnito. Debe mostrarse igual.
5. Pulsa "Descargar boleto en PDF". Verifica que se abre el PDF y que los acentos y la ñ
   del nombre del cliente se ven correctamente.
6. Anula el boleto (`UPDATE public.tickets SET estado='anulado' WHERE ...`) y recarga el PDF.
   Debe devolver 410.

- [ ] **Paso 8: Commit**

```bash
git add package.json package-lock.json lib/pdf/ticket-document.tsx lib/api-publico/rate-limit.ts "app/api/tickets/[token]/pdf/route.ts" "app/t/[token]/page.tsx" app/terminos/page.tsx middleware.ts
git commit -m "feat: PDF del boleto generado al vuelo y rutas públicas"
```

---

## Tarea 7: Envío por WhatsApp

Corrige el defecto L1: `lib/actions/envios.ts` usa `.maybeSingle()` sobre webhooks activos, así que en el momento en que exista un segundo webhook activo la cobranza deja de enviar con error de múltiples filas. La separación por `evento` no es opcional.

**Files:**
- Create: `supabase/migrations/20260729_05_webhooks_evento.sql`
- Modify: `lib/actions/envios.ts:96-102` y `:258-267`
- Modify: `lib/actions/tickets.ts` (añadir el envío)
- Modify: `.env.example`

**Interfaces:**
- Consumes: `generarTicketPdf` (Tarea 6), `TicketWebhookPayload` (Tarea 2)
- Produces:
  - `enviarTicketWhatsApp(ticketId: string, opciones?: { reenvio?: boolean }): Promise<{ ok: boolean; estado: number }>`
  - `enviarBoletoDePrueba(): Promise<{ ok: boolean; estado: number; cuerpo: string }>`

- [ ] **Paso 1: Escribir y aplicar la migración**

Crea `supabase/migrations/20260729_05_webhooks_evento.sql`:

```sql
-- ══════════════════════════════════════════════════════════════
-- Migración: separar los webhooks de cobranza y de boletos
--
-- Sin esta separación, el `.maybeSingle()` de lib/actions/envios.ts
-- lanzaría "multiple rows returned" en cuanto exista un segundo webhook
-- activo, dejando la cobranza sin enviar. (Defecto L1 del diseño.)
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.webhooks
  ADD COLUMN IF NOT EXISTS evento TEXT NOT NULL DEFAULT 'cobranza'
  CHECK (evento IN ('cobranza','ticket'));

COMMENT ON COLUMN public.webhooks.evento IS
'Flujo al que pertenece el webhook. cobranza = recordatorios de deuda; ticket = envío de boletos.';

CREATE INDEX IF NOT EXISTS idx_webhooks_evento_activo
  ON public.webhooks(evento) WHERE activo;

-- ─── Permitir la etapa 'ticket' en las plantillas ─────────────
ALTER TABLE public.plantillas_mensaje
  DROP CONSTRAINT IF EXISTS plantillas_mensaje_etapa_check;

ALTER TABLE public.plantillas_mensaje
  ADD CONSTRAINT plantillas_mensaje_etapa_check
  CHECK (etapa IN ('preventivo','mora_temprana','mora_alta',
                   'recuperacion','referencia','ticket'));

-- ─── Plantilla por defecto del boleto ─────────────────────────
INSERT INTO public.plantillas_mensaje (nombre, etapa, contenido)
SELECT
  'Boleto de Sorteo',
  'ticket',
  '¡Gracias {{nombre}}! 🎟️' || chr(10) || chr(10) ||
  'Tu boleto para *{{sorteo}}* es el número *{{ticket_numero}}*.' || chr(10) ||
  'Emitido el {{fecha}}.' || chr(10) || chr(10) ||
  'Guarda este comprobante. Consulta los términos y condiciones aquí: {{url_terminos}}' || chr(10) ||
  '— Inversiones Cordero'
WHERE NOT EXISTS (
  SELECT 1 FROM public.plantillas_mensaje WHERE etapa = 'ticket'
);
```

Aplica el SQL en Supabase Studio y verifica:

```sql
SELECT nombre, etapa, activo FROM public.plantillas_mensaje WHERE etapa = 'ticket';
SELECT nombre, evento, activo FROM public.webhooks;
```

Esperado: una plantilla de etapa `ticket`, y todos los webhooks existentes con `evento = 'cobranza'`.

- [ ] **Paso 2: Filtrar los webhooks de cobranza por evento**

En `lib/actions/envios.ts`, en las **dos** consultas de webhooks (líneas ~96-102 y ~258-267), añade el filtro. Ambas quedan así:

```ts
    const { data: webhook } = await supabase
        .from('webhooks')
        .select('*')
        .eq('activo', true)
        .eq('evento', 'cobranza')
        .maybeSingle()
```

- [ ] **Paso 3: Añadir la variable de entorno de la URL pública**

En `.env.example`, al final:

```env
# ── Boletería ─────────────────────────────────────────────────
# URL base con la que se construyen los enlaces públicos de los boletos.
# Si el servidor NO está expuesto a internet, deja el valor de red local y
# mantén modo_adjunto = 'base64' en la configuración de boletos: el PDF
# viaja dentro del payload del webhook y nadie necesita alcanzar esta URL.
APP_PUBLIC_URL=http://localhost:3000
```

- [ ] **Paso 4: Implementar el envío**

Añade estos imports **al inicio** de `lib/actions/tickets.ts`, junto a los que ya tiene:

```ts
import { renderTemplate } from '@/lib/utils/template-renderer'
import { generarTicketPdf } from '@/lib/pdf/ticket-document'
import { formatearFechaHoraRD } from '@/lib/utils/fecha-rd'
import type { TicketWebhookPayload, ConfiguracionTicket } from '@/lib/types'
```

Y el resto **al final** del archivo:

```ts

/** Un teléfono sirve si tiene al menos 10 dígitos tras quitar el formato. */
export async function telefonoEsValido(telefono?: string | null): Promise<boolean> {
    if (!telefono) return false
    return telefono.replace(/\D/g, '').length >= 10
}

async function postWebhook(
    url: string,
    headers: Record<string, string>,
    payload: unknown,
): Promise<{ ok: boolean; status: number; body: string }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30_000)
    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(payload),
            signal: controller.signal,
        })
        return { ok: resp.ok, status: resp.status, body: await resp.text() }
    } catch (e) {
        return {
            ok: false,
            status: 0,
            body: e instanceof DOMException && e.name === 'AbortError'
                ? 'Timeout: el webhook no respondió en 30 segundos'
                : String(e),
        }
    } finally {
        clearTimeout(timer)
    }
}

/**
 * Construye el payload del webhook de boletos.
 * El PDF viaja en base64 dentro del cuerpo (modo por defecto) porque el
 * servidor no está expuesto a internet y el POST es saliente.
 */
async function construirPayloadTicket(
    ticket: Ticket,
    cfg: ConfiguracionTicket,
    plantillaContenido: string,
    reenvio: boolean,
): Promise<TicketWebhookPayload> {
    const s = ticket.snapshot
    const base = process.env.APP_PUBLIC_URL ?? 'http://localhost:3000'
    const urlPublica = `${base}/t/${ticket.token_publico}`

    const mensaje = renderTemplate(plantillaContenido, {
        nombre: s.cliente.nombre,
        apellido: s.cliente.apellido,
        ticket_numero: ticket.numero_formateado,
        sorteo: s.sorteo?.nombre ?? 'nuestro sorteo',
        premio: s.sorteo?.premio ?? '',
        fecha: formatearFechaHoraRD(ticket.emitido_at),
        url_terminos: cfg.url_terminos ?? `${base}/terminos`,
    })

    const incluirBase64 = cfg.modo_adjunto === 'base64' || cfg.modo_adjunto === 'ambos'
    const incluirUrl = cfg.modo_adjunto === 'url' || cfg.modo_adjunto === 'ambos'

    let adjunto: TicketWebhookPayload['adjunto'] = null
    if (incluirBase64) {
        const pdf = await generarTicketPdf(ticket)
        adjunto = {
            tipo: 'pdf',
            nombre: `boleto-${ticket.numero_formateado}.pdf`,
            base64: pdf.toString('base64'),
        }
    }

    return {
        evento: 'ticket_emitido',
        timestamp: new Date().toISOString(),
        enviado_por: reenvio ? 'manual' : 'sistema',
        reenvio,
        cliente: {
            id: s.cliente.id,
            nombre: s.cliente.nombre,
            apellido: s.cliente.apellido,
            telefono: s.cliente.telefono ?? '',
        },
        ticket: {
            id: ticket.id,
            numero: ticket.numero_formateado,
            sorteo: s.sorteo?.nombre ?? null,
            emitido_at: ticket.emitido_at,
        },
        mensaje,
        url_terminos: cfg.url_terminos ?? null,
        url_publica: incluirUrl ? urlPublica : null,
        adjunto,
    }
}

export async function enviarTicketWhatsApp(
    ticketId: string,
    opciones?: { reenvio?: boolean },
): Promise<{ ok: boolean; estado: number }> {
    const { supabase, user } = await perfilActual()
    const reenvio = opciones?.reenvio ?? false

    const { data: ticket, error: ticketError } = await supabase
        .from('tickets')
        .select('*')
        .eq('id', ticketId)
        .single()

    if (ticketError || !ticket) throw new Error('Boleto no encontrado')
    if (ticket.estado === 'anulado') throw new Error('El boleto está anulado')

    const t = ticket as Ticket
    if (!(await telefonoEsValido(t.snapshot.cliente.telefono))) {
        throw new Error('El cliente no tiene un teléfono válido registrado')
    }

    const { data: cfg } = await supabase
        .from('configuracion_ticket').select('*').eq('id', true).single()
    if (!cfg) throw new Error('Falta configurar el módulo de boletos')

    const { data: plantilla } = await supabase
        .from('plantillas_mensaje')
        .select('*')
        .eq('etapa', 'ticket')
        .eq('activo', true)
        .maybeSingle()
    if (!plantilla) throw new Error('No hay plantilla activa para boletos')

    const { data: webhook } = await supabase
        .from('webhooks')
        .select('*')
        .eq('activo', true)
        .eq('evento', 'ticket')
        .maybeSingle()
    if (!webhook) {
        throw new Error('No hay webhook activo configurado para boletos')
    }

    const payload = await construirPayloadTicket(
        t, cfg as ConfiguracionTicket, plantilla.contenido, reenvio,
    )

    const resultado = await postWebhook(webhook.url, webhook.headers ?? {}, payload)

    // El base64 del PDF NO se guarda en el log: solo su tamaño.
    const { adjunto, ...payloadSinPdf } = payload
    await supabase.from('ticket_eventos').insert({
        ticket_id: t.id,
        tipo: 'enviado_wa',
        estado: resultado.ok ? 'ok' : 'error',
        es_copia: reenvio,
        detalle: reenvio ? 'Reenvío manual' : 'Envío automático',
        payload: {
            ...payloadSinPdf,
            adjunto: adjunto
                ? { tipo: adjunto.tipo, nombre: adjunto.nombre, bytes: adjunto.base64.length }
                : null,
        },
        respuesta_http: resultado.status || null,
        respuesta_body: resultado.body?.slice(0, 2000) ?? null,
        usuario_id: user.id,
    })

    if (resultado.ok) {
        await supabase
            .from('tickets')
            .update({ veces_enviado: t.veces_enviado + 1 })
            .eq('id', t.id)
    }

    revalidatePath(`/clientes/${t.cliente_id}`)
    revalidatePath('/tickets')

    if (!resultado.ok) {
        throw new Error(`El webhook respondió ${resultado.status}: ${resultado.body?.slice(0, 200)}`)
    }

    return { ok: true, estado: resultado.status }
}

/**
 * Envía un boleto ficticio al webhook de boletos para averiguar
 * empíricamente qué acepta el proveedor de WhatsApp. No persiste nada.
 */
export async function enviarBoletoDePrueba(): Promise<{
    ok: boolean; estado: number; cuerpo: string
}> {
    const { supabase, permisos } = await perfilActual()
    if (!permisos.generar_ticket_manual) {
        throw new Error('No tienes permiso para enviar pruebas')
    }

    const { data: cfg } = await supabase
        .from('configuracion_ticket').select('*').eq('id', true).single()
    if (!cfg) throw new Error('Falta configurar el módulo de boletos')

    const { data: plantilla } = await supabase
        .from('plantillas_mensaje')
        .select('*').eq('etapa', 'ticket').eq('activo', true).maybeSingle()
    if (!plantilla) throw new Error('No hay plantilla activa para boletos')

    const { data: webhook } = await supabase
        .from('webhooks')
        .select('*').eq('activo', true).eq('evento', 'ticket').maybeSingle()
    if (!webhook) throw new Error('No hay webhook activo configurado para boletos')

    const c = cfg as ConfiguracionTicket
    const ahora = new Date().toISOString()

    const ticketFicticio: Ticket = {
        id: '00000000-0000-0000-0000-000000000000',
        numero: 0,
        numero_formateado: `${c.prefijo_numeracion}-PRUEBA`,
        sorteo_id: null,
        cliente_id: '00000000-0000-0000-0000-000000000000',
        pago_id: null,
        deuda_id: null,
        origen: 'manual',
        motivo: 'Boleto de prueba',
        estado: 'valido',
        anulado_por: null,
        anulado_at: null,
        motivo_anulacion: null,
        token_publico: 'prueba',
        emitido_por: null,
        emitido_at: ahora,
        veces_enviado: 0,
        veces_impreso: 0,
        created_at: ahora,
        snapshot: {
            cliente: {
                id: '00000000-0000-0000-0000-000000000000',
                nombre: 'Cliente',
                apellido: 'de Prueba',
                telefono: null,
                dni_ruc: null,
            },
            sorteo: null,
            negocio: {
                nombre_comercial: c.nombre_comercial,
                rnc: c.rnc,
                direccion: c.direccion,
                telefono: c.telefono,
                texto_legal: c.texto_legal,
                url_terminos: c.url_terminos,
                pie_impresion: c.pie_impresion,
                logo_url: c.logo_url,
            },
            emitido_at_rd: formatearFechaHoraRD(ahora),
            origen: 'manual',
            version_snapshot: 1,
        },
    }

    const payload = await construirPayloadTicket(
        ticketFicticio, c, plantilla.contenido, false,
    )
    const resultado = await postWebhook(webhook.url, webhook.headers ?? {}, payload)

    return {
        ok: resultado.ok,
        estado: resultado.status,
        cuerpo: resultado.body?.slice(0, 1000) ?? '',
    }
}
```

- [ ] **Paso 5: Verificar**

Ejecuta: `npx tsc --noEmit`
Esperado: sin errores nuevos.

Verificación manual:

1. En Supabase Studio, crea el webhook de boletos:
   ```sql
   INSERT INTO public.webhooks (nombre, url, evento, activo)
   VALUES ('WhatsApp Boletos', 'https://TU-N8N/webhook/boletos', 'ticket', true);
   ```
2. Confirma que la cobranza sigue funcionando: entra a una cuenta y usa el envío
   manual de recordatorio. Con dos webhooks activos en la tabla, debe seguir enviando
   sin el error de múltiples filas. **Este es el punto crítico de la tarea.**
3. El botón de boleto de prueba se cablea en la Tarea 10. Por ahora invoca
   `enviarBoletoDePrueba()` desde una página temporal o desde la consola del servidor
   y comprueba que n8n recibe `adjunto.base64`.

- [ ] **Paso 6: Commit**

```bash
git add supabase/migrations/20260729_05_webhooks_evento.sql lib/actions/envios.ts lib/actions/tickets.ts .env.example
git commit -m "feat: envío de boletos por WhatsApp con webhook separado del de cobranza"
```

---

## Tarea 8: Modal de confirmación tras el pago

**Files:**
- Create: `components/tickets/ticket-confirm-dialog.tsx`
- Modify: `components/layout/pagos-pendientes-panel.tsx:84-95`
- Modify: `components/cuentas/cuentas-view.tsx:106-136`

**Interfaces:**
- Consumes: `emitirTicketDePago`, `enviarTicketWhatsApp`, `telefonoEsValido` (Tareas 5 y 7)
- Produces: componente `<TicketConfirmDialog />` con props
  `{ abierto: boolean; onCerrar: () => void; pagoId: string | null; clienteNombre: string; clienteTelefono: string | null; puedeImprimir: boolean }`

**Nota sobre la impresión:** el botón de imprimir se deja visible pero deshabilitado con la
leyenda "Disponible al instalar la impresora". Se activa en el Plan 2, Tarea 5.

- [ ] **Paso 1: Crear el componente**

Crea `components/tickets/ticket-confirm-dialog.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Ticket as TicketIcon, MessageCircle, Printer, Download, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { emitirTicketDePago, enviarTicketWhatsApp } from '@/lib/actions/tickets'
import type { Ticket } from '@/lib/types'

interface Props {
    abierto: boolean
    onCerrar: () => void
    pagoId: string | null
    clienteNombre: string
    clienteTelefono: string | null
    puedeImprimir?: boolean
}

function telefonoValido(t: string | null): boolean {
    return !!t && t.replace(/\D/g, '').length >= 10
}

export function TicketConfirmDialog({
    abierto, onCerrar, pagoId, clienteNombre, clienteTelefono, puedeImprimir = false,
}: Props) {
    const [pendiente, startTransition] = useTransition()
    const [emitido, setEmitido] = useState<Ticket | null>(null)

    const hayTelefono = telefonoValido(clienteTelefono)

    const cerrar = () => {
        setEmitido(null)
        onCerrar()
    }

    const emitir = (enviar: boolean) => {
        if (!pagoId) return
        startTransition(async () => {
            try {
                const { ticket, yaExistia } = await emitirTicketDePago(pagoId)
                setEmitido(ticket)

                toast.success(
                    yaExistia
                        ? `Este pago ya tenía el boleto ${ticket.numero_formateado}`
                        : `Boleto ${ticket.numero_formateado} generado`,
                )

                if (enviar) {
                    await enviarTicketWhatsApp(ticket.id)
                    toast.success('Boleto enviado por WhatsApp')
                    cerrar()
                }
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error al generar el boleto')
            }
        })
    }

    return (
        <Dialog open={abierto} onOpenChange={(v) => { if (!v) cerrar() }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <TicketIcon className="h-5 w-5 text-[#007EC6]" />
                        Pago registrado
                    </DialogTitle>
                    <DialogDescription>
                        ¿Generar el boleto de sorteo para <strong>{clienteNombre}</strong>?
                    </DialogDescription>
                </DialogHeader>

                {emitido && (
                    <div className="rounded-xl border border-white/10 bg-slate-800/50 p-4 text-center">
                        <p className="text-xs uppercase tracking-widest text-slate-400">
                            Boleto generado
                        </p>
                        <p className="mt-1 text-2xl font-bold tracking-wider text-white">
                            {emitido.numero_formateado}
                        </p>
                    </div>
                )}

                {!hayTelefono && (
                    <p className="rounded-lg bg-amber-500/15 px-3 py-2 text-xs text-amber-300">
                        Este cliente no tiene un teléfono válido registrado, así que no se
                        puede enviar por WhatsApp. Puedes imprimirlo o descargarlo.
                    </p>
                )}

                <div className="space-y-2">
                    <Button
                        className="w-full justify-start gap-2"
                        disabled={pendiente || !hayTelefono || !!emitido}
                        onClick={() => emitir(true)}
                        style={{ background: 'linear-gradient(135deg,#25D366,#128C7E)' }}
                    >
                        <MessageCircle className="h-4 w-4" />
                        Generar y enviar por WhatsApp
                    </Button>

                    <Button
                        variant="outline"
                        className="w-full justify-start gap-2"
                        disabled
                        title={puedeImprimir ? undefined : 'Disponible al instalar la impresora'}
                    >
                        <Printer className="h-4 w-4" />
                        Generar e imprimir
                        <span className="ml-auto text-[10px] text-slate-500">Próximamente</span>
                    </Button>

                    <Button
                        variant="outline"
                        className="w-full justify-start gap-2"
                        disabled={pendiente || !!emitido}
                        onClick={() => emitir(false)}
                    >
                        <TicketIcon className="h-4 w-4" />
                        Solo generar
                    </Button>

                    {emitido && (
                        <a
                            href={`/api/tickets/${emitido.token_publico}/pdf`}
                            target="_blank"
                            rel="noreferrer"
                            className="flex w-full items-center gap-2 rounded-md border border-white/10 px-4 py-2 text-sm text-slate-200 hover:bg-white/5"
                        >
                            <Download className="h-4 w-4" />
                            Descargar PDF
                        </a>
                    )}

                    <Button
                        variant="ghost"
                        className="w-full justify-start gap-2 text-slate-400"
                        disabled={pendiente}
                        onClick={cerrar}
                    >
                        <X className="h-4 w-4" />
                        {emitido ? 'Cerrar' : 'No generar'}
                    </Button>
                </div>

                {!emitido && (
                    <p className="text-[11px] text-slate-500">
                        Si cierras sin generar, podrás emitir el boleto después desde el
                        perfil del cliente.
                    </p>
                )}
            </DialogContent>
        </Dialog>
    )
}
```

- [ ] **Paso 2: Cablearlo en el panel flotante**

En `components/layout/pagos-pendientes-panel.tsx`:

Añade el import:

```ts
import { TicketConfirmDialog } from '@/components/tickets/ticket-confirm-dialog'
```

Añade el estado, junto a los demás `useState`:

```ts
    const [ticketDialog, setTicketDialog] = useState<{
        pagoId: string; nombre: string; telefono: string | null
    } | null>(null)
```

Reemplaza `handleMarcarPagado` por:

```ts
    const handleMarcarPagado = useCallback((deuda: DeudaPendiente) => {
        const periodo = getPeriodoActual(deuda)
        startTransition(async () => {
            try {
                const { pagoId } = await marcarPagoPeriodo(deuda.id, periodo)
                toast.success(`Pago registrado para ${deuda.cliente?.nombre ?? 'cliente'}`)
                setDismissed(prev => new Set([...prev, deuda.id]))
                setTicketDialog({
                    pagoId,
                    nombre: `${deuda.cliente?.nombre ?? ''} ${deuda.cliente?.apellido ?? ''}`.trim(),
                    telefono: deuda.cliente?.telefono ?? null,
                })
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error al registrar pago')
            }
        })
    }, [])
```

Y justo antes del `</div>` que cierra el componente (después del botón flotante), añade:

```tsx
            <TicketConfirmDialog
                abierto={!!ticketDialog}
                onCerrar={() => setTicketDialog(null)}
                pagoId={ticketDialog?.pagoId ?? null}
                clienteNombre={ticketDialog?.nombre ?? ''}
                clienteTelefono={ticketDialog?.telefono ?? null}
            />
```

Importante: el `if (total === 0) return null` de la línea 97 haría desaparecer el diálogo al
descartar el último pendiente. Cámbialo por:

```ts
    if (total === 0 && !ticketDialog) return null
```

- [ ] **Paso 3: Cablearlo en la vista de cuentas**

En `components/cuentas/cuentas-view.tsx`, añade el mismo import y estado, y en
`handleRegistrarPago` captura el resultado de las dos llamadas. Las dos ramas quedan:

```ts
            startTransition(async () => {
                try {
                    const { pagoId } = await marcarPagoPeriodo(
                        pagoDialog.id, periodo, 'Pago registrado desde cuentas',
                    )
                    toast.success('Pago registrado correctamente')
                    setTicketDialog({
                        pagoId,
                        nombre: `${pagoDialog.cliente?.nombre ?? ''} ${pagoDialog.cliente?.apellido ?? ''}`.trim(),
                        telefono: pagoDialog.cliente?.telefono ?? null,
                    })
                    setPagoDialog(null)
                    setMontoPago('')
                } catch (e: unknown) {
                    toast.error(e instanceof Error ? e.message : 'Error')
                }
            })
```

```ts
        startTransition(async () => {
            try {
                const { pagoId } = await registrarPago(pagoDialog.id, monto)
                toast.success('Pago registrado correctamente')
                setTicketDialog({
                    pagoId,
                    nombre: `${pagoDialog.cliente?.nombre ?? ''} ${pagoDialog.cliente?.apellido ?? ''}`.trim(),
                    telefono: pagoDialog.cliente?.telefono ?? null,
                })
                setPagoDialog(null)
                setMontoPago('')
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error')
            }
        })
```

Renderiza `<TicketConfirmDialog />` con las mismas props al final del JSX del componente.

Nota: si el objeto de `pagoDialog` no trae el cliente anidado, tómalo de la fila de la deuda
que ya se está mostrando en la tabla; la vista ya hace join con `cliente:clientes(...)`.

- [ ] **Paso 4: Verificar**

Ejecuta: `npx tsc --noEmit`
Esperado: sin errores nuevos.

Con `npm run dev`:

1. Marca un pago desde el panel flotante. Aparece el modal con el nombre del cliente.
2. Pulsa "Solo generar". Aparece el número de boleto y el enlace de descarga.
3. Vuelve a marcar un pago del mismo período y pulsa generar otra vez: debe decir
   "Este pago ya tenía el boleto ...". *(Requiere que sea el mismo `pagoId`; para probar la
   idempotencia de verdad, haz doble clic rápido en "Solo generar".)*
4. Con un cliente sin teléfono, comprueba que el botón de WhatsApp está deshabilitado y
   aparece el aviso.
5. Repite desde `/cuentas` en las dos rutas de pago (con monto y sin monto).

- [ ] **Paso 5: Commit**

```bash
git add components/tickets/ticket-confirm-dialog.tsx components/layout/pagos-pendientes-panel.tsx components/cuentas/cuentas-view.tsx
git commit -m "feat: modal de confirmación de boleto tras registrar el pago"
```

---

## Tarea 9: Boletos en el perfil del cliente

**Files:**
- Create: `components/tickets/tickets-cliente-panel.tsx`
- Create: `components/tickets/ticket-manual-dialog.tsx`
- Modify: `app/(dashboard)/clientes/[id]/page.tsx`

**Interfaces:**
- Consumes: `getTicketsCliente`, `getPagosSinTicket`, `emitirTicketManual`, `emitirTicketDePago`, `enviarTicketWhatsApp`, `anularTicket`
- Produces: `<TicketsClientePanel />`, `<TicketManualDialog />`

- [ ] **Paso 1: Crear el diálogo de boleto manual**

Crea `components/tickets/ticket-manual-dialog.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { emitirTicketManual, enviarTicketWhatsApp } from '@/lib/actions/tickets'

interface Props {
    abierto: boolean
    onCerrar: () => void
    clienteId: string
    clienteNombre: string
    tieneTelefono: boolean
}

export function TicketManualDialog({
    abierto, onCerrar, clienteId, clienteNombre, tieneTelefono,
}: Props) {
    const [motivo, setMotivo] = useState('')
    const [pendiente, startTransition] = useTransition()

    const emitir = (enviar: boolean) => {
        if (motivo.trim().length < 3) {
            toast.error('El motivo debe tener al menos 3 caracteres')
            return
        }
        startTransition(async () => {
            try {
                const { ticket } = await emitirTicketManual({
                    cliente_id: clienteId,
                    motivo: motivo.trim(),
                })
                toast.success(`Boleto ${ticket.numero_formateado} generado`)

                if (enviar) {
                    await enviarTicketWhatsApp(ticket.id)
                    toast.success('Boleto enviado por WhatsApp')
                }

                setMotivo('')
                onCerrar()
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error al generar el boleto')
            }
        })
    }

    return (
        <Dialog open={abierto} onOpenChange={(v) => { if (!v) onCerrar() }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Generar boleto manual</DialogTitle>
                    <DialogDescription>
                        Se emitirá un boleto adicional para {clienteNombre}, sin asociarlo a
                        ningún pago.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-2">
                    <Label htmlFor="motivo">Motivo (obligatorio)</Label>
                    <Input
                        id="motivo"
                        value={motivo}
                        onChange={e => setMotivo(e.target.value)}
                        placeholder="Ej: promoción de temporada"
                        maxLength={200}
                        disabled={pendiente}
                    />
                    <p className="text-[11px] text-slate-500">
                        Queda registrado en el historial del boleto.
                    </p>
                </div>

                <div className="space-y-2">
                    <Button
                        className="w-full"
                        disabled={pendiente || !tieneTelefono}
                        onClick={() => emitir(true)}
                        style={{ background: 'linear-gradient(135deg,#25D366,#128C7E)' }}
                    >
                        Generar y enviar por WhatsApp
                    </Button>
                    <Button
                        variant="outline"
                        className="w-full"
                        disabled={pendiente}
                        onClick={() => emitir(false)}
                    >
                        Solo generar
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
```

- [ ] **Paso 2: Crear el panel de boletos del cliente**

Crea `components/tickets/tickets-cliente-panel.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Plus, Download, Send, Ban, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { TicketManualDialog } from './ticket-manual-dialog'
import {
    emitirTicketDePago, enviarTicketWhatsApp, anularTicket,
} from '@/lib/actions/tickets'
import { formatearFechaHoraRD } from '@/lib/utils/fecha-rd'
import { ESTADO_TICKET_COLORS, ESTADO_TICKET_LABELS, ORIGEN_TICKET_LABELS } from '@/lib/types'
import type { Ticket } from '@/lib/types'

interface PagoSinBoleto {
    id: string
    monto: number
    periodo: string
    created_at: string
}

interface Props {
    clienteId: string
    clienteNombre: string
    tieneTelefono: boolean
    tickets: Ticket[]
    pagosSinTicket: PagoSinBoleto[]
    puedeGenerar: boolean
}

export function TicketsClientePanel({
    clienteId, clienteNombre, tieneTelefono, tickets, pagosSinTicket, puedeGenerar,
}: Props) {
    const [manualAbierto, setManualAbierto] = useState(false)
    const [pendiente, startTransition] = useTransition()

    const emitirDePago = (pagoId: string) => {
        startTransition(async () => {
            try {
                const { ticket } = await emitirTicketDePago(pagoId)
                toast.success(`Boleto ${ticket.numero_formateado} generado`)
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error')
            }
        })
    }

    const reenviar = (ticketId: string) => {
        startTransition(async () => {
            try {
                await enviarTicketWhatsApp(ticketId, { reenvio: true })
                toast.success('Boleto reenviado')
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error')
            }
        })
    }

    const anular = (ticketId: string) => {
        const motivo = window.prompt('Motivo de la anulación:')
        if (!motivo || motivo.trim().length < 3) return
        startTransition(async () => {
            try {
                await anularTicket(ticketId, motivo.trim())
                toast.success('Boleto anulado')
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error')
            }
        })
    }

    return (
        <div className="rounded-2xl border border-white/5 bg-slate-800/50 p-5">
            <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">
                    Boletos ({tickets.length})
                </h2>
                {puedeGenerar && (
                    <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 text-xs"
                        onClick={() => setManualAbierto(true)}
                    >
                        <Plus className="h-3 w-3" />
                        Boleto manual
                    </Button>
                )}
            </div>

            {pagosSinTicket.length > 0 && puedeGenerar && (
                <div className="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3">
                    <p className="flex items-center gap-2 text-xs font-medium text-amber-300">
                        <AlertCircle className="h-3.5 w-3.5" />
                        {pagosSinTicket.length} pago{pagosSinTicket.length > 1 ? 's' : ''} sin boleto
                    </p>
                    <div className="mt-2 space-y-1">
                        {pagosSinTicket.map(p => (
                            <div key={p.id} className="flex items-center justify-between gap-2 text-xs">
                                <span className="text-slate-400">
                                    {formatearFechaHoraRD(p.created_at)} · período {p.periodo}
                                </span>
                                <Button
                                    size="sm"
                                    className="h-6 px-2 text-[10px]"
                                    disabled={pendiente}
                                    onClick={() => emitirDePago(p.id)}
                                >
                                    Emitir boleto
                                </Button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {tickets.length === 0 ? (
                <p className="text-xs text-slate-600">Sin boletos emitidos</p>
            ) : (
                <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                    {tickets.map(t => (
                        <div
                            key={t.id}
                            className="flex items-center justify-between gap-3 border-b border-white/5 pb-2 last:border-0"
                        >
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="font-mono text-sm font-semibold text-white">
                                        {t.numero_formateado}
                                    </span>
                                    <span className={cn(
                                        'rounded px-1.5 py-0.5 text-[10px] font-medium',
                                        ESTADO_TICKET_COLORS[t.estado],
                                    )}>
                                        {ESTADO_TICKET_LABELS[t.estado]}
                                    </span>
                                    <span className="text-[10px] text-slate-500">
                                        {ORIGEN_TICKET_LABELS[t.origen]}
                                    </span>
                                </div>
                                <p className="mt-0.5 text-[11px] text-slate-500">
                                    {formatearFechaHoraRD(t.emitido_at)}
                                    {t.snapshot.sorteo ? ` · ${t.snapshot.sorteo.nombre}` : ' · sin sorteo'}
                                    {t.veces_enviado > 0 ? ` · enviado ${t.veces_enviado}×` : ''}
                                </p>
                            </div>

                            <div className="flex shrink-0 items-center gap-1">
                                <a
                                    href={`/api/tickets/${t.token_publico}/pdf`}
                                    target="_blank"
                                    rel="noreferrer"
                                    title="Descargar PDF"
                                    className="rounded p-1.5 text-slate-400 hover:bg-white/5 hover:text-white"
                                >
                                    <Download className="h-3.5 w-3.5" />
                                </a>
                                {t.estado === 'valido' && (
                                    <>
                                        <button
                                            title="Reenviar por WhatsApp"
                                            disabled={pendiente || !tieneTelefono}
                                            onClick={() => reenviar(t.id)}
                                            className="rounded p-1.5 text-slate-400 hover:bg-white/5 hover:text-green-400 disabled:opacity-30"
                                        >
                                            <Send className="h-3.5 w-3.5" />
                                        </button>
                                        {puedeGenerar && (
                                            <button
                                                title="Anular boleto"
                                                disabled={pendiente}
                                                onClick={() => anular(t.id)}
                                                className="rounded p-1.5 text-slate-400 hover:bg-white/5 hover:text-red-400 disabled:opacity-30"
                                            >
                                                <Ban className="h-3.5 w-3.5" />
                                            </button>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <TicketManualDialog
                abierto={manualAbierto}
                onCerrar={() => setManualAbierto(false)}
                clienteId={clienteId}
                clienteNombre={clienteNombre}
                tieneTelefono={tieneTelefono}
            />
        </div>
    )
}
```

- [ ] **Paso 3: Insertarlo en la página del cliente**

En `app/(dashboard)/clientes/[id]/page.tsx`:

Añade los imports:

```ts
import { getTicketsCliente, getPagosSinTicket } from '@/lib/actions/tickets'
import { getPermisos } from '@/lib/utils/permisos'
import { TicketsClientePanel } from '@/components/tickets/tickets-cliente-panel'
```

Después de la consulta de `logs` (línea ~54), añade:

```ts
    const { data: { user } } = await supabase.auth.getUser()
    const { data: perfil } = await supabase
        .from('profiles')
        .select('id, rol, permisos')
        .eq('id', user!.id)
        .single()

    const permisos = getPermisos(perfil!)

    const tickets = permisos.ver_tickets ? await getTicketsCliente(id) : []
    const pagosSinTicket = permisos.ver_tickets ? await getPagosSinTicket(id) : []
```

Y dentro de la columna derecha (`<div className="lg:col-span-2 space-y-4">`), justo antes del
bloque de "Historial de envíos", añade:

```tsx
                    {permisos.ver_tickets && (
                        <TicketsClientePanel
                            clienteId={cliente.id}
                            clienteNombre={`${cliente.nombre} ${cliente.apellido}`}
                            tieneTelefono={(cliente.telefono ?? '').replace(/\D/g, '').length >= 10}
                            tickets={tickets}
                            pagosSinTicket={pagosSinTicket}
                            puedeGenerar={permisos.generar_ticket_manual}
                        />
                    )}
```

- [ ] **Paso 4: Verificar**

Ejecuta: `npx tsc --noEmit`
Esperado: sin errores nuevos.

Con `npm run dev`, abre el perfil de un cliente:

1. Se ve el panel de boletos.
2. "Boleto manual" exige motivo y genera el boleto.
3. El icono de descarga abre el PDF.
4. Anular pide motivo, cambia el estado y desaparecen las acciones de envío.
5. Registra un pago sin generar boleto (cierra el modal con "No generar") y recarga el
   perfil: debe aparecer el aviso "1 pago sin boleto" con su botón para emitirlo.

- [ ] **Paso 5: Commit**

```bash
git add components/tickets/tickets-cliente-panel.tsx components/tickets/ticket-manual-dialog.tsx "app/(dashboard)/clientes/[id]/page.tsx"
git commit -m "feat: panel de boletos en el perfil del cliente"
```

---

## Tarea 10: Listado de boletos y pantalla de configuración

**Files:**
- Create: `components/tickets/tickets-view.tsx`
- Create: `app/(dashboard)/tickets/page.tsx`
- Create: `components/configuracion/configuracion-ticket-view.tsx`
- Create: `app/(dashboard)/configuracion/tickets/page.tsx`
- Create: `lib/actions/configuracion-ticket.ts`
- Modify: `lib/actions/tickets.ts` (añadir `getTickets`)
- Modify: `components/layout/app-sidebar.tsx` (entrada de configuración)

**Interfaces:**
- Consumes: todo lo anterior
- Produces:
  - `getTickets(filtros): Promise<Ticket[]>`
  - `getConfiguracionTicket(): Promise<ConfiguracionTicket>`
  - `actualizarConfiguracionTicket(input): Promise<void>`

- [ ] **Paso 1: Añadir la consulta con filtros**

Añade a `lib/actions/tickets.ts`:

```ts
export interface FiltrosTickets {
    busqueda?: string
    estado?: 'valido' | 'anulado'
    origen?: 'automatico' | 'manual'
    sorteoId?: string
    soloHuerfanos?: boolean
    desde?: string   // fecha RD 'YYYY-MM-DD'
    hasta?: string   // fecha RD 'YYYY-MM-DD'
}

export async function getTickets(filtros: FiltrosTickets = {}): Promise<Ticket[]> {
    const supabase = await createClient()

    let query = supabase
        .from('tickets')
        .select('*, cliente:clientes(id, nombre, apellido, telefono), sorteo:sorteos(id, nombre)')
        .order('emitido_at', { ascending: false })
        .limit(300)

    if (filtros.estado) query = query.eq('estado', filtros.estado)
    if (filtros.origen) query = query.eq('origen', filtros.origen)
    if (filtros.sorteoId) query = query.eq('sorteo_id', filtros.sorteoId)
    if (filtros.soloHuerfanos) query = query.is('sorteo_id', null)

    if (filtros.desde && filtros.hasta) {
        const { desdeISO, hastaISO } = rangoRDaUTC(filtros.desde, filtros.hasta)
        query = query.gte('emitido_at', desdeISO).lte('emitido_at', hastaISO)
    }

    if (filtros.busqueda?.trim()) {
        query = query.ilike('numero_formateado', `%${filtros.busqueda.trim()}%`)
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)
    return (data ?? []) as Ticket[]
}
```

Añade el import correspondiente al inicio del archivo:

```ts
import { rangoRDaUTC } from '@/lib/utils/fecha-rd'
```

- [ ] **Paso 2: Crear las acciones de configuración**

Crea `lib/actions/configuracion-ticket.ts`:

```ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import {
    ConfiguracionTicketSchema,
    type ConfiguracionTicketFormData,
} from '@/lib/validations/tickets'
import type { ConfiguracionTicket } from '@/lib/types'

export async function getConfiguracionTicket(): Promise<ConfiguracionTicket> {
    const supabase = await createClient()

    const { data, error } = await supabase
        .from('configuracion_ticket')
        .select('*')
        .eq('id', true)
        .single()

    if (error) throw new Error(error.message)
    return data as ConfiguracionTicket
}

export async function actualizarConfiguracionTicket(
    input: ConfiguracionTicketFormData,
): Promise<void> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('No autenticado')

    const { data: perfil } = await supabase
        .from('profiles').select('rol').eq('id', user.id).single()

    if (perfil?.rol !== 'admin') {
        throw new Error('Solo un administrador puede cambiar esta configuración')
    }

    const validado = ConfiguracionTicketSchema.parse(input)

    const { error } = await supabase
        .from('configuracion_ticket')
        .update({
            ...validado,
            logo_url: validado.logo_url || null,
            url_terminos: validado.url_terminos || null,
            updated_at: new Date().toISOString(),
            updated_by: user.id,
        })
        .eq('id', true)

    if (error) throw new Error(error.message)

    revalidatePath('/configuracion/tickets')
    revalidatePath('/tickets')
}
```

- [ ] **Paso 3: Crear la vista del listado**

Crea `components/tickets/tickets-view.tsx`, componente de cliente que filtra en memoria.
Sigue el patrón visual de `components/logs/logs-view.tsx`: barra de herramientas con `Input`
de búsqueda y `Select` de filtros arriba, `Table` de shadcn debajo.

Usa exactamente esta interfaz de props. El Plan 3 la extiende para la asignación masiva de
boletos huérfanos, así que los nombres tienen que coincidir:

```ts
interface TicketsViewProps {
    tickets: Ticket[]
    sorteos: { id: string; nombre: string }[]
    puedeAnular: boolean
    puedeAsignarSorteo: boolean
}
```

Columnas: Número (fuente mono), Cliente, Sorteo (o la etiqueta "Sin sorteo"), Origen, Estado,
Emitido (con `formatearFechaHoraRD`), Acciones (descargar PDF, reenviar, anular).

Filtros: búsqueda por número, `Select` de estado, `Select` de origen, `Select` de sorteo, y
un interruptor "Solo huérfanos".

Reutiliza `ESTADO_TICKET_COLORS`, `ESTADO_TICKET_LABELS` y `ORIGEN_TICKET_LABELS` de
`@/lib/types`, y las mismas acciones (`enviarTicketWhatsApp`, `anularTicket`) que ya usa
`tickets-cliente-panel.tsx`.

- [ ] **Paso 4: Crear las páginas**

Crea `app/(dashboard)/tickets/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPermisos } from '@/lib/utils/permisos'
import { getTickets } from '@/lib/actions/tickets'
import { TicketsView } from '@/components/tickets/tickets-view'
import { PageHeader } from '@/components/layout/page-header'

export default async function TicketsPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { data: perfil } = await supabase
        .from('profiles').select('id, rol, permisos').eq('id', user!.id).single()

    const permisos = getPermisos(perfil!)
    if (!permisos.ver_tickets) redirect('/dashboard')

    const tickets = await getTickets()
    const { data: sorteos } = await supabase
        .from('sorteos').select('id, nombre').order('created_at', { ascending: false })

    return (
        <div className="space-y-6 p-6">
            <PageHeader
                title="Boletos"
                description="Boletos de sorteo emitidos a los clientes"
            />
            <TicketsView
                tickets={tickets}
                sorteos={sorteos ?? []}
                puedeAnular={permisos.generar_ticket_manual}
                puedeAsignarSorteo={permisos.realizar_sorteo}
            />
        </div>
    )
}
```

Comprueba antes la firma real de `PageHeader` en `components/layout/page-header.tsx` y ajusta
los nombres de las props si difieren.

Crea `app/(dashboard)/configuracion/tickets/page.tsx` siguiendo el mismo patrón, con
`redirect('/dashboard')` si el rol no es `admin`, y renderizando
`<ConfiguracionTicketView configuracion={...} />`.

- [ ] **Paso 5: Crear el formulario de configuración**

Crea `components/configuracion/configuracion-ticket-view.tsx`. Componente de cliente con
`react-hook-form` + `zodResolver(ConfiguracionTicketSchema)`, siguiendo el patrón de
`components/clientes/cliente-form.tsx`.

Campos: `nombre_comercial`, `rnc`, `direccion`, `telefono`, `logo_url`, `texto_legal`
(textarea), `url_terminos`, `prefijo_numeracion`, `pie_impresion` (textarea), y
`modo_adjunto` como `Select` con las cuatro opciones y esta ayuda debajo:

> **base64** — el PDF viaja dentro del mensaje al webhook. Funciona sin exponer el servidor a
> internet. Es lo recomendado.
> **url** — solo se envía el enlace. Requiere que este servidor sea alcanzable desde internet.
> **ambos** — envía las dos cosas, útil para depurar.
> **ninguno** — solo texto, sin adjunto.

Añade además un botón **"Enviar boleto de prueba"** que llame a `enviarBoletoDePrueba()` y
muestre el código HTTP y el cuerpo de la respuesta en un bloque `<pre>`, para que el
administrador averigüe qué acepta su proveedor de WhatsApp:

```tsx
    const [resultado, setResultado] = useState<{ ok: boolean; estado: number; cuerpo: string } | null>(null)

    const probar = () => {
        startTransition(async () => {
            try {
                setResultado(await enviarBoletoDePrueba())
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error')
            }
        })
    }
```

- [ ] **Paso 6: Añadir la entrada del sidebar**

En `components/layout/app-sidebar.tsx`, añade a `ALL_NAV`:

```ts
    { href: '/configuracion/tickets', label: 'Config. Boletos', icon: Settings, permiso: 'admin_only' },
```

Importa `Settings` de `lucide-react`.

- [ ] **Paso 7: Verificar**

Ejecuta: `npm test && npx tsc --noEmit`
Esperado: todo en verde.

Con `npm run dev`:

1. `/tickets` lista los boletos y los filtros funcionan.
2. `/configuracion/tickets` guarda los cambios y se reflejan en el siguiente boleto emitido
   (los ya emitidos conservan su snapshot: eso es lo correcto).
3. "Enviar boleto de prueba" muestra la respuesta del webhook.
4. Con una cuenta de agente sin `ver_tickets`, `/tickets` redirige al dashboard.

- [ ] **Paso 8: Commit**

```bash
git add components/tickets/tickets-view.tsx "app/(dashboard)/tickets/page.tsx" components/configuracion/configuracion-ticket-view.tsx "app/(dashboard)/configuracion/tickets/page.tsx" lib/actions/configuracion-ticket.ts lib/actions/tickets.ts components/layout/app-sidebar.tsx
git commit -m "feat: listado de boletos y pantalla de configuración"
```

---

## Verificación final del Plan 1

- [ ] `npm test` — todas las pruebas en verde
- [ ] `npx tsc --noEmit` — sin errores
- [ ] `npm run build` — el build de producción completa
- [ ] Los cinco guiones SQL de `supabase/tests/` pasan
- [ ] La cobranza sigue enviando recordatorios con dos webhooks activos en la tabla
- [ ] Un pago genera boleto, el boleto llega por WhatsApp con el PDF adjunto
- [ ] El PDF muestra correctamente ñ y vocales acentuadas
- [ ] Una cuenta de agente sin permisos de boletos no ve el módulo

**Al terminar, continúa con el Plan 2 (impresión POS).**
