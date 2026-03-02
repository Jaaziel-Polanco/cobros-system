-- ============================================================
-- PLATAFORMA CUENTAS POR COBRAR — INVERSIONES CORDERO
-- Schema SQL para Supabase
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- ============================================================

-- ─── EXTENSIONES ─────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── TABLA: profiles ─────────────────────────────────────────
-- Extiende auth.users con rol y nombre completo
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   TEXT NOT NULL,
  rol         TEXT NOT NULL DEFAULT 'agente' CHECK (rol IN ('admin','agente')),
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── TABLA: clientes ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clientes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre          TEXT NOT NULL,
  apellido        TEXT NOT NULL,
  dni_ruc         TEXT,
  telefono        TEXT NOT NULL,
  email           TEXT,
  direccion       TEXT,
  notas           TEXT,
  agente_id       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── TABLA: deudas ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.deudas (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cliente_id          UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  descripcion         TEXT,
  monto_original      NUMERIC(14,2) NOT NULL CHECK (monto_original >= 0),
  saldo_pendiente     NUMERIC(14,2) NOT NULL CHECK (saldo_pendiente >= 0),
  tasa_interes        NUMERIC(6,4) NOT NULL DEFAULT 0 CHECK (tasa_interes >= 0),
  -- fecha en que vence / fecha de corte de pago
  fecha_corte         DATE NOT NULL,
  -- si la deuda ya existía antes del sistema (deuda heredada)
  es_deuda_existente  BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_deuda_origen  DATE,               -- fecha real de inicio de la deuda
  dias_atraso         INTEGER NOT NULL DEFAULT 0,
  etapa               TEXT NOT NULL DEFAULT 'preventivo'
                        CHECK (etapa IN ('preventivo','mora_temprana','mora_alta','recuperacion','saldado')),
  pausado             BOOLEAN NOT NULL DEFAULT FALSE,
  estado              TEXT NOT NULL DEFAULT 'activo'
                        CHECK (estado IN ('activo','saldado','cancelado','refinanciado')),
  agente_id           UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── TABLA: configuracion_recordatorio ───────────────────────
-- Configuración de recordatorio por deuda
CREATE TABLE IF NOT EXISTS public.configuracion_recordatorio (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deuda_id              UUID NOT NULL UNIQUE REFERENCES public.deudas(id) ON DELETE CASCADE,
  dias_antes_vencimiento INTEGER NOT NULL DEFAULT 3,  -- días antes de fecha_corte para preventivo
  frecuencia_mora_h      INTEGER NOT NULL DEFAULT 48, -- horas entre recordatorios en mora
  frecuencia_recuperacion_h INTEGER NOT NULL DEFAULT 72,
  activo                BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── TABLA: referencias_cliente ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.referencias_cliente (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cliente_id      UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  nombre          TEXT NOT NULL,
  telefono        TEXT NOT NULL,
  relacion        TEXT,                 -- familiar, amigo, trabajo, etc.
  estado_contacto TEXT NOT NULL DEFAULT 'pendiente'
                    CHECK (estado_contacto IN ('pendiente','contactado','entregado','no_responde')),
  notas           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── TABLA: plantillas_mensaje ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.plantillas_mensaje (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre      TEXT NOT NULL,
  etapa       TEXT NOT NULL
                CHECK (etapa IN ('preventivo','mora_temprana','mora_alta','recuperacion','referencia')),
  contenido   TEXT NOT NULL,
  -- variables disponibles: {{nombre}}, {{apellido}}, {{monto}}, {{saldo}},
  -- {{fecha_corte}}, {{dias_atraso}}, {{tasa_interes}}, {{agente}}
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── TABLA: webhooks ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.webhooks (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre      TEXT NOT NULL,
  url         TEXT NOT NULL,
  descripcion TEXT,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  headers     JSONB DEFAULT '{}',       -- headers adicionales opcionales
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── TABLA: envios_log ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.envios_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deuda_id        UUID NOT NULL REFERENCES public.deudas(id) ON DELETE CASCADE,
  cliente_id      UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  webhook_id      UUID REFERENCES public.webhooks(id) ON DELETE SET NULL,
  plantilla_id    UUID REFERENCES public.plantillas_mensaje(id) ON DELETE SET NULL,
  etapa           TEXT NOT NULL,
  mensaje_enviado TEXT NOT NULL,
  payload         JSONB NOT NULL,
  tipo_destino    TEXT NOT NULL DEFAULT 'cliente'
                    CHECK (tipo_destino IN ('cliente','referencia')),
  referencia_id   UUID REFERENCES public.referencias_cliente(id) ON DELETE SET NULL,
  estado          TEXT NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente','enviado','error','omitido')),
  respuesta_http  INTEGER,
  respuesta_body  TEXT,
  enviado_por     TEXT NOT NULL DEFAULT 'cron'
                    CHECK (enviado_por IN ('cron','manual')),
  agente_id       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── ÍNDICES ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_deudas_cliente ON public.deudas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_deudas_etapa ON public.deudas(etapa);
CREATE INDEX IF NOT EXISTS idx_deudas_estado ON public.deudas(estado);
CREATE INDEX IF NOT EXISTS idx_deudas_fecha_corte ON public.deudas(fecha_corte);
CREATE INDEX IF NOT EXISTS idx_envios_log_deuda ON public.envios_log(deuda_id);
CREATE INDEX IF NOT EXISTS idx_envios_log_sent_at ON public.envios_log(sent_at);
CREATE INDEX IF NOT EXISTS idx_clientes_agente ON public.clientes(agente_id);
CREATE INDEX IF NOT EXISTS idx_referencias_cliente ON public.referencias_cliente(cliente_id);

-- ─── FUNCIÓN: actualizar updated_at automáticamente ──────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers de updated_at
CREATE OR REPLACE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER trg_clientes_updated_at
  BEFORE UPDATE ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER trg_deudas_updated_at
  BEFORE UPDATE ON public.deudas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER trg_conf_recordatorio_updated_at
  BEFORE UPDATE ON public.configuracion_recordatorio
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER trg_referencias_updated_at
  BEFORE UPDATE ON public.referencias_cliente
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER trg_plantillas_updated_at
  BEFORE UPDATE ON public.plantillas_mensaje
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER trg_webhooks_updated_at
  BEFORE UPDATE ON public.webhooks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── FUNCIÓN: calcular etapa de cobranza ─────────────────────
CREATE OR REPLACE FUNCTION public.calcular_etapa_cobranza(dias INTEGER)
RETURNS TEXT AS $$
BEGIN
  IF dias <= 0 THEN RETURN 'preventivo'; END IF;
  IF dias <= 15 THEN RETURN 'mora_temprana'; END IF;
  IF dias <= 30 THEN RETURN 'mora_alta'; END IF;
  RETURN 'recuperacion';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ─── FUNCIÓN: actualizar dias_atraso y etapa en deudas ───────
CREATE OR REPLACE FUNCTION public.actualizar_dias_atraso()
RETURNS void AS $$
BEGIN
  UPDATE public.deudas
  SET
    dias_atraso = GREATEST(0, CURRENT_DATE - fecha_corte),
    etapa = CASE
      WHEN estado = 'saldado' THEN 'saldado'
      WHEN estado = 'cancelado' THEN etapa
      ELSE public.calcular_etapa_cobranza(GREATEST(0, CURRENT_DATE - fecha_corte))
    END,
    updated_at = NOW()
  WHERE estado = 'activo' AND pausado = FALSE;
END;
$$ LANGUAGE plpgsql;

-- ─── FUNCIÓN: crear profile al registrar usuario ─────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, rol)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'rol', 'agente')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─── ROW LEVEL SECURITY ───────────────────────────────────────
ALTER TABLE public.profiles                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deudas                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuracion_recordatorio ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referencias_cliente       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plantillas_mensaje        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhooks                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.envios_log               ENABLE ROW LEVEL SECURITY;

-- Helper: obtener rol del usuario actual
CREATE OR REPLACE FUNCTION public.get_my_rol()
RETURNS TEXT AS $$
  SELECT rol FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- ── Policies: profiles ──
CREATE POLICY "profiles: admin full access"
  ON public.profiles FOR ALL
  USING (public.get_my_rol() = 'admin');

CREATE POLICY "profiles: agente lee su propio perfil"
  ON public.profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "profiles: agente actualiza su propio perfil"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid());

-- ── Policies: clientes ──
CREATE POLICY "clientes: admin full access"
  ON public.clientes FOR ALL
  USING (public.get_my_rol() = 'admin');

CREATE POLICY "clientes: agente ve sus asignados"
  ON public.clientes FOR SELECT
  USING (agente_id = auth.uid() OR public.get_my_rol() = 'admin');

CREATE POLICY "clientes: agente puede crear"
  ON public.clientes FOR INSERT
  WITH CHECK (public.get_my_rol() IN ('admin','agente'));

CREATE POLICY "clientes: agente actualiza sus asignados"
  ON public.clientes FOR UPDATE
  USING (agente_id = auth.uid() OR public.get_my_rol() = 'admin');

-- ── Policies: deudas ──
CREATE POLICY "deudas: admin full access"
  ON public.deudas FOR ALL
  USING (public.get_my_rol() = 'admin');

CREATE POLICY "deudas: agente ve sus deudas"
  ON public.deudas FOR SELECT
  USING (agente_id = auth.uid() OR public.get_my_rol() = 'admin');

CREATE POLICY "deudas: agente puede crear/actualizar"
  ON public.deudas FOR INSERT
  WITH CHECK (public.get_my_rol() IN ('admin','agente'));

CREATE POLICY "deudas: agente actualiza sus deudas"
  ON public.deudas FOR UPDATE
  USING (agente_id = auth.uid() OR public.get_my_rol() = 'admin');

-- ── Policies: configuracion_recordatorio ──
CREATE POLICY "config_rec: admin full access"
  ON public.configuracion_recordatorio FOR ALL
  USING (public.get_my_rol() = 'admin');

CREATE POLICY "config_rec: agente ve sus configuraciones"
  ON public.configuracion_recordatorio FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.deudas d
      WHERE d.id = deuda_id AND d.agente_id = auth.uid()
    ) OR public.get_my_rol() = 'admin'
  );

