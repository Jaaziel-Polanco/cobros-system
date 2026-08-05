-- ══════════════════════════════════════════════════════════════
-- Migración: RPC asignar_tickets_a_sorteo -- reemplaza el UPDATE por
-- sesión para asignar boletos huérfanos a un sorteo
--
-- CONTEXTO: lib/actions/tickets.ts::asignarTicketsASorteo() hacía el
-- SELECT/UPDATE directo con el cliente de sesión, apoyado en dos policies
-- de RLS (20260730_14 y 20260730_15). Se descubrió, verificando contra
-- producción con un agente real impersonado (SET LOCAL ROLE authenticated
-- + request.jwt.claims), que ese camino tenía dos problemas, no uno:
--
--   1) Sin una policy de SELECT sobre huérfanos ajenos, Postgres no podía
--      ni "ver" la fila para el UPDATE (0 filas, sin error) -- lo resolvía
--      20260730_15.
--   2) Incluso con esa policy, Postgres exige ADEMÁS que la fila
--      RESULTANTE del UPDATE siga siendo visible bajo alguna policy de
--      SELECT para el mismo usuario. Un huérfano ajeno, tras asignarlo dejaba
--      de cumplir cualquier policy de SELECT (ya no es huérfano, y el
--      cliente sigue sin ser suyo), así que el UPDATE se rechazaba de
--      todos modos con "new row violates row-level security policy" --
--      justo el caso transversal que motivaba la función.
--
-- La única forma de arreglar (2) sin RLS habría sido ampliar la
-- visibilidad de `tickets` a "cualquier boleto, esté o no asignado, para
-- quien tenga realizar_sorteo" -- una fuga de PII permanente y mucho más
-- amplia que la transitoria de 20260730_15 (que ya exponía
-- snapshot->cliente->dni_ruc, teléfono y el token_publico de CUALQUIER
-- huérfano a cualquiera con el permiso). Esa policy (20260730_15) fue
-- revertida en producción por ese motivo -- ver el DROP en el propio
-- archivo 20260730_15_tickets_ver_huerfanos_con_permiso_sorteo.sql,
-- reescrito para reflejar la reversión real en vez de la policy que ya
-- no existe.
--
-- CORRECCIÓN DEFINITIVA: mover la escritura a un RPC SECURITY DEFINER,
-- igual que ya hacen emitir_ticket, registrar_pago_atomico y
-- guardar_ejecucion_sorteo en este mismo módulo. Un SECURITY DEFINER no
-- pasa por RLS en absoluto, así que ninguno de los dos problemas de
-- arriba aplica: el propio dueño de la función puede ver y escribir
-- cualquier fila, sin necesitar ninguna policy de SELECT nueva sobre
-- `tickets`. La comprobación de permiso se hace DENTRO del RPC, con el
-- mismo patrón `IF auth.uid() IS NOT NULL THEN ... END IF` que usan los
-- otros tres, para que las llamadas internas con service_role (si algún
-- día las hay) sigan funcionando sin permiso de sesión.
--
-- CONTRATO DE RESPUESTA (deliberadamente mínimo): 'ok', 'asignados' (conteo)
-- y 'rechazados_por_numero' (array de ids de boletos que no se asignaron
-- por chocar su numero con uno ya existente en el sorteo destino). NUNCA
-- snapshot, NUNCA token_publico, NUNCA ningún dato del cliente -- así la
-- Server Action no puede filtrar hacia el navegador lo que el RPC no le
-- entrega en primer lugar, cerrando de raíz el tipo de exposición que
-- motivó revertir 20260730_15.
--
-- NO RENUMERAR JAMÁS: numero_formateado puede estar ya impreso en papel o
-- enviado por WhatsApp: cambiarlo invalidaría un boleto que el cliente
-- tiene en la mano. El índice único uq_tickets_numero_sorteo
-- (sorteo_id, numero) WHERE sorteo_id IS NOT NULL no filtra por estado del
-- boleto -- un boleto anulado del sorteo destino sigue "ocupando" su
-- número para siempre --, y los huérfanos numeran con una secuencia
-- global propia (tickets_numero_huerfano_seq) que puede perfectamente
-- coincidir con el correlativo del sorteo destino. Por eso el choque se
-- calcula ANTES de escribir nada: se separan los candidatos en
-- "asignables" y "rechazados por número" con un LEFT JOIN/EXISTS contra
-- los números que ya existen en el sorteo destino, y el UPDATE solo toca
-- los asignables. Al estar ya filtrados de antemano, el UPDATE no puede
-- chocar con el índice único, así que --a diferencia de la primera
-- versión de asignarTicketsASorteo, que vivía en TypeScript y necesitaba
-- reintentar fila a fila tras un 23505-- una sola sentencia por lotes
-- basta: todo el trabajo ocurre dentro de una única transacción SQL
-- (el cuerpo de la función), y el UPDATE...RETURNING confirma qué se
-- asignó de verdad (por si una fila cambió de estado entre el cálculo de
-- candidatos y el UPDATE, por ejemplo, otro proceso asignándola primero).
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.asignar_tickets_a_sorteo(
    p_ticket_ids   UUID[],
    p_sorteo_id    UUID,
    p_asignado_por UUID
)
RETURNS JSONB AS $$
DECLARE
    v_sorteo         public.sorteos%ROWTYPE;
    v_usuario        UUID := p_asignado_por;
    v_asignados_ids  UUID[];
    v_rechazados_ids UUID[];
