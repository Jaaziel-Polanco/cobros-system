-- ══════════════════════════════════════════════════════════════
-- Migración: un agente ve el estado de impresión de un boleto que puede
-- ver, no solo de los trabajos que él mismo encoló
--
-- Tarea 8 del Plan 2 (cola de impresión) añade un indicador discreto en
-- el perfil del cliente: junto a cada boleto, si tiene un trabajo de
-- impresión reciente, en qué estado está. La decisión de permisos es
-- "el estado del propio boleto, de quien pueda ver ese boleto" — no
-- "de quien lo solicitó".
--
-- La policy "print_jobs: ver los propios" (20260729_02_permisos_boleteria.sql)
-- solo cubre `solicitado_por = auth.uid()`. Eso deja un caso real sin
-- resolver: la cajera A imprime el boleto de un cliente de la cajera B
-- (mismo permiso, boleto de un cliente ajeno... no, en realidad los
-- boletos son de clientes con un agente_id concreto). El caso que sí
-- ocurre en producción: dos usuarios con acceso al mismo cliente (por
-- ejemplo, un agente y un admin, o el mismo agente en dos sesiones/PCs)
-- — el que NO encoló el trabajo no podía ver su estado, aunque sí puede
-- ver el boleto en sí (misma policy de SELECT de `tickets`: "tickets:
-- agente ve los de sus clientes", `c.agente_id = auth.uid()`).
--
-- Se añade una segunda condición, en OR con la existente: se puede ver
-- un print_job si el ticket_id al que pertenece es de un cliente propio
-- Y, además, el usuario conserva el permiso `ver_tickets`. Esa segunda
-- comprobación se añadió en revisión (Importante, ronda posterior a la
-- primera versión de esta migración): sin ella, la policy no reproducía
-- de verdad "de quien pueda ver ese boleto" — la policy de SELECT real de
-- `tickets` exige AMBAS cosas, `tiene_permiso('ver_tickets')` y
-- `c.agente_id = auth.uid()` (20260729_02_permisos_boleteria.sql). Copiar
-- solo la mitad (la propiedad, sin el permiso) dejaba a un agente al que
-- se le retiró `ver_tickets` seguir viendo el ESTADO de impresión de los
-- boletos de sus clientes — aunque ya no pueda ver los boletos en sí —
-- con solo conocer o adivinar el UUID del ticket. Impacto bajo (el
-- estado de un print_job no expone datos del cliente), pero es la misma
-- clase de fuga que ya se cerró varias veces en este plan y en el
-- anterior, así que se cierra aquí también en vez de dejarla "de bajo
-- impacto, ya se verá".
--
-- Los trabajos de prueba (ticket_id NULL) no entran por esta rama —no
-- pertenecen a ningún cliente— así que solo los ve quien los solicitó,
-- exactamente igual que antes.
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "print_jobs: ver los propios" ON public.print_jobs;
CREATE POLICY "print_jobs: ver los propios"
  ON public.print_jobs FOR SELECT
  USING (
    solicitado_por = auth.uid()
    OR (
      ticket_id IS NOT NULL
      AND public.tiene_permiso('ver_tickets')
      AND EXISTS (
        SELECT 1 FROM public.tickets t
        JOIN public.clientes c ON c.id = t.cliente_id
        WHERE t.id = ticket_id AND c.agente_id = auth.uid()
      )
    )
  );

-- ══════════════════════════════════════════════════════════════
-- COMPROBACIÓN (con un usuario de sesión no-admin, no service_role):
--
--   -- Debe verse: trabajo de un boleto de un cliente propio, aunque lo
--   -- haya solicitado otro usuario, con el permiso ver_tickets activo.
--   SELECT * FROM public.print_jobs
--    WHERE ticket_id = '<ticket de un cliente propio>';
--
--   -- No debe verse: trabajo de un boleto de un cliente ajeno, ni un
--   -- trabajo de prueba solicitado por otro usuario, ni (con
--   -- ver_tickets = false en profiles.permisos) el de un cliente propio.
--   SELECT * FROM public.print_jobs
--    WHERE ticket_id = '<ticket de un cliente ajeno>';
-- ══════════════════════════════════════════════════════════════
