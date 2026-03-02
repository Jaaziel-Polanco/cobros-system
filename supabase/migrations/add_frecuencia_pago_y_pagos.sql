-- ══════════════════════════════════════════════════════════════
-- Migración: Frecuencia de Pago (mensual/quincenal/semanal),
--            montos opcionales, tabla de pagos, y notificaciones
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- ══════════════════════════════════════════════════════════════

-- ─── 1. Agregar frecuencia_pago y hacer montos opcionales ───
ALTER TABLE public.deudas
ADD COLUMN IF NOT EXISTS frecuencia_pago TEXT NOT NULL DEFAULT 'mensual'
  CHECK (frecuencia_pago IN ('mensual','quincenal','semanal'));

ALTER TABLE public.deudas
ADD COLUMN IF NOT EXISTS dia_corte_2 INTEGER DEFAULT NULL
  CHECK (dia_corte_2 IS NULL OR (dia_corte_2 >= 1 AND dia_corte_2 <= 31));

COMMENT ON COLUMN public.deudas.frecuencia_pago IS
'Frecuencia de pago: mensual (1 fecha_corte), quincenal (fecha_corte + dia_corte_2), semanal (cada 7 días desde fecha_corte)';

COMMENT ON COLUMN public.deudas.dia_corte_2 IS
'Segundo día de corte para pagos quincenales (ej: si fecha_corte es día 15, dia_corte_2 = 30)';

-- Permitir monto_original = 0 (ya permite >= 0)
-- Permitir saldo_pendiente = 0 (ya permite >= 0)
-- Hacer tasa_interes nullable para cuando no hay monto
ALTER TABLE public.deudas
ALTER COLUMN monto_original SET DEFAULT 0;

ALTER TABLE public.deudas
ALTER COLUMN saldo_pendiente SET DEFAULT 0;

-- ─── 2. Tabla de pagos (historial real de pagos) ────────────
CREATE TABLE IF NOT EXISTS public.pagos (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deuda_id    UUID NOT NULL REFERENCES public.deudas(id) ON DELETE CASCADE,
  cliente_id  UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  monto       NUMERIC(14,2) NOT NULL CHECK (monto >= 0),
  periodo     TEXT NOT NULL,
  registrado_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  nota        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN public.pagos.periodo IS
'Período que cubre este pago, ej: "2026-03-01/2026-03-15" o "semana 2026-03-01"';

COMMENT ON COLUMN public.pagos.monto IS
'Monto del pago. 0 = marcado como pagado sin monto (deudas sin montos configurados)';

CREATE INDEX IF NOT EXISTS idx_pagos_deuda ON public.pagos(deuda_id);
CREATE INDEX IF NOT EXISTS idx_pagos_cliente ON public.pagos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_pagos_created ON public.pagos(created_at);

ALTER TABLE public.pagos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pagos: admin full access"
  ON public.pagos FOR ALL
  USING (public.get_my_rol() = 'admin');

CREATE POLICY "pagos: agente ve pagos de sus deudas"
  ON public.pagos FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.deudas d
      WHERE d.id = deuda_id AND (d.agente_id = auth.uid() OR public.get_my_rol() = 'admin')
    )
  );

CREATE POLICY "pagos: agente puede insertar"
  ON public.pagos FOR INSERT
  WITH CHECK (public.get_my_rol() IN ('admin','agente'));


