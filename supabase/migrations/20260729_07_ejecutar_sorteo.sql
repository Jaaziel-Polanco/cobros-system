-- ══════════════════════════════════════════════════════════════
-- Migración: persistencia atómica de una ejecución de sorteo
--
-- El barajado se calcula en TypeScript (lib/utils/sorteo.ts), que es donde
-- vive la única implementación del algoritmo. Este RPC solo guarda el
-- resultado, de forma que una ejecución nunca quede a medias: o se registra
-- entera (ejecución + participantes + ganadores), o no se registra nada.
-- Basta con que cualquiera de los INSERT falle (violación de FK, de unicidad,
-- etc.) para que toda la función se revierta: Postgres ejecuta el cuerpo de
-- una función como una única transacción implícita.
--
-- PERMISO (mismo patrón que I5/I6 en emitir_ticket y registrar_pago_atomico,
-- ver 20260730_02_emitir_ticket_ownership.sql y
-- 20260730_03_registrar_pago_atomico_permiso.sql): esta función es
-- SECURITY DEFINER, así que ignora las policies RLS de
-- sorteo_ejecuciones/sorteo_participantes/sorteo_ganadores (que exigen
-- tiene_permiso('realizar_sorteo')). Sin una comprobación equivalente aquí
-- dentro, cualquier agente autenticado —con GRANT EXECUTE necesario para que
-- la pantalla de sorteos funcione— podría invocar el RPC directamente desde
-- la consola del navegador y ejecutar sorteos sin el permiso 'realizar_sorteo',
-- saltándose por completo la policy. Igual que en esos dos RPC: si
-- auth.uid() no es NULL (llamada real vía cliente de sesión, no un proceso
-- interno con service_role), se exige el permiso y se fuerza
-- ejecutado_por := auth.uid() -- deja de ser elegible por el llamante, para
-- que el rastro de auditoría no sea falsificable. Si auth.uid() es NULL
-- (scripts internos, este mismo guion de verificación), el comportamiento es
-- el mismo de siempre: se respeta el parámetro tal cual se recibe.
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
    v_sorteo        public.sorteos%ROWTYPE;
    v_ejecucion     UUID;
    v_ejecutado_por UUID := p_ejecutado_por;
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

    -- Archivar, no borrar: el índice único uq_ejecucion_vigente
    -- (sorteo_ejecuciones(sorteo_id) WHERE vigente) permite una sola fila
    -- vigente por sorteo. Por eso el ORDEN aquí importa: primero se
    -- desmarca la ejecución vigente anterior (si la hay) y solo DESPUÉS se
    -- inserta la nueva con vigente = TRUE. Si se hiciera al revés —insertar
    -- la nueva vigente antes de desmarcar la anterior— habría, durante un
    -- instante dentro de la misma transacción, dos filas vigentes para el
    -- mismo sorteo, y el índice único lo rechazaría con una violación de
    -- unicidad. La fila anterior nunca se borra: sorteo_participantes y
    -- sorteo_ganadores de ejecuciones pasadas se conservan íntegros para
    -- poder demostrar meses después que esa ejecución también fue limpia,
    -- aunque ya no sea la vigente.
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
    END IF;

    RETURN jsonb_build_object('ok', true, 'ejecucion_id', v_ejecucion);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── Endurecimiento: restringir quién puede ejecutar el RPC ───
-- Mismo patrón que 20260729_04_emitir_ticket.sql y
-- 20260730_00_revocar_execute_publico.sql: Postgres concede EXECUTE a
-- PUBLIC (que incluye `anon`) en toda función nueva por defecto. Esta
-- función es SECURITY DEFINER y escribe el resultado completo de un
-- sorteo, así que sin este REVOKE cualquiera con la clave anónima podría
-- invocarla directamente y falsificar una ejecución.
REVOKE ALL ON FUNCTION public.guardar_ejecucion_sorteo(
    UUID, DATE, DATE, INTEGER, TEXT, TEXT, TEXT, INTEGER, JSONB, JSONB, UUID
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.guardar_ejecucion_sorteo(
    UUID, DATE, DATE, INTEGER, TEXT, TEXT, TEXT, INTEGER, JSONB, JSONB, UUID
) TO authenticated, service_role;
