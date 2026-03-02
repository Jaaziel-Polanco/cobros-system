-- ══════════════════════════════════════════════════════════════
-- Migración: Sistema de Cuotas Mensuales
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- ══════════════════════════════════════════════════════════════

-- ─── 1. Agregar campo cuota_mensual a deudas ────────────────
ALTER TABLE public.deudas
ADD COLUMN IF NOT EXISTS cuota_mensual NUMERIC(14,2) DEFAULT NULL
CHECK (cuota_mensual IS NULL OR cuota_mensual > 0);

COMMENT ON COLUMN public.deudas.cuota_mensual IS
'Monto fijo que el cliente debe pagar cada mes. NULL = pago único (sin cuotas).';


-- ─── 2. Reemplazar RPC de pago atómico con lógica de cuotas ─
-- Si la deuda tiene cuota_mensual y el pago cubre la cuota:
--   - Descuenta del saldo
--   - Avanza fecha_corte al próximo mes
--   - Recalcula dias_atraso y etapa
-- Si no tiene cuota_mensual, funciona como antes (pago libre).
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
    IF p_monto_pago <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'El monto del pago debe ser mayor a 0');
    END IF;

    SELECT * INTO v_deuda
    FROM public.deudas
    WHERE id = p_deuda_id AND estado = 'activo'
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Deuda no encontrada o no está activa');
    END IF;

    IF p_monto_pago > v_deuda.saldo_pendiente THEN
        RETURN jsonb_build_object('ok', false, 'error',
            'El pago (' || p_monto_pago || ') excede el saldo pendiente (' || v_deuda.saldo_pendiente || ')');
    END IF;

    v_nuevo_saldo := GREATEST(0, v_deuda.saldo_pendiente - p_monto_pago);
    v_nueva_fecha_corte := v_deuda.fecha_corte;

    -- Si tiene cuota mensual y el pago cubre al menos la cuota, avanzar fecha de corte
    IF v_deuda.cuota_mensual IS NOT NULL AND p_monto_pago >= v_deuda.cuota_mensual AND v_nuevo_saldo > 0 THEN
        v_nueva_fecha_corte := v_deuda.fecha_corte + INTERVAL '1 month';
        v_avance_corte := TRUE;
    END IF;

    IF v_nuevo_saldo = 0 THEN
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
        'avance_corte', v_avance_corte
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─── 3. Actualizar plantilla preventiva para usar {{cuota}} ──
-- Si la deuda tiene cuota_mensual, {{cuota}} muestra la cuota.
-- Si no, {{cuota}} muestra el saldo pendiente (comportamiento anterior).
UPDATE public.plantillas_mensaje
SET contenido = 'Hola {{nombre}}, te recordamos que tu pago de *{{cuota}}* tiene fecha de vencimiento el *{{fecha_corte}}*. Por favor asegúrate de realizar tu pago a tiempo. Ante cualquier consulta estamos disponibles. — Inversiones Cordero'
WHERE etapa = 'preventivo'
  AND contenido LIKE '%{{monto}}%tiene fecha de vencimiento%';

UPDATE public.plantillas_mensaje
SET contenido = 'Estimado/a {{nombre}}, tu cuenta presenta un atraso de *{{dias_atraso}} días* con un pago pendiente de *{{cuota}}* (saldo total: {{saldo}}). Te pedimos regularizar tu situación a la brevedad posible. Comunícate con nosotros para coordinar. — Inversiones Cordero'
WHERE etapa = 'mora_temprana'
  AND contenido LIKE '%atraso de%saldo pendiente%';

UPDATE public.plantillas_mensaje
SET contenido = 'Estimado/a {{nombre}}, tu cuenta registra *{{dias_atraso}} días* de atraso con un pago pendiente de *{{cuota}}* (saldo total: {{saldo}}). Es importante que te comuniques hoy con tu gestor {{agente}} para evitar mayores inconvenientes. — Inversiones Cordero'
WHERE etapa = 'mora_alta'
  AND contenido LIKE '%dias_atraso}}%saldo de%';

UPDATE public.plantillas_mensaje
SET contenido = 'Sr./Sra. {{nombre}}, su cuenta se encuentra en proceso de recuperación con un pago pendiente de *{{cuota}}* (saldo total: {{saldo}}) y *{{dias_atraso}} días* de atraso. Es urgente comunicarse hoy mismo con Inversiones Cordero para llegar a un acuerdo. — Área de Cobranza'
WHERE etapa = 'recuperacion'
  AND contenido LIKE '%proceso de recuperación%saldo de%';


-- ══════════════════════════════════════════════════════════════
-- FIN DE MIGRACIÓN
-- ══════════════════════════════════════════════════════════════
