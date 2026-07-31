-- ════════════════════════════════════════════════════════════════
-- Tabla: tiendas_referidas
-- Registra tiendas referidoras con acceso a la IA de referidos.
-- Totalmente independiente del sistema de cobranza.
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.tiendas_referidas (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre      TEXT NOT NULL,
    telefono    TEXT NOT NULL,
    notas       TEXT,
    activo      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tiendas_referidas_nombre ON public.tiendas_referidas (nombre);
CREATE INDEX IF NOT EXISTS idx_tiendas_referidas_activo ON public.tiendas_referidas (activo);

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION public.update_tiendas_referidas_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tiendas_referidas_updated_at ON public.tiendas_referidas;
CREATE TRIGGER trg_tiendas_referidas_updated_at
    BEFORE UPDATE ON public.tiendas_referidas
    FOR EACH ROW EXECUTE FUNCTION public.update_tiendas_referidas_updated_at();

-- RLS: admins o agentes con permiso ver_tiendas_referidas
ALTER TABLE public.tiendas_referidas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tiendas_referidas_acceso"
    ON public.tiendas_referidas
    FOR ALL
    USING (
        public.get_my_rol() = 'admin'
        OR COALESCE(
            (SELECT (permisos->>'ver_tiendas_referidas')::boolean
             FROM public.profiles WHERE id = auth.uid()),
            FALSE
        )
    );
