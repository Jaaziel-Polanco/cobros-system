-- ══════════════════════════════════════════════════════════════
-- Migración: los trabajos de prueba dejan de fingir ser un boleto
--
-- imprimirPaginaDePrueba() (lib/actions/impresion.ts) colgaba su trabajo
-- del boleto real más reciente "solo para satisfacer la clave foránea"
-- de print_jobs.ticket_id (NOT NULL hasta ahora). Eso tenía tres efectos
-- reales sobre un boleto de un cliente que no tenía nada que ver con la
-- prueba:
--   · Inflaba tickets.veces_impreso, así que la siguiente impresión
--     legítima de ESE boleto salía marcada "*** COPIA ***" sin motivo.
--   · Insertaba en ticket_eventos un evento 'impreso' que nunca ocurrió
--     en el historial de ESE cliente.
--   · Mientras la prueba estaba 'pendiente'/'reclamado', el índice único
--     uq_print_jobs_ticket_en_vuelo bloqueaba la impresión real de ESE
--     boleto: la cajera veía "ya estaba en la cola" y nunca salía.
--
-- Un trabajo de servicio (página de prueba) no es la impresión de un
-- boleto y no debe fingir serlo: ticket_id pasa a ser opcional y se
-- añade es_prueba para dejar explícito el tipo de trabajo, en vez de
-- inferirlo indirectamente de "ticket_id es NULL" en cada consulta futura.
--
-- app/api/print/ack/route.ts deja de tocar tickets/ticket_eventos cuando
-- el trabajo es de prueba (ver ese archivo).
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.print_jobs
  ALTER COLUMN ticket_id DROP NOT NULL;

ALTER TABLE public.print_jobs
  ADD COLUMN IF NOT EXISTS es_prueba BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.print_jobs.ticket_id IS
'NULL para trabajos de servicio (es_prueba = TRUE): una página de prueba no pertenece a ningún boleto.';

COMMENT ON COLUMN public.print_jobs.es_prueba IS
'TRUE para páginas de prueba encoladas desde /estaciones (imprimirPaginaDePrueba). No representa la impresión de un boleto real: app/api/print/ack/route.ts no debe actualizar tickets ni ticket_eventos para estas filas.';

-- La fila nunca debe quedar ambigua: un trabajo real siempre lleva su
-- ticket_id, uno de prueba nunca lo lleva.
ALTER TABLE public.print_jobs
  DROP CONSTRAINT IF EXISTS ck_print_jobs_prueba_sin_ticket;

ALTER TABLE public.print_jobs
  ADD CONSTRAINT ck_print_jobs_prueba_sin_ticket
  CHECK (
    (es_prueba = FALSE AND ticket_id IS NOT NULL)
    OR
    (es_prueba = TRUE AND ticket_id IS NULL)
  );

-- ── Nota sobre uq_print_jobs_ticket_en_vuelo (20260730_05) ─────────────
-- Ese índice único parcial es sobre (ticket_id) WHERE estado IN
-- ('pendiente','reclamado'). En PostgreSQL, NULL nunca es igual a otro
-- NULL a efectos de un índice único (igual que UNIQUE normal), así que
-- varias pruebas simultáneas (todas con ticket_id NULL) NUNCA chocan
-- entre sí: no hace falta tocar el índice. Verificado en
-- supabase/tests/print_queue_prueba.sql.

-- ══════════════════════════════════════════════════════════════
-- COMPROBACIÓN
--
--   -- ticket_id ahora admite NULL:
--   SELECT is_nullable FROM information_schema.columns
--    WHERE table_name = 'print_jobs' AND column_name = 'ticket_id';
--   -- debe dar 'YES'
--
--   -- el CHECK existe:
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'public.print_jobs'::regclass
--      AND conname = 'ck_print_jobs_prueba_sin_ticket';
-- ══════════════════════════════════════════════════════════════
