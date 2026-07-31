-- ══════════════════════════════════════════════════════════════
-- Migración: rastro de auditoría cuando se recupera un trabajo colgado
--
-- Escenario reproducido (Importante 4 de la revisión del Plan 2): el
-- `ack` de éxito llega con 401 (token regenerado, estación desactivada
-- justo después de imprimir). El agente no reintenta a ciegas —ver
-- print-agent/src/index.ts, esFalloDefinitivo()— porque un 401 no es
-- transitorio. El trabajo se queda 'reclamado' sin confirmar y, pasados
-- 90 s, reclamar_print_jobs() lo recupera. Hasta esta migración, esa
-- recuperación era muda: si al trabajo aún le quedaban intentos volvía a
-- 'pendiente' SIN dejar ningún rastro, ni en print_jobs.error_mensaje ni
-- en ticket_eventos. El siguiente poll lo reentrega, se reimprime, y ese
-- segundo papel sale SIN la marca "*** COPIA ***" porque veces_impreso
-- nunca se incrementó la primera vez (el ack que lo habría hecho fue
-- justo el que falló).
--
-- El servidor no puede saber con certeza si el boleto llegó a salir por
-- la impresora física — eso solo lo sabe el agente, y es justo lo que no
-- pudo confirmar. Pero SÍ puede dejar de ser mudo al respecto: registrar
-- en ticket_eventos que este boleto tuvo un intento sin confirmar, ANTES
-- de que cualquiera vuelva a imprimirlo, para que quien vea el historial
-- del cliente (o de aquí a futuro, una alerta en /estaciones) tenga la
-- oportunidad de verificar el papel físico antes de reimprimir en vez de
-- descubrirlo por un boleto duplicado en la calle.
--
-- Se añade a las DOS ramas de recuperación de reclamar_print_jobs(): la
-- que vuelve a 'pendiente' (donde antes no había NINGÚN rastro) y la que
-- pasa a 'error' por intentos agotados (que ya insertaba error_mensaje en
-- la fila, pero tampoco un evento visible en el historial del cliente).
-- Los trabajos de prueba (ticket_id NULL, es_prueba = true — ver
-- 20260730_07_print_jobs_prueba.sql) no generan ticket_eventos: no
-- pertenecen a ningún cliente.
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.reclamar_print_jobs(
    p_estacion_id UUID,
    p_sucursal_id UUID,
    p_limite      INTEGER DEFAULT 5
)
RETURNS SETOF public.print_jobs AS $$
BEGIN
    -- Trabajos que quedaron reclamados sin confirmación: vuelven a la cola
    -- si les quedan intentos. Se deja constancia en ticket_eventos ANTES
    -- de liberarlos: si el boleto ya salió físicamente y esto lo reentrega,
    -- el historial del cliente ya avisa que hubo un intento sin confirmar,
    -- en vez de que el único rastro sea un segundo papel sin marca COPIA.
    INSERT INTO public.ticket_eventos (ticket_id, tipo, estado, es_copia, detalle)
    SELECT ticket_id, 'impreso', 'error', es_copia,
           'Recuperado tras 90 s sin confirmación del agente (posible token inválido o ' ||
           'estación desactivada). Puede haberse impreso ya en la estación; verifica el ' ||
           'papel físico antes de reimprimir. Vuelve a la cola automáticamente.'
      FROM public.print_jobs
     WHERE sucursal_id = p_sucursal_id
       AND estado      = 'reclamado'
       AND claimed_at  < NOW() - INTERVAL '90 seconds'
       AND intentos    < max_intentos
       AND ticket_id  IS NOT NULL;

    UPDATE public.print_jobs
       SET estado      = 'pendiente',
           estacion_id = NULL,
           claimed_at  = NULL
     WHERE sucursal_id = p_sucursal_id
       AND estado      = 'reclamado'
       AND claimed_at  < NOW() - INTERVAL '90 seconds'
       AND intentos    < max_intentos;

    -- Los que agotaron los intentos se marcan como error, con el mismo
    -- rastro en el historial del cliente.
    INSERT INTO public.ticket_eventos (ticket_id, tipo, estado, es_copia, detalle)
    SELECT ticket_id, 'impreso', 'error', es_copia,
           COALESCE(error_mensaje,
             'La estación no confirmó la impresión tras varios intentos. Puede haberse ' ||
             'impreso ya; verifica el papel físico antes de reimprimir.')
      FROM public.print_jobs
     WHERE sucursal_id = p_sucursal_id
       AND estado      = 'reclamado'
       AND claimed_at  < NOW() - INTERVAL '90 seconds'
       AND intentos   >= max_intentos
       AND ticket_id  IS NOT NULL;

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

-- El GRANT restringido de 20260729_06_print_queue.sql no cambia (CREATE OR
-- REPLACE conserva los privilegios existentes), pero se repite aquí por
-- si alguna vez esta migración se aplica sola contra una base que no pasó
-- por esa: sin esto, un CREATE OR REPLACE en una base nueva heredaría los
-- GRANT por defecto de PostgreSQL a PUBLIC.
REVOKE ALL ON FUNCTION public.reclamar_print_jobs(UUID, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reclamar_print_jobs(UUID, UUID, INTEGER)
  TO service_role;

-- ══════════════════════════════════════════════════════════════
-- COMPROBACIÓN: ver Caso 3 y 4 ampliados en
-- supabase/tests/print_queue.sql — ahora comprueban que la recuperación
-- deja un ticket_eventos, además del cambio de estado.
-- ══════════════════════════════════════════════════════════════
