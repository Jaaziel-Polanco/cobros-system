-- ══════════════════════════════════════════════════════════════
-- Migración: Correcciones de Seguridad, Atomicidad y Rendimiento
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- ══════════════════════════════════════════════════════════════

-- ─── 1. RPC atómico para registrar pagos (evita race condition) ─────
-- Usa UPDATE atómico en vez de SELECT + UPDATE separados.
-- Retorna JSON con el resultado para el frontend.
CREATE OR REPLACE FUNCTION public.registrar_pago_atomico(
    p_deuda_id UUID,
    p_monto_pago NUMERIC
)
RETURNS JSONB AS $$
DECLARE
    v_saldo_anterior NUMERIC;
    v_nuevo_saldo NUMERIC;
    v_nuevo_estado TEXT;
    v_nueva_etapa TEXT;
BEGIN
    -- Validar monto
    IF p_monto_pago <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'El monto del pago debe ser mayor a 0');
    END IF;

    -- Obtener saldo actual con lock de fila (FOR UPDATE)
    SELECT saldo_pendiente INTO v_saldo_anterior
    FROM public.deudas
    WHERE id = p_deuda_id AND estado = 'activo'
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Deuda no encontrada o no está activa');
    END IF;

    IF p_monto_pago > v_saldo_anterior THEN
        RETURN jsonb_build_object('ok', false, 'error',
            'El pago (' || p_monto_pago || ') excede el saldo pendiente (' || v_saldo_anterior || ')');
    END IF;

    v_nuevo_saldo := GREATEST(0, v_saldo_anterior - p_monto_pago);

    IF v_nuevo_saldo = 0 THEN
        v_nuevo_estado := 'saldado';
        v_nueva_etapa := 'saldado';
    ELSE
        v_nuevo_estado := 'activo';
        v_nueva_etapa := public.calcular_etapa_cobranza(
            GREATEST(0, CURRENT_DATE - (SELECT fecha_corte FROM public.deudas WHERE id = p_deuda_id))
        );
    END IF;

    -- Update atómico
    UPDATE public.deudas
    SET saldo_pendiente = v_nuevo_saldo,
        estado = v_nuevo_estado,
        etapa = v_nueva_etapa,
        updated_at = NOW()
    WHERE id = p_deuda_id;

    RETURN jsonb_build_object(
        'ok', true,
        'saldo_anterior', v_saldo_anterior,
        'monto_pago', p_monto_pago,
        'nuevo_saldo', v_nuevo_saldo,
        'nuevo_estado', v_nuevo_estado
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─── 2. CHECK constraint: saldo_pendiente <= monto_original ─────────
-- Evita datos inconsistentes a nivel de DB.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_saldo_no_excede_monto'
    ) THEN
        ALTER TABLE public.deudas
        ADD CONSTRAINT chk_saldo_no_excede_monto
        CHECK (saldo_pendiente <= monto_original);
    END IF;
END $$;


-- ─── 3. Restringir que agentes no puedan cambiar su propio rol ──────
-- Reemplaza la policy permisiva de UPDATE para agentes en profiles.
DROP POLICY IF EXISTS "profiles: agente actualiza su propio perfil" ON public.profiles;

CREATE POLICY "profiles: agente actualiza nombre propio"
    ON public.profiles FOR UPDATE
    USING (id = auth.uid())
    WITH CHECK (
        id = auth.uid()
        AND rol = (SELECT p.rol FROM public.profiles p WHERE p.id = auth.uid())
        AND activo = (SELECT p.activo FROM public.profiles p WHERE p.id = auth.uid())
    );


-- ─── 4. Índice para acelerar anti-duplicado de envíos ───────────────
CREATE INDEX IF NOT EXISTS idx_envios_log_deuda_tipo_sent
    ON public.envios_log(deuda_id, tipo_destino, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_envios_log_referencia
    ON public.envios_log(referencia_id, sent_at DESC)
    WHERE referencia_id IS NOT NULL;


-- ─── 5. Función para limpiar logs antiguos (retención) ──────────────
-- Ejecutar periódicamente para mantener la tabla envios_log manejable.
-- Mantiene los últimos 90 días por defecto.
CREATE OR REPLACE FUNCTION public.limpiar_envios_antiguos(
    p_dias_retencion INTEGER DEFAULT 90
)
RETURNS INTEGER AS $$
DECLARE
    v_eliminados INTEGER;
BEGIN
    DELETE FROM public.envios_log
    WHERE sent_at < NOW() - (p_dias_retencion || ' days')::INTERVAL;

    GET DIAGNOSTICS v_eliminados = ROW_COUNT;
    RETURN v_eliminados;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─── 6. Limpiar lógica muerta del RPC actualizar_dias_atraso ────────
-- El CASE para 'saldado'/'cancelado' nunca se alcanzaba por el WHERE.
CREATE OR REPLACE FUNCTION public.actualizar_dias_atraso()
RETURNS void AS $$
BEGIN
    UPDATE public.deudas
    SET
        dias_atraso = GREATEST(0, CURRENT_DATE - fecha_corte),
        etapa = public.calcular_etapa_cobranza(GREATEST(0, CURRENT_DATE - fecha_corte)),
        updated_at = NOW()
    WHERE estado = 'activo' AND pausado = FALSE;
END;
$$ LANGUAGE plpgsql;


-- ══════════════════════════════════════════════════════════════
-- FIN DE MIGRACIÓN
-- ══════════════════════════════════════════════════════════════
