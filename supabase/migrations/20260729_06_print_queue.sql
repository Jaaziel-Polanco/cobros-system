-- ══════════════════════════════════════════════════════════════
-- Migración: cola de impresión
--   · Reclamo atómico con FOR UPDATE SKIP LOCKED
--   · Recuperación de trabajos colgados
--   · Purga de payloads antiguos
--
-- Verificado con supabase/tests/print_queue.sql (transacción con ROLLBACK,
-- no deja datos). Ejecutar ese guion después de aplicar esta migración.
-- ══════════════════════════════════════════════════════════════

/**
 * Entrega hasta p_limite trabajos pendientes de la sucursal, marcándolos
 * como reclamados en la misma sentencia.
 *
 * FOR UPDATE SKIP LOCKED garantiza que dos instancias del agente jamás
 * reciban el mismo trabajo. El servicio de referencia comprobaba una bandera
 * en JavaScript y luego escribía, lo que con dos instancias imprimía doble.
 */
CREATE OR REPLACE FUNCTION public.reclamar_print_jobs(
    p_estacion_id UUID,
    p_sucursal_id UUID,
    p_limite      INTEGER DEFAULT 5
)
RETURNS SETOF public.print_jobs AS $$
BEGIN
    -- Trabajos que quedaron reclamados sin confirmación: vuelven a la cola
    -- si les quedan intentos.
    UPDATE public.print_jobs
       SET estado      = 'pendiente',
           estacion_id = NULL,
           claimed_at  = NULL
     WHERE sucursal_id = p_sucursal_id
       AND estado      = 'reclamado'
       AND claimed_at  < NOW() - INTERVAL '90 seconds'
       AND intentos    < max_intentos;

    -- Los que agotaron los intentos se marcan como error.
    UPDATE public.print_jobs
       SET estado        = 'error',
           error_mensaje = COALESCE(error_mensaje,
                             'La estación no confirmó la impresión tras varios intentos')
     WHERE sucursal_id = p_sucursal_id
       AND estado      = 'reclamado'
       AND claimed_at  < NOW() - INTERVAL '90 seconds'
       AND intentos   >= max_intentos;

    RETURN QUERY
    UPDATE public.print_jobs
       SET estado      = 'reclamado',
           estacion_id = p_estacion_id,
           claimed_at  = NOW(),
           intentos    = intentos + 1
     WHERE id IN (
         SELECT id FROM public.print_jobs
          WHERE sucursal_id = p_sucursal_id
            AND estado      = 'pendiente'
            AND intentos    < max_intentos
          ORDER BY created_at
          LIMIT p_limite
          FOR UPDATE SKIP LOCKED
     )
    RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

/**
 * Vacía el payload ESC/POS de los trabajos terminados hace más de N días.
 * La fila se conserva para auditoría; solo se libera el espacio del base64.
 */
CREATE OR REPLACE FUNCTION public.purgar_payloads_impresos(p_dias INTEGER DEFAULT 7)
RETURNS INTEGER AS $$
DECLARE
    v_afectados INTEGER;
BEGIN
    UPDATE public.print_jobs
       SET payload_escpos = NULL
     WHERE payload_escpos IS NOT NULL
       AND estado IN ('impreso','cancelado','error')
       AND COALESCE(impreso_at, created_at) < NOW() - (p_dias || ' days')::INTERVAL;

    GET DIAGNOSTICS v_afectados = ROW_COUNT;
    RETURN v_afectados;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── GRANT restringido ──────────────────────────────────────────
-- Ambas funciones solo las invoca el servidor: reclamar_print_jobs desde
-- app/api/print/poll/route.ts y purgar_payloads_impresos desde un futuro
-- cron de mantenimiento, ambos con el cliente admin (service_role). Ningún
-- usuario de sesión ni la clave anónima del navegador debe poder llamarlas
-- directamente (ver supabase/migrations/20260730_00_revocar_execute_publico.sql,
-- mismo patrón: PostgreSQL concede EXECUTE a PUBLIC por defecto y Supabase
-- añade grants a anon/authenticated vía ALTER DEFAULT PRIVILEGES).
REVOKE ALL ON FUNCTION public.reclamar_print_jobs(UUID, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reclamar_print_jobs(UUID, UUID, INTEGER)
  TO service_role;

REVOKE ALL ON FUNCTION public.purgar_payloads_impresos(INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purgar_payloads_impresos(INTEGER)
  TO service_role;

-- ══════════════════════════════════════════════════════════════
-- COMPROBACIÓN. Deben dar anon = false, authenticated = false,
-- service_role = true.
--
--   SELECT p.proname,
--          has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
--          has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname IN ('reclamar_print_jobs','purgar_payloads_impresos');
-- ══════════════════════════════════════════════════════════════
