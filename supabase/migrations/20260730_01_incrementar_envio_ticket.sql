-- ══════════════════════════════════════════════════════════════
-- Migración: RPC atómico para incrementar tickets.veces_enviado
--
-- CONTEXTO (I7): enviarTicketWhatsApp() incrementaba veces_enviado con un
-- UPDATE hecho con el cliente de sesión, en dos pasos (leer t.veces_enviado,
-- luego escribir +1). La única policy de UPDATE sobre tickets para agentes
-- ("tickets: agente anula los de sus clientes") exige generar_ticket_manual,
-- mientras que enviarTicketWhatsApp se gatea con ver_tickets: un agente con
-- ver_tickets y sin generar_ticket_manual conseguía enviar el boleto por
-- WhatsApp (RLS no aplica ahí porque ese INSERT va a ticket_eventos, con su
-- propia policy), pero el UPDATE de tickets afectaba 0 filas sin que nadie
-- se enterara -- Supabase no reporta error cuando un UPDATE no afecta
-- ninguna fila y el código no comprobaba el resultado con .select().
--
-- Este RPC reemplaza ese UPDATE: es SECURITY DEFINER (no depende de la
-- policy de UPDATE de tickets, que sigue existiendo para anularTicket) y
-- hace el incremento en una sola sentencia atómica, sin lectura previa.
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.incrementar_envio_ticket(p_ticket_id UUID)
RETURNS VOID AS $$
    UPDATE public.tickets
       SET veces_enviado = veces_enviado + 1
     WHERE id = p_ticket_id;
$$ LANGUAGE SQL SECURITY DEFINER SET search_path = public;

-- ─── Endurecimiento: restringir quién puede ejecutar el RPC ───
-- Mismo patrón que el resto de RPC de boletería: revocar de PUBLIC y anon,
-- conceder solo a authenticated (Server Actions con cliente de sesión) y
-- service_role (procesos internos).
REVOKE ALL ON FUNCTION public.incrementar_envio_ticket(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.incrementar_envio_ticket(UUID) TO authenticated, service_role;
