-- ══════════════════════════════════════════════════════════════
-- Migración: deduplicación de trabajos de impresión en curso
--   · Cierra en la base la ventana de carrera de imprimirTicket
--     (lib/actions/impresion.ts): un SELECT de "¿ya hay un trabajo
--     pendiente/reclamado para este boleto?" seguido de un INSERT no evita
--     que dos peticiones casi simultáneas lean ambas "no existe" antes de
--     que cualquiera inserte. Verificado en producción con Promise.all
--     contra datos ZZTEST_: sin este índice, la carrera deja 2 filas.
--
-- Mismo patrón que uq_tickets_pago (20260729_01_boleteria_base.sql:127-129):
-- índice único PARCIAL, no una restricción permanente. Mientras el trabajo
-- esté "en vuelo" (pendiente o reclamado por un agente, aún sin confirmar)
-- no puede haber otro para el mismo boleto. En cuanto termina —impreso,
-- error o cancelado— deja de contar para el índice y una reimpresión
-- legítima puede encolarse sin chocar con esta restricción.
-- ══════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS uq_print_jobs_ticket_en_vuelo
  ON public.print_jobs (ticket_id)
  WHERE estado IN ('pendiente', 'reclamado');

-- ══════════════════════════════════════════════════════════════
-- COMPROBACIÓN. Debe existir y ser único:
--
--   SELECT indexname, indexdef FROM pg_indexes
--    WHERE tablename = 'print_jobs' AND indexname = 'uq_print_jobs_ticket_en_vuelo';
-- ══════════════════════════════════════════════════════════════
