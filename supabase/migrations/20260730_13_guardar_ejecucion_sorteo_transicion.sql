-- ══════════════════════════════════════════════════════════════
-- Migración: guardar_ejecucion_sorteo -- la transición borrador→activo
-- deja de ser muda
--
-- CONTEXTO (revisión de 20260729_07_ejecutar_sorteo.sql, que SÍ está
-- aplicada y no se toca aquí): cuando un sorteo en 'borrador' se ejecuta
-- mientras ya hay OTRO sorteo 'activo', el RPC guarda la ejecución y sus
-- ganadores con éxito ('ok': true) pero el UPDATE que intenta pasarlo a
-- 'activo' no encuentra fila que actualizar (por el índice único
-- uq_sorteo_activo) y no avisa de nada. El resultado: un sorteo con
-- ganadores persistidos y vigentes cuyo estado sigue diciendo 'borrador',
-- sin que quede ninguna pista de por qué. Es una trampa para quien
-- consuma este RPC desde la interfaz (Tarea 4 del mismo plan): leer
-- estado = 'borrador' ahí sugiere "todavía no se ha corrido", cuando en
-- realidad ya corrió y ya tiene ganadores.
--
-- CORRECCIÓN: la respuesta ahora incluye tres campos nuevos que describen
-- qué pasó con el estado del sorteo en ESTA llamada:
--   · estado_sorteo:            el estado del sorteo tal como queda al
--                                terminar la función ('borrador' o
--                                'activo'; 'cerrado' ya se rechaza antes).
--   · transicionado_a_activo:   TRUE solo si ESTA llamada fue la que lo
--                                pasó de 'borrador' a 'activo'.
--   · motivo_no_transicion:     NULL salvo en el caso que motivó esta
--                                migración: el sorteo seguía en 'borrador'
--                                porque ya había otro sorteo activo. En
--                                cualquier otro caso (ya estaba activo, o
--                                la transición sí ocurrió) es NULL.
--
-- Se usa GET DIAGNOSTICS ... ROW_COUNT sobre el UPDATE existente para
-- distinguir "no había fila en borrador que tocar porque ya era otro
-- estado" (no aplica; aquí ya se sabe por v_sorteo.estado) de "había fila
-- pero el índice único bloqueó la condición NOT EXISTS" -- que es
-- exactamente la rama silenciosa que se quiere dejar de ocultar.
--
-- Nada más cambia: numeración, columnas, orden de operaciones (archivar
-- antes de insertar la nueva ejecución vigente), la comprobación de
-- permiso 'realizar_sorteo' y el forzado de ejecutado_por := auth.uid()
-- son copia literal de 20260729_07_ejecutar_sorteo.sql. CREATE OR REPLACE
-- conserva la firma exacta (mismos tipos de parámetros en el mismo orden),
-- así que el REVOKE/GRANT de esa migración sigue vigente sin repetirlo.
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.guardar_ejecucion_sorteo(
    p_sorteo_id     UUID,
    p_rango_desde   DATE,
    p_rango_hasta   DATE,
    p_cantidad      INTEGER,
    p_semilla       TEXT,
    p_algoritmo     TEXT,
    p_pool_hash     TEXT,
    p_pool_count    INTEGER,
    p_participantes JSONB,   -- [{ ticket_id, orden }]
    p_ganadores     JSONB,   -- [{ ticket_id, cliente_id, posicion, premio, snapshot }]
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

    -- Archivar, no borrar: ver 20260729_07_ejecutar_sorteo.sql para la
    -- explicación completa de por qué el UPDATE va antes del INSERT
    -- (uq_ejecucion_vigente permite una sola fila vigente por sorteo).
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

    -- La transición ya no es muda: se registra si esta llamada la logró y,
    -- si no, por qué. v_sorteo.estado aquí es 'borrador' o 'activo' (el
    -- caso 'cerrado' ya se rechazó arriba), así que sirve tal cual como
    -- estado de partida para decidir el estado final si no hay transición.
    IF v_sorteo.estado = 'borrador' THEN
        UPDATE public.sorteos SET estado = 'activo' WHERE id = p_sorteo_id
          AND NOT EXISTS (
            SELECT 1 FROM public.sorteos WHERE estado = 'activo' AND id <> p_sorteo_id
          );
        GET DIAGNOSTICS v_filas_afectadas = ROW_COUNT;

        IF v_filas_afectadas > 0 THEN
            v_transicionado := TRUE;
        ELSE
            -- La única razón por la que el UPDATE de arriba puede no tocar
            -- ninguna fila, dado que v_sorteo.estado ya es 'borrador' y
            -- p_sorteo_id existe (comprobado arriba con FOR UPDATE): el
            -- NOT EXISTS falló porque ya hay otro sorteo activo. Es
            -- exactamente el caso que este arreglo deja de ocultar.
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
