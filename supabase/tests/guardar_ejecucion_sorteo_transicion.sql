-- ══════════════════════════════════════════════════════════════
-- Verificación manual de la migración
-- 20260730_13_guardar_ejecucion_sorteo_transicion.sql
--
-- Todo dentro de UNA transacción que termina en ROLLBACK, incluido el
-- CREATE OR REPLACE FUNCTION de la migración: al hacer ROLLBACK, Postgres
-- deshace también el cambio de función (DDL transaccional), así que este
-- guion prueba el comportamiento nuevo de verdad, contra la base real,
-- sin dejar la migración aplicada de forma permanente. La versión de
-- guardar_ejecucion_sorteo que queda vigente después de correr esto es
-- exactamente la misma que antes de correrlo (la de
-- 20260729_07_ejecutar_sorteo.sql, ya aplicada).
--
-- Datos de prueba con prefijo ZZTEST_ / TSTTR, se descartan con el
-- ROLLBACK.
-- ══════════════════════════════════════════════════════════════
BEGIN;

-- ─── Aplicar temporalmente el cambio de la migración 20260730_13 ──────
CREATE OR REPLACE FUNCTION public.guardar_ejecucion_sorteo(
    p_sorteo_id     UUID,
    p_rango_desde   DATE,
    p_rango_hasta   DATE,
    p_cantidad      INTEGER,
    p_semilla       TEXT,
    p_algoritmo     TEXT,
    p_pool_hash     TEXT,
    p_pool_count    INTEGER,
    p_participantes JSONB,
    p_ganadores     JSONB,
    p_ejecutado_por UUID
)
RETURNS JSONB AS $$
DECLARE
    v_sorteo                public.sorteos%ROWTYPE;
    v_ejecucion             UUID;
    v_ejecutado_por         UUID := p_ejecutado_por;
    v_transicionado         BOOLEAN := FALSE;
    v_motivo_no_transicion  TEXT := NULL;
    v_filas_afectadas       INTEGER;
    v_estado_final          TEXT;
