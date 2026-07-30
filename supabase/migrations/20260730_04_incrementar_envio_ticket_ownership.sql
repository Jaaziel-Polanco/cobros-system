-- ══════════════════════════════════════════════════════════════
-- Migración: incrementar_envio_ticket -- comprobación de propiedad
--
-- CONTEXTO (menor, señalado en la re-revisión de la oleada 2):
-- incrementar_envio_ticket (20260730_01_incrementar_envio_ticket.sql) es
-- SECURITY DEFINER con GRANT EXECUTE TO authenticated y no comprueba nada
-- sobre el llamante: cualquier usuario logueado que conozca el UUID de un
-- boleto ajeno puede invocar el RPC directamente y hacer que
-- tickets.veces_enviado suba, sin que ese boleto sea suyo ni de un cliente
-- que administre.
--
-- Es un impacto acotado -- solo infla un contador informativo, no expone
-- ni modifica ningún otro dato --, pero el mismo patrón que ya se cerró en
-- emitir_ticket (20260730_02_emitir_ticket_ownership.sql, I5) aplica aquí
-- con el mismo costo bajo, así que se corrige igual.
--
-- CORRECCIÓN: mismo patrón que emitir_ticket. Si auth.uid() no es NULL (la
-- llamada viene de un usuario real vía cliente de sesión, no de un proceso
-- interno con service_role) y el usuario no es admin, se exige que el
-- cliente dueño del boleto tenga agente_id = auth.uid(); si no, se lanza
-- una excepción. `agente_id IS DISTINCT FROM auth.uid()` -- no `<>` -- por
-- la misma razón que en emitir_ticket: clientes.agente_id es NULLABLE (hay
-- clientes sin agente asignado) y `NULL <> uuid` da NULL, no TRUE, con lo
-- que el IF nunca entraría y cualquier agente pasaría la comprobación para
-- un cliente sin asignar.
--
-- Si auth.uid() es NULL (llamadas internas con service_role: crons,
-- scripts), el comportamiento es exactamente el mismo de antes: sin
-- comprobación.
--
-- El llamante en lib/actions/tickets.ts (enviarTicketWhatsApp) ya solo
-- registra el error con console.error si el RPC falla -- no revienta el
-- flujo de envío -- así que convertir el "no autorizado" en una excepción
-- del RPC es seguro: no cambia el comportamiento visible para un agente
-- legítimo, solo bloquea el abuso.
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.incrementar_envio_ticket(p_ticket_id UUID)
RETURNS VOID AS $$
DECLARE
    v_agente_id UUID;
BEGIN
    IF auth.uid() IS NOT NULL AND public.get_my_rol() <> 'admin' THEN
        SELECT c.agente_id INTO v_agente_id
        FROM public.tickets t
        JOIN public.clientes c ON c.id = t.cliente_id
        WHERE t.id = p_ticket_id;

        IF NOT FOUND OR v_agente_id IS DISTINCT FROM auth.uid() THEN
            RAISE EXCEPTION 'No tienes permiso para operar sobre este boleto';
        END IF;
    END IF;

    UPDATE public.tickets
       SET veces_enviado = veces_enviado + 1
     WHERE id = p_ticket_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- El REVOKE/GRANT de 20260730_01_incrementar_envio_ticket.sql sigue
-- vigente: CREATE OR REPLACE no toca privilegios. No hace falta repetirlo.