-- ── Policies: referencias_cliente ──
CREATE POLICY "referencias: admin full access"
  ON public.referencias_cliente FOR ALL
  USING (public.get_my_rol() = 'admin');

CREATE POLICY "referencias: agente ve y gestiona sus clientes"
  ON public.referencias_cliente FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.clientes c
      WHERE c.id = cliente_id AND (c.agente_id = auth.uid() OR public.get_my_rol() = 'admin')
    )
  );

-- ── Policies: plantillas_mensaje ──
CREATE POLICY "plantillas: admin full access"
  ON public.plantillas_mensaje FOR ALL
  USING (public.get_my_rol() = 'admin');

CREATE POLICY "plantillas: agente solo lee"
  ON public.plantillas_mensaje FOR SELECT
  USING (public.get_my_rol() IN ('admin','agente'));

-- ── Policies: webhooks ──
CREATE POLICY "webhooks: admin full access"
  ON public.webhooks FOR ALL
  USING (public.get_my_rol() = 'admin');

-- ── Policies: envios_log ──
CREATE POLICY "envios_log: admin full access"
  ON public.envios_log FOR ALL
  USING (public.get_my_rol() = 'admin');

CREATE POLICY "envios_log: agente ve sus envíos"
  ON public.envios_log FOR SELECT
  USING (agente_id = auth.uid() OR public.get_my_rol() = 'admin');