BEGIN
    IF auth.uid() IS NOT NULL THEN
        IF NOT public.tiene_permiso('realizar_sorteo') THEN
            RETURN jsonb_build_object('ok', false, 'error',
                'No tienes permiso para ejecutar sorteos');
        END IF;
        v_ejecutado_por := auth.uid();
    END IF;

    SELECT * INTO v_sorteo FROM public.sorteos WHERE id = p_sorteo_id FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Sorteo no encontrado');
    END IF;

    IF v_sorteo.estado = 'cerrado' THEN
        RETURN jsonb_build_object('ok', false, 'error',
            'El sorteo está cerrado y no admite nuevas ejecuciones');
    END IF;

    IF p_cantidad <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'error',
            'La cantidad de ganadores debe ser mayor que cero');
    END IF;

    UPDATE public.sorteo_ejecuciones
       SET vigente = FALSE
     WHERE sorteo_id = p_sorteo_id AND vigente;

    INSERT INTO public.sorteo_ejecuciones (
        sorteo_id, rango_desde, rango_hasta, cantidad_ganadores,
        semilla, algoritmo, pool_count, pool_hash, vigente, ejecutado_por
    ) VALUES (
        p_sorteo_id, p_rango_desde, p_rango_hasta, p_cantidad,
        p_semilla, p_algoritmo, p_pool_count, p_pool_hash, TRUE, v_ejecutado_por
    ) RETURNING id INTO v_ejecucion;

    INSERT INTO public.sorteo_participantes (ejecucion_id, ticket_id, orden)
    SELECT v_ejecucion,
           (elem ->> 'ticket_id')::UUID,
           (elem ->> 'orden')::INTEGER
      FROM jsonb_array_elements(p_participantes) AS elem;

    INSERT INTO public.sorteo_ganadores
        (ejecucion_id, ticket_id, cliente_id, posicion, premio, snapshot)
    SELECT v_ejecucion,
           (elem ->> 'ticket_id')::UUID,
           (elem ->> 'cliente_id')::UUID,
           (elem ->> 'posicion')::INTEGER,
           elem ->> 'premio',
           COALESCE(elem -> 'snapshot', '{}'::jsonb)
      FROM jsonb_array_elements(p_ganadores) AS elem;

    IF v_sorteo.estado = 'borrador' THEN
        UPDATE public.sorteos SET estado = 'activo' WHERE id = p_sorteo_id
          AND NOT EXISTS (
            SELECT 1 FROM public.sorteos WHERE estado = 'activo' AND id <> p_sorteo_id
          );
        GET DIAGNOSTICS v_filas_afectadas = ROW_COUNT;

        IF v_filas_afectadas > 0 THEN
            v_transicionado := TRUE;
        ELSE
            v_motivo_no_transicion :=
                'El sorteo permanece en borrador: ya existe otro sorteo activo. '
                || 'Los ganadores de esta ejecución se guardaron correctamente.';
        END IF;
    END IF;

    v_estado_final := CASE WHEN v_transicionado THEN 'activo' ELSE v_sorteo.estado END;

    RETURN jsonb_build_object(
        'ok',                     true,
        'ejecucion_id',           v_ejecucion,
        'estado_sorteo',          v_estado_final,
        'transicionado_a_activo', v_transicionado,
        'motivo_no_transicion',   v_motivo_no_transicion
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── Casos de prueba ────────────────────────────────────────────────
DO $$
DECLARE
  v_cliente1  UUID;
  v_cliente2  UUID;
  v_cliente3  UUID;
  v_sorteo_a  UUID; -- Caso A: borrador, sin otro activo -> debe transicionar
  v_sorteo_b1 UUID; -- Caso B: otro sorteo YA activo (el obstáculo)
  v_sorteo_b2 UUID; -- Caso B: borrador, con v_sorteo_b1 ya activo -> no debe transicionar
  v_sorteo_c  UUID; -- Caso C: ya activo desde el inicio -> no aplica transición
  v_t1 UUID; v_t2 UUID; v_t3 UUID; v_t4 UUID;
  v_res JSONB;
BEGIN
  INSERT INTO public.clientes (nombre, apellido, telefono)
  VALUES ('ZZTEST_Transicion1', 'Prueba', '8090000101') RETURNING id INTO v_cliente1;
  INSERT INTO public.clientes (nombre, apellido, telefono)
  VALUES ('ZZTEST_Transicion2', 'Prueba', '8090000102') RETURNING id INTO v_cliente2;
  INSERT INTO public.clientes (nombre, apellido, telefono)
  VALUES ('ZZTEST_Transicion3', 'Prueba', '8090000103') RETURNING id INTO v_cliente3;

  -- ── Caso A: borrador sin ningún sorteo activo → debe transicionar ──
  INSERT INTO public.sorteos (nombre, fecha_inicio, fecha_fin, estado, prefijo)
  VALUES ('ZZTEST_ Sorteo A', CURRENT_DATE - 5, CURRENT_DATE + 5, 'borrador', 'TSTTRA')
  RETURNING id INTO v_sorteo_a;

  INSERT INTO public.tickets
    (numero, numero_formateado, sorteo_id, cliente_id, origen, motivo, token_publico, snapshot)
  VALUES (1, 'TSTTRA-000001', v_sorteo_a, v_cliente1, 'manual', 'ZZTEST_', 'tok-tra-1', '{}'::jsonb)
  RETURNING id INTO v_t1;

  v_res := public.guardar_ejecucion_sorteo(
    v_sorteo_a, CURRENT_DATE - 5, CURRENT_DATE + 5, 1,
    'semilla-a', 'mulberry32-fisher-yates-v1', 'hash-a', 1,
    jsonb_build_array(jsonb_build_object('ticket_id', v_t1, 'orden', 0)),
    jsonb_build_array(jsonb_build_object('ticket_id', v_t1, 'cliente_id', v_cliente1,
                       'posicion', 1, 'premio', 'Premio A', 'snapshot', '{}'::jsonb)),
    NULL
  );

  ASSERT (v_res ->> 'ok')::BOOLEAN, 'Caso A: debió guardar la ejecución';
  ASSERT (v_res ->> 'estado_sorteo') = 'activo',
         'Caso A: estado_sorteo debe reportar activo';
  ASSERT (v_res ->> 'transicionado_a_activo')::BOOLEAN,
         'Caso A: transicionado_a_activo debe ser true';
  ASSERT (v_res ->> 'motivo_no_transicion') IS NULL,
         'Caso A: no debe haber motivo_no_transicion cuando sí transicionó';
  ASSERT (SELECT estado FROM public.sorteos WHERE id = v_sorteo_a) = 'activo',
         'Caso A: el sorteo debe haber quedado activo de verdad en la tabla';

  -- ── Caso B: borrador, pero YA hay otro sorteo activo (v_sorteo_a) ──
  -- Debe guardar la ejecución y los ganadores igual, pero quedarse en
  -- borrador y decir por qué.
  INSERT INTO public.sorteos (nombre, fecha_inicio, fecha_fin, estado, prefijo)
  VALUES ('ZZTEST_ Sorteo B2', CURRENT_DATE - 5, CURRENT_DATE + 5, 'borrador', 'TSTTRB')
  RETURNING id INTO v_sorteo_b2;

  INSERT INTO public.tickets
    (numero, numero_formateado, sorteo_id, cliente_id, origen, motivo, token_publico, snapshot)
  VALUES (1, 'TSTTRB-000001', v_sorteo_b2, v_cliente2, 'manual', 'ZZTEST_', 'tok-trb-1', '{}'::jsonb)
  RETURNING id INTO v_t2;

  v_res := public.guardar_ejecucion_sorteo(
    v_sorteo_b2, CURRENT_DATE - 5, CURRENT_DATE + 5, 1,
    'semilla-b', 'mulberry32-fisher-yates-v1', 'hash-b', 1,
    jsonb_build_array(jsonb_build_object('ticket_id', v_t2, 'orden', 0)),
    jsonb_build_array(jsonb_build_object('ticket_id', v_t2, 'cliente_id', v_cliente2,
                       'posicion', 1, 'premio', 'Premio B', 'snapshot', '{}'::jsonb)),
    NULL
  );

  ASSERT (v_res ->> 'ok')::BOOLEAN,
         'Caso B: debió guardar la ejecución aunque no transicione';
  ASSERT (v_res ->> 'ejecucion_id') IS NOT NULL,
         'Caso B: debió devolver ejecucion_id (los ganadores sí se guardan)';
  ASSERT (v_res ->> 'estado_sorteo') = 'borrador',
         'Caso B: estado_sorteo debe reportar borrador (no transicionó)';
  ASSERT NOT (v_res ->> 'transicionado_a_activo')::BOOLEAN,
         'Caso B: transicionado_a_activo debe ser false';
  ASSERT (v_res ->> 'motivo_no_transicion') IS NOT NULL,
         'Caso B: motivo_no_transicion debe explicar por qué se quedó en borrador';
  ASSERT (SELECT estado FROM public.sorteos WHERE id = v_sorteo_b2) = 'borrador',
         'Caso B: el sorteo debe seguir en borrador de verdad en la tabla';
  ASSERT (SELECT count(*) FROM public.sorteo_ganadores
           WHERE ejecucion_id = (v_res ->> 'ejecucion_id')::UUID) = 1,
         'Caso B: el ganador debe haberse guardado pese a que el sorteo sigue en borrador';

  -- ── Caso C: sorteo ya activo desde el inicio (no es una transición) ──
  UPDATE public.sorteos SET estado = 'cerrado' WHERE id = v_sorteo_a; -- libera el cupo de 'activo'
  INSERT INTO public.sorteos (nombre, fecha_inicio, fecha_fin, estado, prefijo)
  VALUES ('ZZTEST_ Sorteo C', CURRENT_DATE - 5, CURRENT_DATE + 5, 'activo', 'TSTTRC')
  RETURNING id INTO v_sorteo_c;

  INSERT INTO public.tickets
    (numero, numero_formateado, sorteo_id, cliente_id, origen, motivo, token_publico, snapshot)
  VALUES (1, 'TSTTRC-000001', v_sorteo_c, v_cliente3, 'manual', 'ZZTEST_', 'tok-trc-1', '{}'::jsonb)
  RETURNING id INTO v_t3;

  v_res := public.guardar_ejecucion_sorteo(
    v_sorteo_c, CURRENT_DATE - 5, CURRENT_DATE + 5, 1,
    'semilla-c', 'mulberry32-fisher-yates-v1', 'hash-c', 1,
    jsonb_build_array(jsonb_build_object('ticket_id', v_t3, 'orden', 0)),
    jsonb_build_array(jsonb_build_object('ticket_id', v_t3, 'cliente_id', v_cliente3,
                       'posicion', 1, 'premio', 'Premio C', 'snapshot', '{}'::jsonb)),
    NULL
  );

  ASSERT (v_res ->> 'ok')::BOOLEAN, 'Caso C: debió guardar la ejecución';
  ASSERT (v_res ->> 'estado_sorteo') = 'activo',
         'Caso C: estado_sorteo debe reportar activo (ya lo era)';
  ASSERT NOT (v_res ->> 'transicionado_a_activo')::BOOLEAN,
         'Caso C: transicionado_a_activo debe ser false (no hubo transición, ya estaba activo)';
  ASSERT (v_res ->> 'motivo_no_transicion') IS NULL,
         'Caso C: no aplica motivo_no_transicion cuando el sorteo ya estaba activo';

  RAISE NOTICE 'TODAS LAS VERIFICACIONES PASARON';
END $$;

ROLLBACK;
