-- ══════════════════════════════════════════════════════════════
-- Migración: registrar_pago_atomico -- reponer el chequeo de registrar_pagos
--
-- CONTEXTO (I6): antes de que existiera este RPC, marcarPagoPeriodo()
-- insertaba en `pagos` con el cliente de sesión, y la policy
-- "pagos: agente puede insertar" (fix_rls_permisos_agentes.sql) exigía
-- tiene_permiso('registrar_pagos'). Al mover ese INSERT dentro de
-- registrar_pago_atomico (SECURITY DEFINER, no pasa por RLS), esa policy
-- quedó como código muerto: el RPC no comprueba el permiso y ninguna
-- Server Action lo comprueba en TypeScript tampoco. Resultado: quitarle
-- registrar_pagos a un agente ya no le impide registrar pagos -- una
-- regresión de control de acceso en el camino del dinero.
--
-- CORRECCIÓN (única cosa que cambia en esta migración, ver comentario al
-- final): si auth.uid() no es NULL (llamada real de agente/admin vía
-- cliente de sesión, no un proceso interno con service_role), se exige
-- tiene_permiso('registrar_pagos') y se fuerza p_registrado_por := auth.uid()
-- -- el registrado_por deja de ser elegible por el llamante, igual que se
-- hizo con emitido_por en emitir_ticket (I5). Si auth.uid() es NULL, el
-- comportamiento es exactamente el mismo de antes.
--
-- Todo lo demás -- numérica de saldo, avance de fecha_corte, cálculo de
-- etapa, el INSERT de `pagos` dentro de la misma transacción -- es una
-- copia literal de 20260729_03_pagos_atomico.sql. Compárese línea por
-- línea antes de aplicar: es el RPC que mueve el dinero.
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.registrar_pago_atomico(
    p_deuda_id          UUID,
    p_monto_pago        NUMERIC,
    p_periodo           TEXT DEFAULT NULL,
    p_nota              TEXT DEFAULT NULL,
    p_registrado_por    UUID DEFAULT NULL,
    -- Va al final para no romper llamadas posicionales existentes.
    -- TRUE = "marcar período pagado" sin exigir monto > 0 en deudas
    -- con monto_original > 0 (uso: marcarPagoPeriodo cuando la deuda
    -- no tiene cuota_mensual fija, p.ej. botón "Pagó" del panel de
    -- pendientes). FALSE (default) = "registrar un pago por monto":
    -- exige monto > 0 en deudas con monto_original > 0, sin excepción.
    p_avanzar_sin_monto BOOLEAN DEFAULT FALSE
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

    -- I6: si hay un usuario real detrás de la llamada (no un proceso
    -- interno con service_role), se exige el permiso granular y se fuerza
    -- quién queda como registrado_por -- no lo elige el llamante.
    IF auth.uid() IS NOT NULL THEN
        IF NOT public.tiene_permiso('registrar_pagos') THEN
            RETURN jsonb_build_object('ok', false, 'error',
                'No tienes permiso para registrar pagos');
        END IF;
        p_registrado_por := auth.uid();
    END IF;

    SELECT * INTO v_deuda
    FROM public.deudas
    WHERE id = p_deuda_id AND estado = 'activo'
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Deuda no encontrada o no está activa');
    END IF;

    -- p_avanzar_sin_monto = TRUE deja pasar monto 0 (o negativo-cero) en
    -- deudas con monto_original > 0: es "marcar período pagado", no un
    -- pago real. Sin la bandera (DEFAULT FALSE), el rechazo es el de
    -- siempre — un pago por monto real nunca puede ser <= 0.
    IF v_deuda.monto_original > 0 AND p_monto_pago <= 0 AND NOT p_avanzar_sin_monto THEN
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

    -- "Marcar período pagado" siempre avanza fecha_corte, tenga o no
    -- tenga cuota_mensual la deuda. Si ya era TRUE por alguna de las
    -- ramas de arriba, esto no cambia nada.
    IF p_avanzar_sin_monto THEN
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

-- El REVOKE/GRANT de 20260729_03_pagos_atomico.sql (reafirmado en
-- 20260730_00_revocar_execute_publico.sql) sigue vigente: CREATE OR REPLACE
-- no toca privilegios. No hace falta repetirlo aquí.