BEGIN
    IF auth.uid() IS NOT NULL THEN
        IF NOT public.tiene_permiso('realizar_sorteo') THEN
            RETURN jsonb_build_object('ok', false, 'error',
                'No tienes permiso para asignar boletos a un sorteo');
        END IF;
        v_usuario := auth.uid();
    END IF;

    IF p_ticket_ids IS NULL OR array_length(p_ticket_ids, 1) IS NULL THEN
        RETURN jsonb_build_object('ok', true, 'asignados', 0,
                                   'rechazados_por_numero', '[]'::jsonb);
    END IF;

    -- FOR UPDATE: mismo motivo que guardar_ejecucion_sorteo -- serializa
    -- esta asignación frente a un cierre concurrente del sorteo.
    SELECT * INTO v_sorteo FROM public.sorteos WHERE id = p_sorteo_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Sorteo no encontrado');
    END IF;
    IF v_sorteo.estado = 'cerrado' THEN
        RETURN jsonb_build_object('ok', false, 'error',
            'El sorteo está cerrado y no admite nuevas asignaciones');
    END IF;

    -- Candidatos reales (huérfanos válidos entre los pedidos), separados
    -- en "asignables" y "rechazados por número" ANTES de escribir nada.
    WITH candidatos AS (
        SELECT id, numero FROM public.tickets
        WHERE id = ANY(p_ticket_ids)
          AND sorteo_id IS NULL
          AND estado = 'valido'
    ),
    marcados AS (
        SELECT c.id, EXISTS (
            SELECT 1 FROM public.tickets t
            WHERE t.sorteo_id = p_sorteo_id AND t.numero = c.numero
        ) AS choca
        FROM candidatos c
    )
    SELECT
        array_agg(id) FILTER (WHERE NOT choca),
        array_agg(id) FILTER (WHERE choca)
    INTO v_asignados_ids, v_rechazados_ids
    FROM marcados;

    IF v_asignados_ids IS NOT NULL THEN
        -- UPDATE...RETURNING, no el array precalculado: si una fila cambió
        -- de estado entre el cálculo de candidatos y aquí (carrera con otro
        -- proceso), esta condición WHERE la excluye sola, y v_asignados_ids
        -- se reasigna al conjunto que REALMENTE se escribió -- así el
        -- conteo devuelto y los eventos insertados abajo nunca mienten
        -- sobre lo que pasó de verdad.
        WITH actualizados AS (
            UPDATE public.tickets
               SET sorteo_id = p_sorteo_id
             WHERE id = ANY(v_asignados_ids)
               AND sorteo_id IS NULL
               AND estado = 'valido'
            RETURNING id
        )
        SELECT array_agg(id) INTO v_asignados_ids FROM actualizados;

        IF v_asignados_ids IS NOT NULL THEN
            INSERT INTO public.ticket_eventos (ticket_id, tipo, estado, detalle, usuario_id)
            SELECT t_id, 'asignado_sorteo', 'ok',
                   format('Asignado al sorteo "%s"', v_sorteo.nombre), v_usuario
            FROM unnest(v_asignados_ids) AS t_id;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'ok',                   true,
        'asignados',            COALESCE(array_length(v_asignados_ids, 1), 0),
        'rechazados_por_numero', COALESCE(to_jsonb(v_rechazados_ids), '[]'::jsonb)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── Endurecimiento: restringir quién puede ejecutar el RPC ───
-- Mismo patrón que emitir_ticket y guardar_ejecucion_sorteo: sin este
-- REVOKE, cualquiera con la clave anónima podría invocarla directamente.
REVOKE ALL ON FUNCTION public.asignar_tickets_a_sorteo(
    UUID[], UUID, UUID
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.asignar_tickets_a_sorteo(
    UUID[], UUID, UUID
) TO authenticated, service_role;
