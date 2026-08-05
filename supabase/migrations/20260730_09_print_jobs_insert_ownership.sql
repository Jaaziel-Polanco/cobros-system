-- ══════════════════════════════════════════════════════════════
-- Migración: endurece la policy de INSERT de print_jobs
--
-- "print_jobs: encolar con permiso" (20260729_02_permisos_boleteria.sql)
-- solo exigía tiene_permiso('imprimir_ticket'). No comprobaba sucursal,
-- ni propiedad del boleto, ni que solicitado_por fuera quien dice ser.
-- La Server Action (lib/actions/impresion.ts) sí valida todo eso, pero
-- print_jobs es escribible desde el navegador con la clave anónima: un
-- agente con ese permiso podía construir el INSERT a mano (DevTools,
-- curl con su JWT) y encolar bytes ESC/POS arbitrarios en la impresora
-- de CUALQUIER sucursal, a nombre de OTRO usuario.
--
-- Mismo patrón que ya se cerró en el Plan 1 con emitir_ticket
-- (20260730_02_emitir_ticket_ownership.sql): la validación no puede vivir
-- solo en TypeScript cuando la tabla es escribible desde el navegador.
--
-- La policy ahora exige, además del permiso:
--   · solicitado_por = auth.uid() — nadie encola a nombre de otro.
--   · sucursal_id = la sucursal del perfil de quien escribe — nadie
--     encola en la impresora de otra sucursal.
--
-- No se exige aquí que ticket_id pertenezca a un cliente del agente (a
-- diferencia de ticket_eventos): imprimir_ticket ya solo deja ver/
-- reimprimir boletos a quien tiene permiso 'ver_tickets' sobre ellos vía
-- las policies de `tickets`, y un print_job sin lectura del ticket
-- correspondiente no sirve de nada an malicioso — el agente ni siquiera
-- podría construir un payload_escpos útil sin poder leer el snapshot.
-- La superficie real de abuso que cierra esta migración es la sucursal
-- (a qué impresora física llega el papel) y la identidad de quien pide
-- la impresión, que es justo lo que la policy anterior no comprobaba.
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "print_jobs: encolar con permiso" ON public.print_jobs;
CREATE POLICY "print_jobs: encolar con propiedad"
  ON public.print_jobs FOR INSERT
  WITH CHECK (
    public.tiene_permiso('imprimir_ticket')
    AND solicitado_por = auth.uid()
    AND sucursal_id = (
      SELECT p.sucursal_id FROM public.profiles p WHERE p.id = auth.uid()
    )
  );

-- ══════════════════════════════════════════════════════════════
-- COMPROBACIÓN (con un usuario de sesión, no admin/service_role):
--
--   -- Debe fallar: sucursal ajena
--   INSERT INTO public.print_jobs (ticket_id, sucursal_id, solicitado_por, payload_escpos)
--   VALUES ('<ticket real>', '<sucursal de OTRA sucursal>', auth.uid(), 'AAAA');
--
--   -- Debe fallar: solicitado_por suplantado
--   INSERT INTO public.print_jobs (ticket_id, sucursal_id, solicitado_por, payload_escpos)
--   VALUES ('<ticket real>', '<mi sucursal>', '<otro user_id>', 'AAAA');
--
--   -- Debe funcionar: propio, en la propia sucursal
--   INSERT INTO public.print_jobs (ticket_id, sucursal_id, solicitado_por, payload_escpos)
--   VALUES ('<ticket real>', '<mi sucursal>', auth.uid(), 'AAAA');
-- ══════════════════════════════════════════════════════════════
