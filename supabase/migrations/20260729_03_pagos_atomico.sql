-- ══════════════════════════════════════════════════════════════
-- Migración: registrar_pago_atomico v2
--
-- CONTEXTO — consolidación de tres definiciones previas:
--   public.registrar_pago_atomico(UUID, NUMERIC) existía TRIPLICADO en
--   el repositorio, las tres con la misma firma. Como las tres usan
--   CREATE OR REPLACE FUNCTION sobre la misma firma, cada una pisaba a
--   la anterior en la base de datos real: solo una llegó a estar viva
--   en un momento dado, y no es reconstruible desde el historial de
--   git cuál — las tres se introdujeron en el mismo "first commit" del
--   repo (historia aplanada) y `supabase/schema.sql` (el dump base) es
--   anterior a las tres, así que tampoco sirve de referencia. Esta
--   migración las reemplaza a las TRES por una sola versión, con un
--   DROP FUNCTION IF EXISTS sobre la firma vieja para no dejar
--   ambigüedad de sobrecarga en las llamadas:
--
--   1. supabase/migrations/add_cuota_mensual.sql:21
--      Primera versión. Rechaza siempre monto <= 0. Avanza fecha_corte
--      solo si hay cuota_mensual y el pago la cubre; no conoce
--      frecuencia_pago (esa columna no existía todavía) y al avanzar
--      siempre suma 1 mes.
--
--   2. supabase/migrations/add_frecuencia_pago_y_pagos.sql:74
--      Versión "rica". Avanza fecha_corte según frecuencia_pago
--      (semanal/quincenal/mensual) y admite monto 0 cuando
--      monto_original = 0 (deudas sin montos, para poder "marcar como
--      pagado" sin un monto real). ESTA MIGRACIÓN ADOPTA EL
--      COMPORTAMIENTO DE ESTA VERSIÓN como base — es una decisión
--      tomada y aprobada en el plan, no un redescubrimiento accidental
--      de código viejo.
--
--   3. supabase/migrations/fix_seguridad_y_rendimiento.sql:9
--      Versión "simple". NO avanza fecha_corte en absoluto y rechaza
--      siempre monto <= 0 (una regresión frente a la versión rica para
--      deudas sin montos). Esta es también la migración que agrega el
--      CHECK chk_saldo_no_excede_monto sobre public.deudas — ver
--      análisis de compatibilidad más abajo. Ese constraint no se
--      toca en esta migración y sigue vigente.
--
--   Cuál de las tres estaba realmente activa en producción justo antes
--   de este cambio es irrelevante para la migración en sí: el DROP
--   FUNCTION cubre a las tres por firma, así que el resultado final es
--   el mismo sin importar cuál sobrevivió al último CREATE OR REPLACE
--   histórico.
--
-- COMPATIBILIDAD CON chk_saldo_no_excede_monto
--   (CHECK (saldo_pendiente <= monto_original), agregado en
--   fix_seguridad_y_rendimiento.sql): esta función nunca modifica
--   monto_original y solo puede DISMINUIR saldo_pendiente —
--   GREATEST(0, saldo_pendiente - monto_pago) es siempre menor o igual
--   que saldo_pendiente, nunca mayor. Si la fila ya cumplía
--   saldo_pendiente <= monto_original antes de la llamada (invariante
--   que además ya exigen createDeuda/updateDeuda en lib/actions/deudas.ts
--   antes de escribir), el saldo_pendiente resultante también lo
--   cumple. El constraint no puede violarse por esta función, exista o
--   no exista ya el constraint en la base real al momento de aplicar
--   esta migración.
--
-- QUÉ CAMBIA EN ESTA VERSIÓN (v2), sobre la base de la versión rica:
--   · Inserta la fila de `pagos` DENTRO de la transacción (corrige el
--     defecto L3 del spec: ya no puede quedar un pago huérfano si algo
--     falla a mitad de camino — todo el cuerpo de la función corre en
--     la misma transacción que envuelve la llamada RPC).
--   · Devuelve pago_id en el JSON de respuesta.
--   · Agrega los parámetros p_periodo, p_nota y p_registrado_por para
--     poder poblar la fila de `pagos` sin una segunda ida y vuelta
--     desde el cliente (corrige el defecto L2: registrarPago() ahora
--     también inserta en `pagos`).
--   · Agrega SET search_path = public (endurecimiento de seguridad
--     estándar para funciones SECURITY DEFINER; ninguna de las tres
--     versiones anteriores lo tenía).
--   · Elimina la duplicación de la lógica de avance de fecha_corte que
--     vivía en JavaScript dentro de marcarPagoPeriodo
--     (lib/actions/deudas.ts): esa lógica usaba setMonth()/setDate()
--     de JS; ahora vive una sola vez aquí, con INTERVAL de Postgres.
--     Cambio de comportamiento deliberado: setMonth() sobre el 31 de
--     enero da el 3 de marzo, mientras que Postgres (fecha + INTERVAL
--     '1 month') da el 28 de febrero. El comportamiento de Postgres es
--     el correcto y es el que queda vigente.
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
