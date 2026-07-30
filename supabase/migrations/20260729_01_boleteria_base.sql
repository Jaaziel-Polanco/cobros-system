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
