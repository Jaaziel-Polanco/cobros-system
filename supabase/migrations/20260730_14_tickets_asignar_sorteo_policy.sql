-- ══════════════════════════════════════════════════════════════
-- Migración: policy que faltaba para asignarTicketsASorteo()
--
-- CONTEXTO: lib/actions/tickets.ts::asignarTicketsASorteo() escribe con el
-- cliente ligado a sesión (no con un RPC SECURITY DEFINER), igual que
-- anularTicket(). Las únicas policies de escritura sobre `tickets` hasta
-- ahora eran:
--   · "tickets: admin acceso total"            (FOR ALL, solo admin)
--   · "tickets: agente anula los de sus clientes" (FOR UPDATE, exige
--     generar_ticket_manual Y que el boleto sea de un cliente asignado al
--     agente que llama)
-- Ninguna de las dos cubre "actualizar sorteo_id de un boleto huérfano".
-- Sin esta policy, un agente no-admin con el permiso realizar_sorteo (que sí
-- lo autoriza en TypeScript, vía getPermisos) vería su UPDATE bloqueado por
-- RLS y devolver 0 filas SIN error -- exactamente el patrón de fallo
-- silencioso que ya se corrigió antes en este módulo para
-- enviarTicketWhatsApp (ver comentario I7 en emitir_ticket/
-- incrementar_envio_ticket).
--
-- El boleto huérfano a asignar puede pertenecer a un cliente de OTRO
-- agente, no necesariamente al que ejecuta la acción -- gestionar sorteos
-- es una operación transversal, igual que sorteo_ganadores/
-- sorteo_participantes/sorteo_ejecuciones ya se gatean solo con
-- tiene_permiso('realizar_sorteo'), sin exigir propiedad del cliente. Esta
-- policy sigue el mismo patrón: no está atada a agente_id.
--
-- USING se restringe a sorteo_id IS NULL para minimizar el radio de la
-- policy (no habilita reescribir boletos que ya pertenecen a un sorteo).
--
-- CORRECCIÓN (revisión posterior a la primera versión de esta migración):
-- el WITH CHECK original solo exigía el permiso, sin restringir cómo debía
-- quedar la fila. RLS no distingue columnas, pero SÍ puede exigir la forma
-- de la fila resultante -- y sin eso, esta misma policy también habría
-- servido para, con la excusa de "asignar a un sorteo", ANULAR un boleto
-- huérfano (poner estado = 'anulado' dejando sorteo_id NULL, que sigue
-- cumpliendo el USING) o para revertir la asignación dejándolo de nuevo sin
-- sorteo (sorteo_id = NULL de nuevo). Ninguna de las dos es "asignar".
--
-- Con `estado = 'valido' AND sorteo_id IS NOT NULL` en el WITH CHECK,
-- combinado con `sorteo_id IS NULL` en el USING, la fila solo puede transitar
-- en una dirección (huérfano válido -> asignado a un sorteo, siempre válido)
-- y esa transición solo puede ocurrir una vez: después de aplicarse,
-- sorteo_id ya no es NULL, así que el USING deja de cumplirse y la misma
-- policy no autoriza ningún UPDATE posterior sobre esa fila.
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "tickets: asignar huerfanos a sorteo" ON public.tickets;
CREATE POLICY "tickets: asignar huerfanos a sorteo"
  ON public.tickets FOR UPDATE
  USING (
    sorteo_id IS NULL
    AND estado = 'valido'
    AND public.tiene_permiso('realizar_sorteo')
  )
  WITH CHECK (
    public.tiene_permiso('realizar_sorteo')
    AND estado = 'valido'
    AND sorteo_id IS NOT NULL
  );

-- Mismo problema en ticket_eventos: la única policy de INSERT para agentes
-- ("ticket_eventos: agente registra eventos de sus clientes") exige que el
-- boleto sea de un cliente del agente que llama, lo cual no se cumple en
-- general al asignar huérfanos de otros agentes a un sorteo. Se acota a
-- tipo = 'asignado_sorteo' para no abrir una vía general de inserción de
-- eventos ajenos.
DROP POLICY IF EXISTS "ticket_eventos: agente registra asignacion de sorteo" ON public.ticket_eventos;
CREATE POLICY "ticket_eventos: agente registra asignacion de sorteo"
  ON public.ticket_eventos FOR INSERT
  WITH CHECK (
    tipo = 'asignado_sorteo'
    AND public.tiene_permiso('realizar_sorteo')
  );