-- ─── 3. Actualizar registrar_pago_atomico para frecuencia ───
CREATE OR REPLACE FUNCTION public.registrar_pago_atomico(
    p_deuda_id UUID,
    p_monto_pago NUMERIC
)
RETURNS JSONB AS $$
DECLARE
    v_deuda RECORD;
    v_nuevo_saldo NUMERIC;
    v_nueva_fecha_corte DATE;
    v_nuevo_estado TEXT;
    v_nueva_etapa TEXT;
    v_dias_atraso INTEGER;
    v_avance_corte BOOLEAN := FALSE;
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

    -- Para deudas sin monto, p_monto_pago = 0 es válido (marcar como pagado)
    IF v_deuda.monto_original > 0 AND p_monto_pago <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'El monto del pago debe ser mayor a 0');
    END IF;

    IF p_monto_pago > v_deuda.saldo_pendiente AND v_deuda.saldo_pendiente > 0 THEN
        RETURN jsonb_build_object('ok', false, 'error',
            'El pago (' || p_monto_pago || ') excede el saldo pendiente (' || v_deuda.saldo_pendiente || ')');
    END IF;

    v_nuevo_saldo := GREATEST(0, v_deuda.saldo_pendiente - p_monto_pago);
    v_nueva_fecha_corte := v_deuda.fecha_corte;

    -- Avanzar fecha_corte según frecuencia
    IF v_deuda.cuota_mensual IS NOT NULL AND p_monto_pago >= v_deuda.cuota_mensual AND v_nuevo_saldo > 0 THEN
        v_avance_corte := TRUE;
    ELSIF v_deuda.monto_original = 0 THEN
        v_avance_corte := TRUE;
    END IF;

    IF v_avance_corte AND v_nuevo_saldo > 0 THEN
        CASE v_deuda.frecuencia_pago
            WHEN 'semanal' THEN
                v_nueva_fecha_corte := v_deuda.fecha_corte + INTERVAL '7 days';
            WHEN 'quincenal' THEN
                v_nueva_fecha_corte := v_deuda.fecha_corte + INTERVAL '15 days';
            WHEN 'mensual' THEN
                v_nueva_fecha_corte := v_deuda.fecha_corte + INTERVAL '1 month';
        END CASE;
    ELSIF v_avance_corte AND v_deuda.monto_original = 0 THEN
        CASE v_deuda.frecuencia_pago
            WHEN 'semanal' THEN
                v_nueva_fecha_corte := v_deuda.fecha_corte + INTERVAL '7 days';
            WHEN 'quincenal' THEN
                v_nueva_fecha_corte := v_deuda.fecha_corte + INTERVAL '15 days';
            WHEN 'mensual' THEN
                v_nueva_fecha_corte := v_deuda.fecha_corte + INTERVAL '1 month';
        END CASE;
    END IF;

    IF v_nuevo_saldo = 0 AND v_deuda.monto_original > 0 THEN
        v_nuevo_estado := 'saldado';
        v_nueva_etapa := 'saldado';
        v_dias_atraso := 0;
    ELSE
        v_nuevo_estado := 'activo';
        v_dias_atraso := GREATEST(0, CURRENT_DATE - v_nueva_fecha_corte);
        v_nueva_etapa := public.calcular_etapa_cobranza(v_dias_atraso);
    END IF;

    UPDATE public.deudas
    SET saldo_pendiente = v_nuevo_saldo,
        fecha_corte = v_nueva_fecha_corte,
        estado = v_nuevo_estado,
        etapa = v_nueva_etapa,
        dias_atraso = v_dias_atraso,
        updated_at = NOW()
    WHERE id = p_deuda_id;

    RETURN jsonb_build_object(
        'ok', true,
        'saldo_anterior', v_deuda.saldo_pendiente,
        'monto_pago', p_monto_pago,
        'nuevo_saldo', v_nuevo_saldo,
        'nuevo_estado', v_nuevo_estado,
        'fecha_corte_anterior', v_deuda.fecha_corte,
        'nueva_fecha_corte', v_nueva_fecha_corte,
        'avance_corte', v_avance_corte,
        'frecuencia', v_deuda.frecuencia_pago
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─── 4. Función para calcular próxima fecha quincenal ───────
CREATE OR REPLACE FUNCTION public.proxima_fecha_quincenal(
    p_fecha_actual DATE,
    p_dia1 INTEGER,
    p_dia2 INTEGER
)
RETURNS DATE AS $$
DECLARE
    v_mes DATE;
    v_d1 DATE;
    v_d2 DATE;
    v_dia1_real INTEGER;
    v_dia2_real INTEGER;
    v_dias_mes INTEGER;
BEGIN
    v_mes := date_trunc('month', p_fecha_actual)::DATE;
    v_dias_mes := (date_trunc('month', v_mes + INTERVAL '1 month') - v_mes)::INTEGER;
    v_dia1_real := LEAST(p_dia1, v_dias_mes);
    v_dia2_real := LEAST(p_dia2, v_dias_mes);
    v_d1 := v_mes + (v_dia1_real - 1);
    v_d2 := v_mes + (v_dia2_real - 1);

    IF p_fecha_actual < v_d1 THEN RETURN v_d1; END IF;
    IF p_fecha_actual < v_d2 THEN RETURN v_d2; END IF;

    -- Next month
    v_mes := v_mes + INTERVAL '1 month';
    v_dias_mes := (date_trunc('month', v_mes + INTERVAL '1 month') - v_mes)::INTEGER;
    v_dia1_real := LEAST(p_dia1, v_dias_mes);
    RETURN v_mes + (v_dia1_real - 1);
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- ─── 5. Índice para consultas de notificaciones pendientes ──
CREATE INDEX IF NOT EXISTS idx_deudas_frecuencia ON public.deudas(frecuencia_pago);
CREATE INDEX IF NOT EXISTS idx_deudas_agente ON public.deudas(agente_id);


-- ══════════════════════════════════════════════════════════════
-- FIN DE MIGRACIÓN
-- ══════════════════════════════════════════════════════════════
