-- ══════════════════════════════════════════════════════════════
-- Migración: `asignar_tickets_a_sorteo` exige también `ver_sorteos`
-- — tercer nivel del desajuste H3
--
-- PENDIENTE DE APLICAR.
--
-- CONTEXTO (H3 de review-plan3-report.md): la asignación masiva de boletos
-- huérfanos estaba gateada con `realizar_sorteo` en los tres sitios, pero el
-- desplegable donde se elige el sorteo destino se llena leyendo `sorteos`
-- con el cliente de sesión, y la policy "sorteos: lectura con permiso" exige
-- `ver_sorteos`. Un agente con `realizar_sorteo` y sin `ver_sorteos`
-- —combinación que /usuarios permite marcar, porque son casillas
-- independientes y ambas por defecto false— veía las casillas activas, la
-- barra "Asignar N boletos", y un desplegable que decía "No hay sorteos
-- abiertos": un callejón sin salida sin explicación.
--
-- Es la octava aparición del mismo defecto en este módulo (interfaz, acción
-- y base pidiendo cosas distintas), y se alinea en los tres niveles:
--   1. app/(dashboard)/tickets/page.tsx → puedeAsignarSorteo exige ambos.
--   2. lib/actions/tickets.ts::asignarTicketsASorteo → exige ambos.
--   3. este RPC → exige ambos.
--
-- El resto del cuerpo es idéntico a
-- 20260730_16_asignar_tickets_a_sorteo.sql; lo único que cambia es el
-- bloque de comprobación de permiso. Se reproduce entero porque
-- CREATE OR REPLACE FUNCTION no admite parches parciales.
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
        -- AÑADIDO (H3): sin `ver_sorteos` no se puede ni ver la lista de
        -- sorteos destino, así que tampoco se debe poder escribir en ella.
        IF NOT public.tiene_permiso('ver_sorteos') THEN
            RETURN jsonb_build_object('ok', false, 'error',
                'Para asignar boletos a un sorteo hace falta también el permiso de ver sorteos');
        END IF;
        v_usuario := auth.uid();
    END IF;

    IF p_ticket_ids IS NULL OR array_length(p_ticket_ids, 1) IS NULL THEN
        RETURN jsonb_build_object('ok', true, 'asignados', 0,
                                   'rechazados_por_numero', '[]'::jsonb);
    END IF;

    SELECT * INTO v_sorteo FROM public.sorteos WHERE id = p_sorteo_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Sorteo no encontrado');
    END IF;
    IF v_sorteo.estado = 'cerrado' THEN
        RETURN jsonb_build_object('ok', false, 'error',
            'El sorteo está cerrado y no admite nuevas asignaciones');
    END IF;

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

-- CREATE OR REPLACE conserva los ACL existentes, pero se repiten por si la
-- función se recrea alguna vez desde cero. Mismo patrón que 20260730_16.
REVOKE ALL ON FUNCTION public.asignar_tickets_a_sorteo(
    UUID[], UUID, UUID
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.asignar_tickets_a_sorteo(
    UUID[], UUID, UUID
) TO authenticated, service_role;
