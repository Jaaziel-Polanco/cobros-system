-- ══════════════════════════════════════════════════════════════
-- Migración: la policy de INSERT de print_jobs también exige que el
-- boleto sea de un cliente del agente que encola
--
-- Pregunta que dejó abierta la revisión de 20260730_09: ¿qué impide hoy
-- que un agente encole la impresión del boleto de un cliente AJENO, de
-- su propia sucursal (o de cualquier sucursal)?
--
-- Respuesta: nada, y sí importa. La 09 solo comprobaba
-- `sucursal_id = mi sucursal` y `solicitado_por = auth.uid()`, pero no
-- que `ticket_id` fuera un boleto que el agente pudiera siquiera ver.
-- Eso no es un problema de confidencialidad -- `payload_escpos` lo pone
-- el propio atacante, no se lee del boleto -- sino de INTEGRIDAD: la
-- comprobación de FOREIGN KEY de Postgres verifica que la fila referida
-- EXISTE, pero no aplica RLS al hacerlo (evalúa la referencia con
-- privilegios internos, no con los de quien ejecuta el INSERT). Así que
-- un agente podía poner en `ticket_id` el UUID de un boleto que ni
-- siquiera puede ver por la policy de SELECT de `tickets` ("tickets:
-- agente ve los de sus clientes", `c.agente_id = auth.uid()`), y si ese
-- trabajo se imprime y se confirma, app/api/print/ack/route.ts —que
-- corre con service_role, sin RLS— le incrementa `veces_impreso` y le
-- inserta un evento `impreso` en `ticket_eventos` a un cliente con el
-- que el atacante no tiene ninguna relación. Es la misma clase de daño
-- que el CRÍTICO de esta ronda (un trabajo "de servicio" ensuciando el
-- historial de un boleto ajeno), pero deliberado en vez de accidental, y
-- alcanzable sin admin: solo hace falta el permiso 'imprimir_ticket' y
-- conocer o adivinar un UUID de boleto ajeno.
--
-- Por qué SÍ se puede cerrar sin romper nada legítimo: imprimirTicket()
-- en lib/actions/impresion.ts lee el boleto con el cliente de SESIÓN
-- (`supabase.from('tickets').select('*').eq('id', ticketId).single()`),
-- que YA pasa por esa misma policy de SELECT. Un agente no-admin, hoy,
-- ya NO PUEDE imprimir (ni ver) el boleto de un cliente que no es suyo a
-- través de la aplicación normal -- `ticketData` viene NULL y la acción
-- lanza "Boleto no encontrado" antes de llegar a construir nada. Exigir
-- lo mismo en la policy de INSERT de print_jobs no le quita ninguna
-- capacidad real a ningún flujo existente: solo cierra la vía de saltarse
-- la Server Action con un INSERT hecho a mano desde el navegador (mismo
-- patrón que 20260730_02_emitir_ticket_ownership.sql en el Plan 1).
--
-- Se usa IS DISTINCT FROM, no <>, por la misma razón que en
-- 20260730_02_emitir_ticket_ownership.sql: clientes.agente_id es
-- NULLABLE (hay clientes sin agente asignado todavía), y `<>` con NULL
-- da NULL (ni verdadero ni falso), lo que dejaría colar el INSERT en vez
-- de rechazarlo. Aquí se usa la forma positiva (EXISTS ... agente_id =
-- auth.uid()), que ya excluye correctamente el caso NULL sin necesitar
-- IS DISTINCT FROM: si agente_id es NULL, el EXISTS no encuentra fila y
-- el INSERT se rechaza, que es el comportamiento correcto (un boleto sin
-- agente asignado no es "de" nadie todavía).
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "print_jobs: encolar con propiedad" ON public.print_jobs;
CREATE POLICY "print_jobs: encolar con propiedad"
  ON public.print_jobs FOR INSERT
  WITH CHECK (
    public.tiene_permiso('imprimir_ticket')
    AND solicitado_por = auth.uid()
    AND sucursal_id = (
      SELECT p.sucursal_id FROM public.profiles p WHERE p.id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.tickets t
      JOIN public.clientes c ON c.id = t.cliente_id
      WHERE t.id = ticket_id AND c.agente_id = auth.uid()
    )
  );

-- ══════════════════════════════════════════════════════════════
-- COMPROBACIÓN (con un usuario de sesión no-admin, no service_role):
--
--   -- Debe fallar: boleto de un cliente ajeno, aunque la sucursal
--   -- y solicitado_por sean correctos.
--   INSERT INTO public.print_jobs (ticket_id, sucursal_id, solicitado_por, payload_escpos)
--   VALUES ('<ticket de OTRO agente>', '<mi sucursal>', auth.uid(), 'AAAA');
--
--   -- Debe funcionar: boleto de un cliente propio, en mi sucursal.
--   INSERT INTO public.print_jobs (ticket_id, sucursal_id, solicitado_por, payload_escpos)
--   VALUES ('<ticket de MI cliente>', '<mi sucursal>', auth.uid(), 'AAAA');
-- ══════════════════════════════════════════════════════════════