CREATE POLICY "envios_log: agente puede insertar"
  ON public.envios_log FOR INSERT
  WITH CHECK (public.get_my_rol() IN ('admin','agente'));

-- ─── DATOS INICIALES: Plantillas por defecto ──────────────────
INSERT INTO public.plantillas_mensaje (nombre, etapa, contenido) VALUES
(
  'Recordatorio Preventivo',
  'preventivo',
  'Hola {{nombre}}, te recordamos que tu pago de *{{monto}}* tiene fecha de vencimiento el *{{fecha_corte}}*. Por favor asegúrate de realizar tu pago a tiempo. Ante cualquier consulta estamos disponibles. — Inversiones Cordero'
),
(
  'Mora Temprana',
  'mora_temprana',
  'Estimado/a {{nombre}}, tu cuenta presenta un atraso de *{{dias_atraso}} días* con un saldo pendiente de *{{saldo}}*. Te pedimos regularizar tu situación a la brevedad posible. Comunícate con nosotros para coordinar. — Inversiones Cordero'
),
(
  'Mora Alta',
  'mora_alta',
  'Estimado/a {{nombre}}, tu cuenta registra *{{dias_atraso}} días* de atraso con saldo de *{{saldo}}*. Es importante que te comuniques hoy con tu gestor {{agente}} para evitar mayores inconvenientes. — Inversiones Cordero'
),
(
  'Recuperación',
  'recuperacion',
  'Sr./Sra. {{nombre}}, su cuenta se encuentra en proceso de recuperación con un saldo de *{{saldo}}* y *{{dias_atraso}} días* de atraso. Es urgente comunicarse hoy mismo con Inversiones Cordero para llegar a un acuerdo. — Área de Cobranza'
),
(
  'Mensaje a Referencia',
  'referencia',
  'Estimado/a, nos comunicamos de parte de Inversiones Cordero intentando ubicar a *{{nombre}} {{apellido}}*. Si tiene contacto con esta persona le pedimos le transmita la urgencia de comunicarse con nosotros. Gracias.'
)
ON CONFLICT DO NOTHING;

-- ─── FIN DEL SCHEMA ───────────────────────────────────────────
